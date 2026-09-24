import { ConvexError, v } from "convex/values";
import { mutation, internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

type Ctx = QueryCtx | MutationCtx;

const round2 = (n: number) => Math.round(n * 100) / 100;

/* Chart-of-accounts codes used by the engines (seeded per school). */
export const ACC = {
  CASH: "1000",
  MOBILE_MONEY: "1015",
  BANK: "1020",
  RECEIVABLE: "1200",
  REVENUE: "4000",
  DISCOUNT_EXPENSE: "4800",
  EXPENSES_CLEARING: "5000",
} as const;

/* ================================================================== */
/* Configuration: fee categories, payment methods, chart of accounts   */
/* ================================================================== */

export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "finance.view");
    const schoolId = session.schoolId as Id<"schools">;
    return ctx.db.query("feeCategories").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  },
});

export const addCategory = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const session = await requirePermission(ctx, "finance.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Category name is required.");
    const dup = await ctx.db
      .query("feeCategories")
      .withIndex("by_school_name", (q) => q.eq("schoolId", schoolId).eq("name", trimmed))
      .first();
    if (dup) return dup._id;
    const id = await ctx.db.insert("feeCategories", { schoolId, name: trimmed, status: "active" });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "finance.setting_changed",
      entityType: "feeCategories", entityId: id, description: `Fee category "${trimmed}" added`,
    });
    return id;
  },
});

export const listPaymentMethods = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "finance.view");
    const schoolId = session.schoolId as Id<"schools">;
    return ctx.db.query("paymentMethods").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  },
});

export const addPaymentMethod = mutation({
  args: { name: v.string(), integrationKey: v.optional(v.string()) },
  handler: async (ctx, { name, integrationKey }) => {
    const session = await requirePermission(ctx, "finance.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Payment method name is required.");
    const dup = await ctx.db
      .query("paymentMethods")
      .withIndex("by_school_name", (q) => q.eq("schoolId", schoolId).eq("name", trimmed))
      .first();
    if (dup) return dup._id;
    const id = await ctx.db.insert("paymentMethods", { schoolId, name: trimmed, integrationKey, status: "active" });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "finance.setting_changed",
      entityType: "paymentMethods", entityId: id, description: `Payment method "${trimmed}" added`,
    });
    return id;
  },
});

export const listLedgerAccounts = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "financial_reports.view");
    const schoolId = session.schoolId as Id<"schools">;
    return ctx.db.query("ledgerAccounts").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  },
});

/* ================================================================== */
/* Sequential numbering — REC-2026-00001 style, per school             */
/* ================================================================== */

export type NumberKind = "INV" | "PAY" | "REC" | "DISC" | "RFND" | "EXP" | "TXN";

const NUMBER_TABLES = {
  INV: "invoices",
  PAY: "payments",
  REC: "receipts",
  DISC: "discounts",
  RFND: "refunds",
  EXP: "expenses",
} as const;

type NumberedTable = (typeof NUMBER_TABLES)[Exclude<NumberKind, "TXN">];

function docNumber(
  kind: Exclude<NumberKind, "TXN">,
  row:
    | Doc<"invoices"> | Doc<"payments"> | Doc<"receipts">
    | Doc<"discounts"> | Doc<"refunds"> | Doc<"expenses">,
): string {
  switch (kind) {
    case "INV": return (row as Doc<"invoices">).invoiceNumber;
    case "PAY": return (row as Doc<"payments">).paymentNumber;
    case "REC": return (row as Doc<"receipts">).receiptNumber;
    case "DISC": return (row as Doc<"discounts">).discountNumber;
    case "RFND": return (row as Doc<"refunds">).refundNumber;
    case "EXP": return (row as Doc<"expenses">).expenseNumber;
  }
}

/**
 * Next sequential document number for a school (e.g. REC-2026-00042).
 * Convex mutations run in serializable transactions, so max+1 cannot collide.
 */
export async function nextNumber(ctx: Ctx, schoolId: Id<"schools">, kind: NumberKind): Promise<string> {
  const year = new Date().getFullYear();
  const suffix = (max: number) => `${kind}-${year}-${String(max + 1).padStart(5, "0")}`;
  const maxOf = (nums: string[]) =>
    nums.reduce((m, num) => {
      const parts = num.split("-");
      const n = Number(parts[parts.length - 1]);
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);

  if (kind === "TXN") {
    const txns = await ctx.db.query("ledgerTransactions").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    return suffix(maxOf(txns.map((t) => t.transactionNumber)));
  }
  const table = NUMBER_TABLES[kind];
  const rows = await ctx.db.query(table).withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  return suffix(maxOf(rows.map((r) => docNumber(kind, r as never))));
}

/* ================================================================== */
/* Ledger engine — immutable, balanced transactions                    */
/* ================================================================== */

export interface LedgerLine {
  code: string;
  direction: "debit" | "credit";
  amount: number;
}

export interface LedgerPostArgs {
  transactionType: "invoice" | "payment" | "discount" | "refund" | "expense" | "adjustment";
  date: string;
  amount: number;
  description?: string;
  lines: LedgerLine[];
  studentId?: Id<"students">;
  accountId?: Id<"studentAccounts">;
  invoiceId?: Id<"invoices">;
  paymentId?: Id<"payments">;
  discountId?: Id<"discounts">;
  refundId?: Id<"refunds">;
  expenseId?: Id<"expenses">;
}

/** Post a balanced ledger transaction. Throws when debits ≠ credits. */
export async function postLedgerTransaction(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  userId: Id<"users">,
  args: LedgerPostArgs,
): Promise<Id<"ledgerTransactions">> {
  if (!(args.amount > 0)) throw new ConvexError("Ledger transaction amount must be positive.");
  if (args.lines.length < 2) throw new ConvexError("A ledger transaction needs at least two lines.");
  const debit = round2(args.lines.filter((l) => l.direction === "debit").reduce((s, l) => s + l.amount, 0));
  const credit = round2(args.lines.filter((l) => l.direction === "credit").reduce((s, l) => s + l.amount, 0));
  if (Math.abs(debit - credit) > 0.001) {
    throw new ConvexError(`Unbalanced ledger transaction: debits ${debit} ≠ credits ${credit}.`);
  }
  for (const line of args.lines) {
    if (!(line.amount > 0)) throw new ConvexError("Ledger line amounts must be positive.");
  }
  const txnNumber = await nextNumber(ctx, schoolId, "TXN");
  const transactionId = await ctx.db.insert("ledgerTransactions", {
    schoolId,
    transactionType: args.transactionType,
    transactionNumber: txnNumber,
    date: args.date,
    amount: args.amount,
    description: args.description,
    studentId: args.studentId,
    accountId: args.accountId,
    invoiceId: args.invoiceId,
    paymentId: args.paymentId,
    discountId: args.discountId,
    refundId: args.refundId,
    expenseId: args.expenseId,
    createdById: userId,
    createdAt: Date.now(),
  });
  for (const line of args.lines) {
    const account = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_school_code", (q) => q.eq("schoolId", schoolId).eq("code", line.code))
      .first();
    if (!account) throw new ConvexError(`Ledger account ${line.code} is not configured for this school.`);
    await ctx.db.insert("ledgerEntries", {
      schoolId,
      transactionId,
      accountId: account._id,
      direction: line.direction,
      amount: line.amount,
    });
  }
  return transactionId;
}

/** The school's accounts-receivable control account (code 1200). */
export async function receivableAccount(ctx: Ctx, schoolId: Id<"schools">) {
  return ctx.db
    .query("ledgerAccounts")
    .withIndex("by_school_code", (q) => q.eq("schoolId", schoolId).eq("code", ACC.RECEIVABLE))
    .first();
}

/* ================================================================== */
/* Student financial accounts — balance derived from the ledger        */
/* ================================================================== */

export async function ensureStudentAccount(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  studentId: Id<"students">,
): Promise<Id<"studentAccounts">> {
  const existing = await ctx.db
    .query("studentAccounts")
    .withIndex("by_school_student", (q) => q.eq("schoolId", schoolId).eq("studentId", studentId))
    .first();
  if (existing) return existing._id;
  return ctx.db.insert("studentAccounts", { schoolId, studentId, openingBalance: 0, status: "active" });
}

/**
 * Canonical student balance: opening balance + Σ(debits on the receivable
 * account for this student's transactions) − Σ(credits). Never stored as an
 * editable field.
 */
export async function studentBalance(ctx: Ctx, schoolId: Id<"schools">, accountId: Id<"studentAccounts">): Promise<number> {
  const account = await ctx.db.get(accountId);
  if (!account) return 0;
  const receivable = await receivableAccount(ctx, schoolId);
  if (!receivable) return round2(account.openingBalance ?? 0);
  const txns = await ctx.db
    .query("ledgerTransactions")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  const entries = await ctx.db
    .query("ledgerEntries")
    .withIndex("by_account", (q) => q.eq("accountId", receivable._id))
    .collect();
  const entryByTxn = new Map(entries.map((e) => [e.transactionId, e]));
  let balance = account.openingBalance ?? 0;
  for (const t of txns) {
    const e = entryByTxn.get(t._id);
    if (!e) continue;
    balance += e.direction === "debit" ? e.amount : -e.amount;
  }
  return round2(balance);
}

export const accountForStudent = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    return ctx.db
      .query("studentAccounts")
      .withIndex("by_school_student", (q) => q.eq("schoolId", schoolId).eq("studentId", student._id))
      .first();
  },
});

export const ensureAccount = mutation({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    return ensureStudentAccount(ctx, schoolId, student._id);
  },
});

/* ================================================================== */
/* Invoices                                                            */
/* ================================================================== */

/** Recompute an invoice's status from its ledger movements. */
export async function refreshInvoiceStatus(ctx: MutationCtx, invoiceId: Id<"invoices">): Promise<string> {
  const inv = await ctx.db.get(invoiceId);
  if (!inv || inv.status === "cancelled") return inv?.status ?? "";
  // Live settlement is derived from the payments/discounts tables (reversed
  // payments excluded). The ledger is append-only, so reversed payments keep
  // their original transactions and cannot be summed for a live balance.
  const settledPayments = await ctx.db
    .query("payments")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .filter((q) => q.neq(q.field("status"), "reversed"))
    .collect();
  const settledDiscounts = await ctx.db
    .query("discounts")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .filter((q) => q.eq(q.field("status"), "applied"))
    .collect();
  const settled =
    settledPayments.reduce((s, p) => s + p.amount, 0) +
    settledDiscounts.reduce((s, d) => s + d.computedAmount, 0);
  const today = new Date().toISOString().slice(0, 10);
  let next = inv.status;
  if (settled >= inv.totalAmount - 0.001) next = "paid";
  else if (settled > 0) next = "partially_paid";
  else if (inv.status === "issued" && inv.dueDate < today) next = "overdue";
  else if (inv.status === "overdue" && inv.dueDate >= today) next = "issued";
  if (next !== inv.status) {
    await ctx.db.patch(invoiceId, { status: next, updatedAt: Date.now() });
  }
  return next;
}

export const listInvoices = query({
  args: {
    termId: v.optional(v.id("terms")),
    studentId: v.optional(v.id("students")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { termId, studentId, status }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    let rows: Doc<"invoices">[];
    if (studentId) {
      await getSchoolRecord(ctx, schoolId, "students", studentId);
      rows = await ctx.db.query("invoices").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect();
    } else if (termId) {
      await getSchoolRecord(ctx, schoolId, "terms", termId);
      rows = await ctx.db.query("invoices").withIndex("by_term", (q) => q.eq("termId", termId)).collect();
    } else {
      rows = await ctx.db.query("invoices").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    }
    rows = rows.filter((r) => r.schoolId === schoolId);
    if (status && status !== "all") rows = rows.filter((r) => r.status === status);
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const studentById = new Map(students.map((s) => [s._id, s]));
    return rows
      .sort((a, b) => (a.invoiceNumber < b.invoiceNumber ? 1 : -1))
      .slice(0, 500)
      .map((inv) => {
        const st = studentById.get(inv.studentId);
        return {
          _id: inv._id,
          invoiceNumber: inv.invoiceNumber,
          studentId: inv.studentId,
          studentName: st ? [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") : "—",
          admissionNumber: st?.admissionNumber ?? "",
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          totalAmount: inv.totalAmount,
          status: inv.status,
        };
      });
  },
});

export const invoiceDetail = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    const inv = await getSchoolRecord(ctx, schoolId, "invoices", invoiceId);
    const items = await ctx.db.query("invoiceItems").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect();
    const student = await ctx.db.get(inv.studentId);
    const term = await ctx.db.get(inv.termId);
    const year = await ctx.db.get(inv.academicYearId);
    const school = await ctx.db.get(schoolId);
    // Same rule as refreshInvoiceStatus: live totals from payments/discounts
    // tables (reversed excluded), never from append-only ledger history.
    const livePayments = await ctx.db
      .query("payments")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
      .filter((q) => q.neq(q.field("status"), "reversed"))
      .collect();
    const liveDiscounts = await ctx.db
      .query("discounts")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
      .filter((q) => q.eq(q.field("status"), "applied"))
      .collect();
    const paid = livePayments.reduce((s, p) => s + p.amount, 0);
    const discounted = liveDiscounts.reduce((s, d) => s + d.computedAmount, 0);
    return {
      invoice: {
        _id: inv._id, invoiceNumber: inv.invoiceNumber, issueDate: inv.issueDate, dueDate: inv.dueDate,
        totalAmount: inv.totalAmount, status: inv.status, notes: inv.notes ?? null,
      },
      student: student
        ? {
            _id: student._id,
            name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
            admissionNumber: student.admissionNumber,
          }
        : null,
      term: term ? { _id: term._id, name: term.name } : null,
      year: year ? { _id: year._id, name: year.name } : null,
      school: school
        ? {
            name: school.name, county: school.county ?? null, phone: school.phone ?? null,
            email: school.email ?? null, postalAddress: school.postalAddress ?? null,
          }
        : null,
      items: items.map((i) => ({
        description: i.description, category: i.category, quantity: i.quantity,
        amount: i.amount, lineTotal: round2(i.quantity * i.amount),
      })),
      totals: {
        totalAmount: inv.totalAmount, paid: round2(paid), discounted: round2(discounted),
        balance: round2(inv.totalAmount - paid - discounted),
      },
    };
  },
});

export const createInvoice = mutation({
  args: {
    studentId: v.id("students"),
    termId: v.id("terms"),
    issueDate: v.string(),
    dueDate: v.string(),
    items: v.array(v.object({ description: v.string(), category: v.string(), quantity: v.number(), amount: v.number() })),
    notes: v.optional(v.string()),
    issueNow: v.optional(v.boolean()),
  },
  handler: async (ctx, { studentId, termId, issueDate, dueDate, items, notes, issueNow }) => {
    const session = await requirePermission(ctx, "billing.create");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    const term = await getSchoolRecord(ctx, schoolId, "terms", termId);
    if (items.length === 0) throw new ConvexError("Add at least one invoice item.");
    for (const it of items) {
      if (!it.description.trim()) throw new ConvexError("Every item needs a description.");
      if (!(it.amount > 0)) throw new ConvexError("Item amounts must be positive.");
      if (!(it.quantity > 0)) throw new ConvexError("Item quantities must be positive.");
    }
    const total = round2(items.reduce((s, it) => s + it.quantity * it.amount, 0));
    const accountId = await ensureStudentAccount(ctx, schoolId, student._id);
    const invoiceNumber = await nextNumber(ctx, schoolId, "INV");

    const invoiceId = await ctx.db.insert("invoices", {
      schoolId,
      invoiceNumber,
      studentId: student._id,
      accountId,
      academicYearId: term.academicYearId,
      termId: term._id,
      issueDate,
      dueDate,
      totalAmount: total,
      status: issueNow ? "issued" : "draft",
      notes,
      createdById: session.userId,
      issuedAt: issueNow ? Date.now() : undefined,
    });
    for (const it of items) {
      await ctx.db.insert("invoiceItems", {
        schoolId, invoiceId, description: it.description.trim(), category: it.category,
        quantity: it.quantity, amount: it.amount,
      });
    }
    if (issueNow) {
      await postLedgerTransaction(ctx, schoolId, session.userId, {
        transactionType: "invoice",
        date: issueDate,
        amount: total,
        description: `Invoice ${invoiceNumber} — ${student.firstName} ${student.lastName}`,
        studentId: student._id,
        accountId,
        invoiceId,
        lines: [
          { code: ACC.RECEIVABLE, direction: "debit", amount: total },
          { code: ACC.REVENUE, direction: "credit", amount: total },
        ],
      });
      await recordAudit(ctx, {
        userId: session.userId, schoolId, action: "invoice.created", entityType: "invoices",
        entityId: invoiceId, description: `Invoice ${invoiceNumber} issued for ${total}`, metadata: { invoiceNumber },
      });
    } else {
      await recordAudit(ctx, {
        userId: session.userId, schoolId, action: "invoice.drafted", entityType: "invoices",
        entityId: invoiceId, description: `Draft invoice ${invoiceNumber} created`, metadata: { invoiceNumber },
      });
    }
    return invoiceId;
  },
});

export const issueInvoice = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const session = await requirePermission(ctx, "billing.create");
    const schoolId = session.schoolId as Id<"schools">;
    const inv = await getSchoolRecord(ctx, schoolId, "invoices", invoiceId);
    if (inv.status !== "draft") throw new ConvexError("Only draft invoices can be issued.");
    await postLedgerTransaction(ctx, schoolId, session.userId, {
      transactionType: "invoice",
      date: inv.issueDate,
      amount: inv.totalAmount,
      description: `Invoice ${inv.invoiceNumber}`,
      studentId: inv.studentId,
      accountId: inv.accountId,
      invoiceId,
      lines: [
        { code: ACC.RECEIVABLE, direction: "debit", amount: inv.totalAmount },
        { code: ACC.REVENUE, direction: "credit", amount: inv.totalAmount },
      ],
    });
    await ctx.db.patch(invoiceId, { status: "issued", issuedAt: Date.now(), updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "invoice.created", entityType: "invoices",
      entityId: invoiceId, description: `Invoice ${inv.invoiceNumber} issued (${inv.totalAmount})`,
    });
    return { ok: true };
  },
});

export const cancelInvoice = mutation({
  args: { invoiceId: v.id("invoices"), reason: v.string() },
  handler: async (ctx, { invoiceId, reason }) => {
    const session = await requirePermission(ctx, "billing.create");
    const schoolId = session.schoolId as Id<"schools">;
    const inv = await getSchoolRecord(ctx, schoolId, "invoices", invoiceId);
    if (inv.status === "cancelled") throw new ConvexError("Invoice is already cancelled.");
    if (!reason.trim()) throw new ConvexError("A cancellation reason is required.");
    const txns = await ctx.db
      .query("ledgerTransactions")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
      .collect();
    // The ledger is append-only, so reversed payments leave their original
    // transactions behind. Cancellation only requires that no *active*
    // payment remains — check the payments table, not transaction history.
    const activePayments = await ctx.db
      .query("payments")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
      .filter((q) => q.neq(q.field("status"), "reversed"))
      .collect();
    if (activePayments.length > 0) {
      throw new ConvexError("This invoice has active payments. Reverse the payments first, then cancel.");
    }
    // Reverse the original receivable posting (issuance + any applied discounts).
    const invoiceTxn = txns.find((t) => t.transactionType === "invoice");
    const discountTxns = txns.filter((t) => t.transactionType === "discount");
    const today = new Date().toISOString().slice(0, 10);
    if (invoiceTxn) {
      await postLedgerTransaction(ctx, schoolId, session.userId, {
        transactionType: "adjustment",
        date: today,
        amount: inv.totalAmount,
        description: `Reversal of cancelled invoice ${inv.invoiceNumber}`,
        studentId: inv.studentId,
        accountId: inv.accountId,
        invoiceId,
        lines: [
          { code: ACC.REVENUE, direction: "debit", amount: inv.totalAmount },
          { code: ACC.RECEIVABLE, direction: "credit", amount: inv.totalAmount },
        ],
      });
    }
    for (const d of discountTxns) {
      await postLedgerTransaction(ctx, schoolId, session.userId, {
        transactionType: "adjustment",
        date: today,
        amount: d.amount,
        description: `Reversal of discount on cancelled invoice ${inv.invoiceNumber}`,
        studentId: inv.studentId,
        accountId: inv.accountId,
        invoiceId,
        lines: [
          { code: ACC.RECEIVABLE, direction: "debit", amount: d.amount },
          { code: ACC.DISCOUNT_EXPENSE, direction: "credit", amount: d.amount },
        ],
      });
    }
    await ctx.db.patch(invoiceId, { status: "cancelled", cancelledAt: Date.now(), cancelReason: reason, updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "invoice.cancelled", entityType: "invoices",
      entityId: invoiceId, description: `Invoice ${inv.invoiceNumber} cancelled: ${reason}`,
    });
    return { ok: true };
  },
});

/* ================================================================== */
/* Payments & receipts                                                 */
/* ================================================================== */

/**
 * Phase 6: system payment posting used by verified external callbacks
 * (M-Pesa). Reuses the exact recordPayment engine (payment → ledger →
 * receipt → invoice status) but runs WITHOUT a user session: the platform
 * itself is the actor. Idempotency is enforced upstream by the caller via
 * provider transaction IDs; the reference uniqueness check below is a
 * second safety net.
 */
export async function postSystemPayment(
  ctx: MutationCtx,
  args: {
    schoolId: Id<"schools">;
    studentId: Id<"students">;
    invoiceId?: Id<"invoices">;
    amount: number;
    method: string;
    referenceNumber: string;
  },
): Promise<{ paymentId: Id<"payments">; paymentNumber: string; receiptNumber: string | null; balanceAfter: number | null; duplicate: boolean }> {
  const { schoolId, studentId, invoiceId, amount, method, referenceNumber } = args;
  {
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    if (!(amount > 0)) throw new ConvexError("Payment amount must be positive.");
    // Idempotency net: a confirmed payment with the same provider reference
    // makes this call a no-op returning the existing payment.
    const all = await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const existing = all.find((p) => p.referenceNumber === referenceNumber && p.status !== "reversed");
    if (existing) {
      return { paymentId: existing._id, paymentNumber: existing.paymentNumber, receiptNumber: null, balanceAfter: null, duplicate: true as const };
    }
    let invoice: Doc<"invoices"> | null = null;
    if (invoiceId) {
      invoice = await getSchoolRecord(ctx, schoolId, "invoices", invoiceId);
      if (invoice.status === "cancelled") throw new ConvexError("Cannot pay a cancelled invoice.");
    }
    const methods = await ctx.db.query("paymentMethods").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const methodRow = methods.find((m) => m.name.toLowerCase() === method.trim().toLowerCase());
    const systemActor = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "system@schoolcore.internal")).first()
      ?? (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "admin@schoolcore.dev")).first());
    if (!systemActor) throw new ConvexError("System actor user is missing.");
    const accountId = await ensureStudentAccount(ctx, schoolId, student._id);
    const paymentNumber = await nextNumber(ctx, schoolId, "PAY");
    const paymentDate = new Date().toISOString().slice(0, 10);
    const paymentId = await ctx.db.insert("payments", {
      schoolId,
      paymentNumber,
      studentId: student._id,
      accountId,
      invoiceId: invoice?._id,
      amount,
      paymentDate,
      method: methodRow?.name ?? method.trim(),
      referenceNumber,
      notes: "Recorded automatically from a verified mobile-money transaction",
      receivedById: systemActor._id,
      status: "confirmed",
      confirmedAt: Date.now(),
    });
    const cashCode =
      methodRow?.integrationKey === "mobile_money" ? ACC.MOBILE_MONEY
      : methodRow?.integrationKey === "bank_transfer" ? ACC.BANK
      : ACC.CASH;
    await postLedgerTransaction(ctx, schoolId, systemActor._id, {
      transactionType: "payment",
      date: paymentDate,
      amount,
      description: `Payment ${paymentNumber} — ${student.firstName} ${student.lastName} (mobile money)`,
      studentId: student._id,
      accountId,
      invoiceId: invoice?._id,
      paymentId,
      lines: [
        { code: cashCode, direction: "debit", amount },
        { code: ACC.RECEIVABLE, direction: "credit", amount },
      ],
    });
    const balanceAfter = await studentBalance(ctx, schoolId, accountId);
    const receiptNumber = await nextNumber(ctx, schoolId, "REC");
    await ctx.db.insert("receipts", {
      schoolId, receiptNumber, paymentId, studentId: student._id, accountId,
      amount, balanceAfter, method: methodRow?.name ?? method.trim(), paymentDate,
      issuedById: systemActor._id, issuedAt: Date.now(),
    });
    if (invoice) await refreshInvoiceStatus(ctx, invoice._id);
    await recordAudit(ctx, {
      userId: systemActor._id, schoolId, action: "payment.recorded_external", entityType: "payments",
      entityId: paymentId,
      description: `Payment ${paymentNumber} of ${amount} recorded from verified mobile-money transaction ${referenceNumber}`,
      metadata: { paymentNumber, method: methodRow?.name ?? method, providerRef: referenceNumber },
    });
    return { paymentId, paymentNumber, receiptNumber, balanceAfter, duplicate: false as const };
  }
}

export const recordPayment = mutation({
  args: {
    studentId: v.id("students"),
    invoiceId: v.optional(v.id("invoices")),
    amount: v.number(),
    paymentDate: v.string(),
    method: v.string(),
    referenceNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { studentId, invoiceId, amount, paymentDate, method, referenceNumber, notes }) => {
    const session = await requirePermission(ctx, "payments.create");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    if (!(amount > 0)) throw new ConvexError("Payment amount must be positive.");
    if (amount > 5_000_000) {
      throw new ConvexError("Payment exceeds the 5,000,000 safety limit — split it or verify the amount with the payer.");
    }
    if (referenceNumber?.trim()) {
      const ref = referenceNumber.trim();
      const all = await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
      if (all.some((p) => p.referenceNumber === ref && p.status !== "reversed")) {
        throw new ConvexError(`Payment reference "${ref}" has already been used.`);
      }
    }
    let invoice: Doc<"invoices"> | null = null;
    if (invoiceId) {
      invoice = await getSchoolRecord(ctx, schoolId, "invoices", invoiceId);
      if (invoice.status === "cancelled") throw new ConvexError("Cannot pay a cancelled invoice.");
    }
    const methods = await ctx.db.query("paymentMethods").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const methodRow = methods.find((m) => m.name.toLowerCase() === method.trim().toLowerCase());
    if (methods.length > 0 && !methodRow) throw new ConvexError("Unknown payment method for this school.");

    const accountId = await ensureStudentAccount(ctx, schoolId, student._id);
    const paymentNumber = await nextNumber(ctx, schoolId, "PAY");
    const paymentId = await ctx.db.insert("payments", {
      schoolId,
      paymentNumber,
      studentId: student._id,
      accountId,
      invoiceId: invoice?._id,
      amount,
      paymentDate,
      method: methodRow?.name ?? method.trim(),
      referenceNumber: referenceNumber?.trim() || undefined,
      notes,
      receivedById: session.userId,
      status: "confirmed",
      confirmedAt: Date.now(),
    });
    const cashCode =
      methodRow?.integrationKey === "mobile_money" ? ACC.MOBILE_MONEY
      : methodRow?.integrationKey === "bank_transfer" ? ACC.BANK
      : ACC.CASH;
    await postLedgerTransaction(ctx, schoolId, session.userId, {
      transactionType: "payment",
      date: paymentDate,
      amount,
      description: `Payment ${paymentNumber} — ${student.firstName} ${student.lastName}`,
      studentId: student._id,
      accountId,
      invoiceId: invoice?._id,
      paymentId,
      lines: [
        { code: cashCode, direction: "debit", amount },
        { code: ACC.RECEIVABLE, direction: "credit", amount },
      ],
    });
    const balanceAfter = await studentBalance(ctx, schoolId, accountId);
    const receiptNumber = await nextNumber(ctx, schoolId, "REC");
    await ctx.db.insert("receipts", {
      schoolId, receiptNumber, paymentId, studentId: student._id, accountId,
      amount, balanceAfter, method: methodRow?.name ?? method.trim(), paymentDate,
      issuedById: session.userId, issuedAt: Date.now(),
    });
    if (invoice) await refreshInvoiceStatus(ctx, invoice._id);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payment.recorded", entityType: "payments",
      entityId: paymentId,
      description: `Payment ${paymentNumber} of ${amount} recorded for ${student.firstName} ${student.lastName}`,
      metadata: { paymentNumber, method: methodRow?.name ?? method },
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "receipt.generated", entityType: "receipts",
      entityId: paymentId, description: `Receipt ${receiptNumber} issued (${amount})`,
    });
    return { paymentId, paymentNumber, receiptNumber, balanceAfter };
  },
});

export const reversePayment = mutation({
  args: { paymentId: v.id("payments"), reason: v.string() },
  handler: async (ctx, { paymentId, reason }) => {
    const session = await requirePermission(ctx, "payments.approve");
    const schoolId = session.schoolId as Id<"schools">;
    const payment = await getSchoolRecord(ctx, schoolId, "payments", paymentId);
    if (payment.status === "reversed") throw new ConvexError("Payment is already reversed.");
    if (!reason.trim()) throw new ConvexError("A reversal reason is required.");
    const receipt = await ctx.db.query("receipts").withIndex("by_payment", (q) => q.eq("paymentId", paymentId)).first();
    if (receipt) await ctx.db.patch(receipt._id, { voidedAt: Date.now() });
    await postLedgerTransaction(ctx, schoolId, session.userId, {
      transactionType: "adjustment",
      date: new Date().toISOString().slice(0, 10),
      amount: payment.amount,
      description: `Reversal of payment ${payment.paymentNumber}: ${reason}`,
      studentId: payment.studentId,
      accountId: payment.accountId,
      invoiceId: payment.invoiceId ?? undefined,
      lines: [
        { code: ACC.RECEIVABLE, direction: "debit", amount: payment.amount },
        { code: ACC.CASH, direction: "credit", amount: payment.amount },
      ],
    });
    await ctx.db.patch(paymentId, {
      status: "reversed", reversedAt: Date.now(), reversedById: session.userId,
      reverseReason: reason, updatedAt: Date.now(),
    });
    if (payment.invoiceId) await refreshInvoiceStatus(ctx, payment.invoiceId);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payment.reversed", entityType: "payments",
      entityId: paymentId, description: `Payment ${payment.paymentNumber} reversed: ${reason}`,
    });
    return { ok: true };
  },
});

export const listPayments = query({
  args: { studentId: v.optional(v.id("students")) },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "receipts.view");
    const schoolId = session.schoolId as Id<"schools">;
    let rows: Doc<"payments">[];
    if (studentId) {
      await getSchoolRecord(ctx, schoolId, "students", studentId);
      rows = await ctx.db.query("payments").withIndex("by_student", (q) => q.eq("studentId", studentId)).collect();
    } else {
      rows = await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    }
    rows = rows.filter((r) => r.schoolId === schoolId);
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const studentById = new Map(students.map((s) => [s._id, s]));
    return rows
      .sort((a, b) =>
        a.paymentDate < b.paymentDate ? 1 : a.paymentDate > b.paymentDate ? -1 : a.paymentNumber < b.paymentNumber ? 1 : -1,
      )
      .slice(0, 500)
      .map((p) => {
        const st = studentById.get(p.studentId);
        return {
          _id: p._id, paymentNumber: p.paymentNumber, studentId: p.studentId,
          studentName: st ? [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") : "—",
          admissionNumber: st?.admissionNumber ?? "",
          amount: p.amount, paymentDate: p.paymentDate, method: p.method,
          referenceNumber: p.referenceNumber ?? null, status: p.status,
        };
      });
  },
});

export const paymentDetail = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const session = await requirePermission(ctx, "receipts.view");
    const schoolId = session.schoolId as Id<"schools">;
    const p = await getSchoolRecord(ctx, schoolId, "payments", paymentId);
    const student = await ctx.db.get(p.studentId);
    const receipt = await ctx.db.query("receipts").withIndex("by_payment", (q) => q.eq("paymentId", paymentId)).first();
    const school = await ctx.db.get(schoolId);
    const invoice = p.invoiceId ? await ctx.db.get(p.invoiceId) : null;
    const receivedBy = await ctx.db.get(p.receivedById);
    return {
      payment: {
        _id: p._id, paymentNumber: p.paymentNumber, amount: p.amount, paymentDate: p.paymentDate,
        method: p.method, referenceNumber: p.referenceNumber ?? null, status: p.status, notes: p.notes ?? null,
      },
      student: student
        ? {
            _id: student._id,
            name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
            admissionNumber: student.admissionNumber,
          }
        : null,
      invoice: invoice ? { _id: invoice._id, invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount } : null,
      receipt: receipt
        ? { receiptNumber: receipt.receiptNumber, balanceAfter: receipt.balanceAfter, voidedAt: receipt.voidedAt ?? null }
        : null,
      school: school
        ? {
            name: school.name, county: school.county ?? null, phone: school.phone ?? null,
            email: school.email ?? null, postalAddress: school.postalAddress ?? null,
          }
        : null,
      receivedBy: receivedBy?.name ?? null,
    };
  },
});

/* ================================================================== */
/* Discounts                                                           */
/* ================================================================== */

export const requestDiscount = mutation({
  args: {
    studentId: v.id("students"),
    invoiceId: v.optional(v.id("invoices")),
    name: v.string(),
    discountType: v.string(), // percentage | amount
    value: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { studentId, invoiceId, name, discountType, value, reason }) => {
    const session = await requirePermission(ctx, "discounts.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    if (!name.trim()) throw new ConvexError("Discount name is required.");
    if (!["percentage", "amount"].includes(discountType)) throw new ConvexError("Unknown discount type.");
    if (!(value > 0)) throw new ConvexError("Discount value must be positive.");
    if (discountType === "percentage" && value > 100) throw new ConvexError("Percentage discount cannot exceed 100%.");
    let invoice: Doc<"invoices"> | null = null;
    if (invoiceId) invoice = await getSchoolRecord(ctx, schoolId, "invoices", invoiceId);
    const accountId = await ensureStudentAccount(ctx, schoolId, student._id);
    const discountNumber = await nextNumber(ctx, schoolId, "DISC");
    const id = await ctx.db.insert("discounts", {
      schoolId, discountNumber, studentId: student._id, accountId,
      invoiceId: invoice?._id, name: name.trim(), discountType, value,
      computedAmount: 0, reason, status: "pending", requestedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "discount.requested", entityType: "discounts",
      entityId: id, description: `Discount ${discountNumber} requested (${name.trim()})`,
    });
    return id;
  },
});

/** Approve + apply a discount: posts the credit to the student account (audited). */
export const approveDiscount = mutation({
  args: { discountId: v.id("discounts") },
  handler: async (ctx, { discountId }) => {
    const session = await requirePermission(ctx, "discounts.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const d = await getSchoolRecord(ctx, schoolId, "discounts", discountId);
    if (d.status !== "pending") throw new ConvexError("Only pending discounts can be approved.");
    let computedAmount = round2(d.value);
    if (d.discountType === "percentage") {
      const invoice = d.invoiceId ? await ctx.db.get(d.invoiceId) : null;
      if (!invoice) throw new ConvexError("Percentage discounts need a linked invoice to compute against.");
      computedAmount = round2((invoice.totalAmount * d.value) / 100);
    }
    if (!(computedAmount > 0)) throw new ConvexError("Computed discount amount must be positive.");
    const txnId = await postLedgerTransaction(ctx, schoolId, session.userId, {
      transactionType: "discount",
      date: new Date().toISOString().slice(0, 10),
      amount: computedAmount,
      description: `Discount ${d.discountNumber} (${d.name})`,
      studentId: d.studentId,
      accountId: d.accountId,
      invoiceId: d.invoiceId ?? undefined,
      discountId,
      lines: [
        { code: ACC.DISCOUNT_EXPENSE, direction: "debit", amount: computedAmount },
        { code: ACC.RECEIVABLE, direction: "credit", amount: computedAmount },
      ],
    });
    await ctx.db.patch(discountId, {
      status: "applied", computedAmount, approvedById: session.userId, approvedAt: Date.now(),
      appliedTransactionId: txnId, updatedAt: Date.now(),
    });
    if (d.invoiceId) await refreshInvoiceStatus(ctx, d.invoiceId);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "discount.approved", entityType: "discounts",
      entityId: discountId, description: `Discount ${d.discountNumber} approved and applied (${computedAmount})`,
      metadata: { discountNumber: d.discountNumber },
    });
    return { ok: true, computedAmount };
  },
});

export const rejectDiscount = mutation({
  args: { discountId: v.id("discounts"), reason: v.string() },
  handler: async (ctx, { discountId, reason }) => {
    const session = await requirePermission(ctx, "discounts.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const d = await getSchoolRecord(ctx, schoolId, "discounts", discountId);
    if (d.status !== "pending") throw new ConvexError("Only pending discounts can be rejected.");
    await ctx.db.patch(discountId, {
      status: "rejected", approvedById: session.userId, approvedAt: Date.now(),
      reason: reason.trim() || d.reason, updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "discount.rejected", entityType: "discounts",
      entityId: discountId, description: `Discount ${d.discountNumber} rejected: ${reason}`,
    });
    return { ok: true };
  },
});

export const listDiscounts = query({
  args: { status: v.optional(v.string()), studentId: v.optional(v.id("students")) },
  handler: async (ctx, { status, studentId }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    let rows = await ctx.db.query("discounts").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    if (status && status !== "all") rows = rows.filter((r) => r.status === status);
    if (studentId) rows = rows.filter((r) => r.studentId === studentId);
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const studentById = new Map(students.map((s) => [s._id, s]));
    return rows
      .sort((a, b) => (a.discountNumber < b.discountNumber ? 1 : -1))
      .slice(0, 300)
      .map((d) => {
        const st = studentById.get(d.studentId);
        return {
          _id: d._id, discountNumber: d.discountNumber,
          studentName: st ? `${st.firstName} ${st.lastName}` : "—",
          name: d.name, discountType: d.discountType, value: d.value,
          computedAmount: d.computedAmount, status: d.status, reason: d.reason ?? null,
        };
      });
  },
});

/* ================================================================== */
/* Scholarships & bursaries                                            */
/* ================================================================== */

export const requestScholarship = mutation({
  args: {
    studentId: v.id("students"),
    name: v.string(),
    scholarshipType: v.string(), // percentage | amount
    value: v.number(),
    academicYearId: v.id("academicYears"),
    termId: v.optional(v.id("terms")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { studentId, name, scholarshipType, value, academicYearId, termId, reason }) => {
    const session = await requirePermission(ctx, "scholarships.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    const year = await getSchoolRecord(ctx, schoolId, "academicYears", academicYearId);
    if (!name.trim()) throw new ConvexError("Scholarship name is required.");
    if (!["percentage", "amount"].includes(scholarshipType)) throw new ConvexError("Unknown scholarship type.");
    if (!(value > 0)) throw new ConvexError("Scholarship value must be positive.");
    if (scholarshipType === "percentage" && value > 100) throw new ConvexError("Percentage scholarship cannot exceed 100%.");
    if (termId) await getSchoolRecord(ctx, schoolId, "terms", termId);
    const accountId = await ensureStudentAccount(ctx, schoolId, student._id);
    const id = await ctx.db.insert("scholarships", {
      schoolId, studentId: student._id, accountId, name: name.trim(),
      scholarshipType, value, reason, academicYearId: year._id, termId,
      status: "active", approvedById: session.userId, approvedAt: Date.now(), createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "scholarship.approved", entityType: "scholarships",
      entityId: id,
      description: `Scholarship "${name.trim()}" (${scholarshipType} ${value}) approved for ${student.firstName} ${student.lastName}`,
    });
    return id;
  },
});

export const endScholarship = mutation({
  args: { scholarshipId: v.id("scholarships"), status: v.string() },
  handler: async (ctx, { scholarshipId, status }) => {
    const session = await requirePermission(ctx, "scholarships.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const s = await getSchoolRecord(ctx, schoolId, "scholarships", scholarshipId);
    if (!["ended", "cancelled"].includes(status)) throw new ConvexError("Status must be ended or cancelled.");
    await ctx.db.patch(scholarshipId, { status, updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "scholarship.ended", entityType: "scholarships",
      entityId: scholarshipId, description: `Scholarship "${s.name}" marked ${status}`,
    });
    return { ok: true };
  },
});

export const listScholarships = query({
  args: { studentId: v.optional(v.id("students")) },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    let rows = await ctx.db.query("scholarships").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    if (studentId) rows = rows.filter((r) => r.studentId === studentId);
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const studentById = new Map(students.map((s) => [s._id, s]));
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 300)
      .map((s) => {
        const st = studentById.get(s.studentId);
        return {
          _id: s._id, studentName: st ? `${st.firstName} ${st.lastName}` : "—",
          name: s.name, scholarshipType: s.scholarshipType, value: s.value,
          termId: s.termId ?? null, academicYearId: s.academicYearId,
          status: s.status, reason: s.reason ?? null,
        };
      });
  },
});

/* ================================================================== */
/* Refunds — request → approve → ledger payment                        */
/* ================================================================== */

export const requestRefund = mutation({
  args: {
    studentId: v.id("students"),
    paymentId: v.optional(v.id("payments")),
    amount: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { studentId, paymentId, amount, reason }) => {
    const session = await requirePermission(ctx, "payments.create");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    if (!(amount > 0)) throw new ConvexError("Refund amount must be positive.");
    if (paymentId) {
      const p = await getSchoolRecord(ctx, schoolId, "payments", paymentId);
      if (p.status === "reversed") throw new ConvexError("Cannot refund a reversed payment.");
    }
    const accountId = await ensureStudentAccount(ctx, schoolId, student._id);
    const refundNumber = await nextNumber(ctx, schoolId, "RFND");
    const id = await ctx.db.insert("refunds", {
      schoolId, refundNumber, studentId: student._id, accountId, paymentId,
      amount, reason, status: "requested", requestedById: session.userId, createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "refund.requested", entityType: "refunds",
      entityId: id, description: `Refund ${refundNumber} requested (${amount})`,
    });
    return id;
  },
});

export const approveRefund = mutation({
  args: { refundId: v.id("refunds"), payNow: v.optional(v.boolean()) },
  handler: async (ctx, { refundId, payNow }) => {
    const session = await requirePermission(ctx, "payments.approve");
    const schoolId = session.schoolId as Id<"schools">;
    const r = await getSchoolRecord(ctx, schoolId, "refunds", refundId);
    if (r.status !== "requested") throw new ConvexError("Only requested refunds can be approved.");
    if (payNow) {
      const txnId = await postLedgerTransaction(ctx, schoolId, session.userId, {
        transactionType: "refund",
        date: new Date().toISOString().slice(0, 10),
        amount: r.amount,
        description: `Refund ${r.refundNumber} paid`,
        studentId: r.studentId,
        accountId: r.accountId,
        refundId,
        lines: [
          { code: ACC.RECEIVABLE, direction: "debit", amount: r.amount },
          { code: ACC.CASH, direction: "credit", amount: r.amount },
        ],
      });
      await ctx.db.patch(refundId, {
        status: "paid", approvedById: session.userId, approvedAt: Date.now(),
        paidTransactionId: txnId, updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(refundId, {
        status: "approved", approvedById: session.userId, approvedAt: Date.now(), updatedAt: Date.now(),
      });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "refund.approved", entityType: "refunds",
      entityId: refundId, description: `Refund ${r.refundNumber} approved${payNow ? " and paid" : ""}`,
    });
    return { ok: true };
  },
});

export const rejectRefund = mutation({
  args: { refundId: v.id("refunds"), reason: v.string() },
  handler: async (ctx, { refundId, reason }) => {
    const session = await requirePermission(ctx, "payments.approve");
    const schoolId = session.schoolId as Id<"schools">;
    const r = await getSchoolRecord(ctx, schoolId, "refunds", refundId);
    if (!["requested", "approved"].includes(r.status)) throw new ConvexError("Only open refunds can be rejected.");
    await ctx.db.patch(refundId, { status: "rejected", updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "refund.rejected", entityType: "refunds",
      entityId: refundId, description: `Refund ${r.refundNumber} rejected: ${reason}`,
    });
    return { ok: true };
  },
});

export const listRefunds = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "receipts.view");
    const schoolId = session.schoolId as Id<"schools">;
    const rows = await ctx.db.query("refunds").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const byId = new Map(students.map((s) => [s._id, s]));
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 300)
      .map((r) => {
        const st = byId.get(r.studentId);
        return {
          _id: r._id, refundNumber: r.refundNumber,
          studentName: st ? `${st.firstName} ${st.lastName}` : "—",
          amount: r.amount, status: r.status, reason: r.reason ?? null,
        };
      });
  },
});

/* ================================================================== */
/* Account statement — every line derived from the ledger              */
/* ================================================================== */

export const accountStatement = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    const account = await ctx.db
      .query("studentAccounts")
      .withIndex("by_school_student", (q) => q.eq("schoolId", schoolId).eq("studentId", student._id))
      .first();
    if (!account) return null;
    const receivable = await receivableAccount(ctx, schoolId);
    const txns = await ctx.db
      .query("ledgerTransactions")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    txns.sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
    const entries = receivable
      ? await ctx.db.query("ledgerEntries").withIndex("by_account", (q) => q.eq("accountId", receivable._id)).collect()
      : [];
    const entryByTxn = new Map(entries.map((e) => [e.transactionId, e]));
    let running = account.openingBalance ?? 0;
    const lines = txns.map((t) => {
      const e = entryByTxn.get(t._id);
      const debit = e?.direction === "debit" ? e.amount : 0;
      const credit = e?.direction === "credit" ? e.amount : 0;
      running = round2(running + debit - credit);
      return {
        date: t.date, type: t.transactionType, number: t.transactionNumber,
        description: t.description ?? "", debit, credit, balance: running,
      };
    });
    return {
      student: {
        name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
        admissionNumber: student.admissionNumber,
      },
      account: { _id: account._id, openingBalance: account.openingBalance ?? 0 },
      lines,
      closingBalance: running,
    };
  },
});

/** Compact finance summary for one student (account header + balance). */
export const studentFinanceSummary = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    const account = await ctx.db
      .query("studentAccounts")
      .withIndex("by_school_student", (q) => q.eq("schoolId", schoolId).eq("studentId", student._id))
      .first();
    if (!account) return null;
    const txns = await ctx.db
      .query("ledgerTransactions")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    let billed = 0;
    let paid = 0;
    let discounted = 0;
    let refunded = 0;
    for (const t of txns) {
      if (t.transactionType === "invoice") billed += t.amount;
      else if (t.transactionType === "payment") paid += t.amount;
      else if (t.transactionType === "discount") discounted += t.amount;
      else if (t.transactionType === "refund") refunded += t.amount;
    }
    const balance = await studentBalance(ctx, schoolId, account._id);
    const invoices = await ctx.db.query("invoices").withIndex("by_student", (q) => q.eq("studentId", student._id)).collect();
    return {
      account: { _id: account._id, openingBalance: account.openingBalance ?? 0 },
      totals: {
        billed: round2(billed), paid: round2(paid), discounted: round2(discounted),
        refunded: round2(refunded), balance,
      },
      invoiceCount: invoices.filter((i) => i.status !== "cancelled").length,
    };
  },
});
