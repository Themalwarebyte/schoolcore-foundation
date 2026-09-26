import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { ACC, postLedgerTransaction, nextNumber, studentBalance } from "./finance";

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ================================================================== */
/* Expenses with approval workflow                                     */
/* ================================================================== */

export const listExpenses = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const session = await requirePermission(ctx, "finance.view");
    const schoolId = session.schoolId as Id<"schools">;
    let rows = await ctx.db.query("expenses").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    if (status && status !== "all") rows = rows.filter((r) => r.status === status);
    return rows
      .sort((a, b) => (a.expenseNumber < b.expenseNumber ? 1 : -1))
      .slice(0, 500)
      .map((e) => ({
        _id: e._id, expenseNumber: e.expenseNumber, category: e.category, payee: e.payee,
        amount: e.amount, expenseDate: e.expenseDate, description: e.description ?? null,
        status: e.status, rejectionReason: e.rejectionReason ?? null,
      }));
  },
});

export const createExpense = mutation({
  args: {
    category: v.string(),
    payee: v.string(),
    amount: v.number(),
    expenseDate: v.string(),
    description: v.optional(v.string()),
    submitNow: v.optional(v.boolean()),
  },
  handler: async (ctx, { category, payee, amount, expenseDate, description, submitNow }) => {
    const session = await requirePermission(ctx, "expenses.create");
    const schoolId = session.schoolId as Id<"schools">;
    if (!category.trim()) throw new ConvexError("Expense category is required.");
    if (!payee.trim()) throw new ConvexError("Supplier/payee is required.");
    if (!(amount > 0)) throw new ConvexError("Expense amount must be positive.");
    const expenseNumber = await nextNumber(ctx, schoolId, "EXP");
    const id = await ctx.db.insert("expenses", {
      schoolId, expenseNumber, category: category.trim(), payee: payee.trim(),
      amount, expenseDate, description, attachmentId: undefined,
      status: submitNow ? "submitted" : "draft", createdById: session.userId,
      submittedAt: submitNow ? Date.now() : undefined,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "expense.created", entityType: "expenses",
      entityId: id, description: `Expense ${expenseNumber} created (${category.trim()}, ${amount})`,
    });
    return id;
  },
});

export const submitExpense = mutation({
  args: { expenseId: v.id("expenses") },
  handler: async (ctx, { expenseId }) => {
    const session = await requirePermission(ctx, "expenses.create");
    const schoolId = session.schoolId as Id<"schools">;
    const e = await getSchoolRecord(ctx, schoolId, "expenses", expenseId);
    if (e.status !== "draft" && e.status !== "rejected") throw new ConvexError("Only draft or rejected expenses can be submitted.");
    await ctx.db.patch(expenseId, { status: "submitted", submittedAt: Date.now(), updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "expense.submitted", entityType: "expenses",
      entityId: expenseId, description: `Expense ${e.expenseNumber} submitted for approval`,
    });
    return { ok: true };
  },
});

export const approveExpense = mutation({
  args: { expenseId: v.id("expenses"), payNow: v.optional(v.boolean()) },
  handler: async (ctx, { expenseId, payNow }) => {
    const session = await requirePermission(ctx, "expenses.approve");
    const schoolId = session.schoolId as Id<"schools">;
    const e = await getSchoolRecord(ctx, schoolId, "expenses", expenseId);
    // approve: submitted → approved. payNow on an already-approved expense
    // settles it (approved → paid), e.g. the UI's "Mark paid" action.
    if (payNow && e.status === "approved") {
      const txnId = await postLedgerTransaction(ctx, schoolId, session.userId, {
        transactionType: "expense",
        date: e.expenseDate,
        amount: e.amount,
        description: `Expense ${e.expenseNumber} — ${e.payee}`,
        expenseId,
        lines: [
          { code: ACC.EXPENSES_CLEARING, direction: "debit", amount: e.amount },
          { code: ACC.CASH, direction: "credit", amount: e.amount },
        ],
      });
      await ctx.db.patch(expenseId, {
        status: "paid", approvedById: e.approvedById ?? session.userId,
        approvedAt: e.approvedAt ?? Date.now(),
        paidTransactionId: txnId, updatedAt: Date.now(),
      });
      await recordAudit(ctx, {
        userId: session.userId, schoolId, action: "expense.paid", entityType: "expenses",
        entityId: expenseId, description: `Expense ${e.expenseNumber} marked paid and posted to the ledger (${e.amount} to ${e.payee})`,
      });
      return { ok: true };
    }
    if (e.status !== "submitted") throw new ConvexError("Only submitted expenses can be approved.");
    if (payNow) {
      const txnId = await postLedgerTransaction(ctx, schoolId, session.userId, {
        transactionType: "expense",
        date: e.expenseDate,
        amount: e.amount,
        description: `Expense ${e.expenseNumber} — ${e.payee}`,
        expenseId,
        lines: [
          { code: ACC.EXPENSES_CLEARING, direction: "debit", amount: e.amount },
          { code: ACC.CASH, direction: "credit", amount: e.amount },
        ],
      });
      await ctx.db.patch(expenseId, {
        status: "paid", approvedById: session.userId, approvedAt: Date.now(),
        paidTransactionId: txnId, updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(expenseId, {
        status: "approved", approvedById: session.userId, approvedAt: Date.now(), updatedAt: Date.now(),
      });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "expense.approved", entityType: "expenses",
      entityId: expenseId, description: `Expense ${e.expenseNumber} approved${payNow ? " and paid" : ""} (${e.amount} to ${e.payee})`,
    });
    return { ok: true };
  },
});

export const rejectExpense = mutation({
  args: { expenseId: v.id("expenses"), reason: v.string() },
  handler: async (ctx, { expenseId, reason }) => {
    const session = await requirePermission(ctx, "expenses.approve");
    const schoolId = session.schoolId as Id<"schools">;
    const e = await getSchoolRecord(ctx, schoolId, "expenses", expenseId);
    if (e.status !== "submitted") throw new ConvexError("Only submitted expenses can be rejected.");
    if (!reason.trim()) throw new ConvexError("A rejection reason is required.");
    await ctx.db.patch(expenseId, { status: "rejected", rejectionReason: reason, updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "expense.rejected", entityType: "expenses",
      entityId: expenseId, description: `Expense ${e.expenseNumber} rejected: ${reason}`,
    });
    return { ok: true };
  },
});

/* Pay an already-approved expense. Separate step so approver ≠ payer when desired. */
export const payExpense = mutation({
  args: { expenseId: v.id("expenses") },
  handler: async (ctx, { expenseId }) => {
    const session = await requirePermission(ctx, "expenses.approve");
    const schoolId = session.schoolId as Id<"schools">;
    const e = await getSchoolRecord(ctx, schoolId, "expenses", expenseId);
    if (e.status !== "approved") throw new ConvexError("Only approved expenses can be paid.");
    const txnId = await postLedgerTransaction(ctx, schoolId, session.userId, {
      transactionType: "expense",
      date: e.expenseDate,
      amount: e.amount,
      description: `Expense ${e.expenseNumber} — ${e.payee}`,
      expenseId,
      lines: [
        { code: ACC.EXPENSES_CLEARING, direction: "debit", amount: e.amount },
        { code: ACC.CASH, direction: "credit", amount: e.amount },
      ],
    });
    await ctx.db.patch(expenseId, {
      status: "paid", paidTransactionId: txnId, approvedById: session.userId,
      approvedAt: e.approvedAt ?? Date.now(), updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "expense.paid", entityType: "expenses",
      entityId: expenseId, description: `Expense ${e.expenseNumber} paid (${e.amount} to ${e.payee})`,
    });
    return { ok: true, transactionId: txnId };
  },
});

/* ================================================================== */
/* Finance dashboard                                                   */
/* ================================================================== */

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "finance.view");
    const schoolId = session.schoolId as Id<"schools">;

    const invoices = await ctx.db.query("invoices").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const live = invoices.filter((i) => i.status !== "cancelled" && i.status !== "draft");
    const totalBilled = round2(live.reduce((s, i) => s + i.totalAmount, 0));

    const payments = (await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((p) => p.status === "confirmed");
    const totalCollected = round2(payments.reduce((s, p) => s + p.amount, 0));
    const today = new Date().toISOString().slice(0, 10);
    const todayPayments = round2(payments.filter((p) => p.paymentDate === today).reduce((s, p) => s + p.amount, 0));

    const discounts = (await ctx.db.query("discounts").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((d) => d.status === "applied");
    const totalDiscounted = round2(discounts.reduce((s, d) => s + d.computedAmount, 0));

    const outstanding = round2(totalBilled - totalCollected - totalDiscounted);
    const collectionRate = totalBilled > 0 ? round2((totalCollected / totalBilled) * 100) : 0;

    const monthStart = today.slice(0, 8) + "01";
    const expenses = (await ctx.db.query("expenses").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((e) => e.status === "paid" || e.status === "approved");
    const expensesThisMonth = round2(
      expenses.filter((e) => e.expenseDate >= monthStart && e.expenseDate <= today).reduce((s, e) => s + e.amount, 0),
    );
    const pendingExpenseApprovals = (await ctx.db.query("expenses").withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "submitted")).collect()).length;
    const pendingDiscountApprovals = (await ctx.db.query("discounts").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((d) => d.status === "pending").length;

    // Collection trend: last 6 months of confirmed payments.
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const trend = months.map((m) => ({
      month: m,
      collected: round2(payments.filter((p) => p.paymentDate.startsWith(m)).reduce((s, p) => s + p.amount, 0)),
    }));

    // Fee category breakdown from live invoice items.
    const items = await ctx.db.query("invoiceItems").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const byCategory = new Map<string, number>();
    for (const it of items) {
      if (!live.some((i) => i._id === it.invoiceId)) continue;
      byCategory.set(it.category, round2((byCategory.get(it.category) ?? 0) + it.quantity * it.amount));
    }
    const categories = [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    const counts = {
      invoices: live.length,
      paid: live.filter((i) => i.status === "paid").length,
      partiallyPaid: live.filter((i) => i.status === "partially_paid").length,
      overdue: live.filter((i) => i.status === "overdue").length,
      unpaid: live.filter((i) => i.status === "issued").length,
    };

    return {
      totalBilled, totalCollected, totalDiscounted, outstanding, collectionRate,
      todayPayments, expensesThisMonth,
      pendingApprovals: pendingExpenseApprovals + pendingDiscountApprovals,
      trend, categories, counts,
    };
  },
});

/* ================================================================== */
/* Reports                                                             */
/* ================================================================== */

/** Revenue: billed vs collected vs outstanding, optionally by term. */
export const revenueReport = query({
  args: { termId: v.optional(v.id("terms")) },
  handler: async (ctx, { termId }) => {
    const session = await requirePermission(ctx, "financial_reports.view");
    const schoolId = session.schoolId as Id<"schools">;
    let invoices = (await ctx.db.query("invoices").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((i) => i.status !== "cancelled" && i.status !== "draft");
    let payments = (await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((p) => p.status === "confirmed");
    if (termId) {
      await getSchoolRecord(ctx, schoolId, "terms", termId);
      invoices = invoices.filter((i) => i.termId === termId);
      const invoiceIds = new Set(invoices.map((i) => i._id));
      payments = payments.filter((p) => p.invoiceId && invoiceIds.has(p.invoiceId));
    }
    const billed = round2(invoices.reduce((s, i) => s + i.totalAmount, 0));
    const collected = round2(payments.reduce((s, p) => s + p.amount, 0));
    const discounts = (await ctx.db.query("discounts").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((d) => d.status === "applied" && (!termId || invoices.some((i) => i._id === d.invoiceId)));
    const discounted = round2(discounts.reduce((s, d) => s + d.computedAmount, 0));
    return {
      billed, collected, discounted, outstanding: round2(billed - collected - discounted),
      invoiceCount: invoices.length,
      byStatus: ["issued", "partially_paid", "paid", "overdue"].map((status) => ({
        status,
        count: invoices.filter((i) => i.status === status).length,
        amount: round2(invoices.filter((i) => i.status === status).reduce((s, i) => s + i.totalAmount, 0)),
      })),
    };
  },
});

/** Payments by date range + method breakdown + cashier totals. */
export const paymentsReport = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { from, to }) => {
    const session = await requirePermission(ctx, "financial_reports.view");
    const schoolId = session.schoolId as Id<"schools">;
    let payments = (await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((p) => p.status === "confirmed");
    if (from) payments = payments.filter((p) => p.paymentDate >= from);
    if (to) payments = payments.filter((p) => p.paymentDate <= to);
    const byMethod = new Map<string, number>();
    const byCashier = new Map<string, number>();
    for (const p of payments) {
      byMethod.set(p.method, round2((byMethod.get(p.method) ?? 0) + p.amount));
      byCashier.set(p.method, round2((byCashier.get(p.method) ?? 0) + p.amount));
      const receiver = await ctx.db.get(p.receivedById);
      const name = receiver?.name ?? "Unknown";
      byCashier.set(name, round2((byCashier.get(name) ?? 0) + p.amount));
    }
    return {
      total: round2(payments.reduce((s, p) => s + p.amount, 0)),
      count: payments.length,
      byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
      byCashier: [...byCashier.entries()].map(([cashier, amount]) => ({ cashier, amount })).sort((a, b) => b.amount - a.amount),
      recent: payments
        .sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1))
        .slice(0, 50)
        .map((p) => ({ paymentNumber: p.paymentNumber, paymentDate: p.paymentDate, amount: p.amount, method: p.method })),
    };
  },
});

/** Outstanding fees: students with balances (ledger-derived). */
export const outstandingReport = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "financial_reports.view");
    const schoolId = session.schoolId as Id<"schools">;
    const accounts = await ctx.db.query("studentAccounts").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const studentById = new Map(students.map((s) => [s._id, s]));
    const rows: Array<{ studentId: Id<"students">; studentName: string; admissionNumber: string; balance: number }> = [];
    for (const account of accounts) {
      const balance = await studentBalance(ctx, schoolId, account._id);
      if (balance > 0.001) {
        const st = studentById.get(account.studentId);
        rows.push({
          studentId: account.studentId,
          studentName: st ? [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") : "—",
          admissionNumber: st?.admissionNumber ?? "",
          balance,
        });
      }
    }
    rows.sort((a, b) => b.balance - a.balance);
    return {
      studentsWithBalance: rows.length,
      totalOutstanding: round2(rows.reduce((s, r) => s + r.balance, 0)),
      rows: rows.slice(0, 200),
    };
  },
});

/** Expenses by category for a date range. */
export const expenseReport = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { from, to }) => {
    const session = await requirePermission(ctx, "financial_reports.view");
    const schoolId = session.schoolId as Id<"schools">;
    let expenses = await ctx.db.query("expenses").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    expenses = expenses.filter((e) => e.status === "paid" || e.status === "approved");
    if (from) expenses = expenses.filter((e) => e.expenseDate >= from);
    if (to) expenses = expenses.filter((e) => e.expenseDate <= to);
    const byCategory = new Map<string, number>();
    for (const e of expenses) {
      byCategory.set(e.category, round2((byCategory.get(e.category) ?? 0) + e.amount));
    }
    return {
      total: round2(expenses.reduce((s, e) => s + e.amount, 0)),
      count: expenses.length,
      byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    };
  },
});

/** Cash summary: collected − expenses over a period (all payment methods). */
export const cashSummary = query({
  args: { from: v.optional(v.string()), to: v.optional(v.string()) },
  handler: async (ctx, { from, to }) => {
    const session = await requirePermission(ctx, "financial_reports.view");
    const schoolId = session.schoolId as Id<"schools">;
    let payments = (await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((p) => p.status === "confirmed");
    let expenses = (await ctx.db.query("expenses").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((e) => e.status === "paid");
    if (from) {
      payments = payments.filter((p) => p.paymentDate >= from);
      expenses = expenses.filter((e) => e.expenseDate >= from);
    }
    if (to) {
      payments = payments.filter((p) => p.paymentDate <= to);
      expenses = expenses.filter((e) => e.expenseDate <= to);
    }
    const received = round2(payments.reduce((s, p) => s + p.amount, 0));
    const spent = round2(expenses.reduce((s, e) => s + e.amount, 0));
    return {
      received, spent, balance: round2(received - spent),
      paymentCount: payments.length, expenseCount: expenses.length,
    };
  },
});

/** Class-level balances: billed / collected / outstanding per class. */
export const classBalances = query({
  args: { termId: v.optional(v.id("terms")) },
  handler: async (ctx, { termId }) => {
    const session = await requirePermission(ctx, "financial_reports.view");
    const schoolId = session.schoolId as Id<"schools">;
    const invoices = (await ctx.db.query("invoices").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((i) => i.status !== "cancelled" && i.status !== "draft" && (!termId || i.termId === termId));
    const payments = (await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((p) => p.status === "confirmed");
    const discounts = (await ctx.db.query("discounts").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((d) => d.status === "applied");
    const enrollments = (await ctx.db.query("enrollments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((e) => e.status === "active");
    const sections = await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const grades = await ctx.db.query("gradeLevels").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const gradeById = new Map(grades.map((g) => [g._id, g]));
    const sectionLabel = new Map(sections.map((s) => [s._id, `${gradeById.get(s.gradeLevelId)?.name ?? "?"} ${s.streamName}`]));

    // Student → current class (latest active enrollment).
    const studentClass = new Map<string, string>();
    for (const e of enrollments) {
      const label = sectionLabel.get(e.classSectionId);
      if (label) studentClass.set(e.studentId, label);
    }
    const paidByInvoice = new Map<string, number>();
    for (const p of payments) {
      if (!p.invoiceId) continue;
      paidByInvoice.set(p.invoiceId, round2((paidByInvoice.get(p.invoiceId) ?? 0) + p.amount));
    }
    const discByInvoice = new Map<string, number>();
    for (const d of discounts) {
      if (!d.invoiceId) continue;
      discByInvoice.set(d.invoiceId, round2((discByInvoice.get(d.invoiceId) ?? 0) + d.computedAmount));
    }
    const agg = new Map<string, { billed: number; collected: number; discounted: number }>();
    for (const inv of invoices) {
      const label = studentClass.get(inv.studentId) ?? "Unassigned";
      const row = agg.get(label) ?? { billed: 0, collected: 0, discounted: 0 };
      row.billed = round2(row.billed + inv.totalAmount);
      row.collected = round2(row.collected + (paidByInvoice.get(inv._id) ?? 0));
      row.discounted = round2(row.discounted + (discByInvoice.get(inv._id) ?? 0));
      agg.set(label, row);
    }
    return [...agg.entries()]
      .map(([classLabel, r]) => ({
        classLabel, billed: r.billed, collected: r.collected, discounted: r.discounted,
        outstanding: round2(r.billed - r.collected - r.discounted),
      }))
      .sort((a, b) => a.classLabel.localeCompare(b.classLabel));
  },
});

/** Chart-of-accounts trial balance (debits vs credits per account). */
export const trialBalance = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "financial_reports.view");
    const schoolId = session.schoolId as Id<"schools">;
    const accounts = await ctx.db.query("ledgerAccounts").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const entries = await ctx.db.query("ledgerEntries").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const rows = accounts.map((a) => {
      const mine = entries.filter((e) => e.accountId === a._id);
      const debit = round2(mine.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amount, 0));
      const credit = round2(mine.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amount, 0));
      return {
        code: a.code, name: a.name, accountType: a.accountType, debit, credit,
        balance: round2(debit - credit),
      };
    });
    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
    return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.001 };
  },
});
