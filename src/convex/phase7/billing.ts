/**
 * Phase 7 — fee voteheads, payment allocation engine, reconciliation
 * centre and bank statement imports. Extends Phase 3 finance (does NOT
 * replace it): invoice/payment/ledger engines are reused as-is.
 *
 * Voteheads: school-defined meanings behind fee lines (Tuition, Lunch,
 * Transport…). Invoice lines optionally carry a votehead name; the balance
 * per votehead is derived: Σ lines − Σ allocations, per votehead.
 *
 * Allocation strategies (per school, defaults to votehead_priority):
 *  - votehead_priority → voteheads in their configured priority order
 *  - oldest_first      → oldest unpaid invoice first
 *  - manual            → accountant passes explicit lines
 *
 * Bank import: CSV rows (date,reference,amount,narration) are staged,
 * matched against students (admission number / phone in narration) and
 * posted through the EXISTING finance.recordPayment-compatible engine.
 * Every posting and allocation is audited (§26).
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requirePermission, getSchoolRecord } from "../session";
import { recordAudit } from "../audit";
import { ALLOCATION_STRATEGIES, BANK_IMPORT_STATUSES } from "../schema";

const round2 = (n: number) => Math.round(n * 100) / 100;
const normPhone = (p: string) => p.replace(/[\s-()]/g, "");

/* ================================================================== */
/* Fee voteheads                                                       */
/* ================================================================== */

export const listVoteheads = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "finance.view");
    const schoolId = session.schoolId as Id<"schools">;
    const rows = await ctx.db.query("feeVoteheads").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    return rows.sort((a, b) => a.allocationPriority - b.allocationPriority || a.name.localeCompare(b.name));
  },
});

/** Creates (or returns) a votehead. Used by UI + seed. */
export const upsertVotehead = mutation({
  args: {
    name: v.string(),
    code: v.optional(v.string()),
    description: v.optional(v.string()),
    allocationPriority: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, { name, code, description, allocationPriority, active }) => {
    const session = await requirePermission(ctx, "billing.voteheads.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Votehead name is required.");
    const existingRows = await ctx.db.query("feeVoteheads").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const existing = existingRows.find((r) => r.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      await ctx.db.patch(existing._id, {
        description: description ?? existing.description,
        allocationPriority: allocationPriority ?? existing.allocationPriority,
        active: active ?? existing.active,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    const finalCode = (code?.trim() || trimmed.slice(0, 3).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase()).toUpperCase();
    const clash = await ctx.db.query("feeVoteheads").withIndex("by_school_code", (q) => q.eq("schoolId", schoolId).eq("code", finalCode)).first();
    const id = await ctx.db.insert("feeVoteheads", {
      schoolId, name: trimmed,
      code: clash ? `${finalCode}2` : finalCode,
      description: description?.trim() || undefined,
      allocationPriority: allocationPriority ?? existingRows.length + 1,
      active: active ?? true,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "billing.votehead_added",
      entityType: "feeVoteheads", entityId: id,
      description: `Fee votehead "${trimmed}" added`,
    });
    return id;
  },
});

/** Link (or relink) a fee item to a votehead. */
export const linkFeeItemVotehead = mutation({
  args: { feeItemId: v.id("feeItems"), voteheadId: v.id("feeVoteheads") },
  handler: async (ctx, { feeItemId, voteheadId }) => {
    const session = await requirePermission(ctx, "billing.voteheads.manage");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "feeItems", feeItemId);
    await getSchoolRecord(ctx, schoolId, "feeVoteheads", voteheadId);
    const existing = await ctx.db.query("feeItemVoteheads").withIndex("by_fee_item", (q) => q.eq("feeItemId", feeItemId)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { voteheadId });
      return existing._id;
    }
    return ctx.db.insert("feeItemVoteheads", { schoolId, feeItemId, voteheadId });
  },
});

/* ================================================================== */
/* Votehead breakdown for an invoice (billing display)                 */
/* ================================================================== */

export interface VoteheadLine { voteheadName: string; voteheadId: Id<"feeVoteheads"> | null; billed: number; allocated: number; balance: number }

/**
 * Derived per-votehead balances for an invoice. Lines without a known
 * votehead bucket into "(Unassigned)". Allocations = Σ paymentAllocations.
 */
export async function invoiceVoteheadBreakdown(
  ctx: import("../_generated/server").QueryCtx | import("../_generated/server").MutationCtx,
  schoolId: Id<"schools">,
  invoiceId: Id<"invoices">,
): Promise<VoteheadLine[]> {
  const items = await ctx.db.query("invoiceItems").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect();
  const allocations = await ctx.db.query("paymentAllocations").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId)).collect();
  // Resolve votehead names for item categories: a fee category may map to a
  // differently-named votehead (e.g. category "Meals" → votehead "Lunch").
  const voteheads = await ctx.db.query("feeVoteheads").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  const ALIASES: Record<string, string> = {
    meals: "Lunch", meal: "Lunch", lunch: "Lunch",
    tuition: "Tuition", transport: "Transport", boarding: "Boarding",
    activity: "Activity", examination: "Examination", uniform: "Uniform",
    milk: "Milk", snack: "Snack", swimming: "Swimming", infrastructure: "Infrastructure",
    other: "(Unassigned)", "": "(Unassigned)",
  };
  const resolveName = (raw: string): string => {
    const key = raw.trim().toLowerCase();
    const alias = ALIASES[key];
    if (alias) {
      // Prefer an actual configured votehead with that name.
      const vh = voteheads.find((v) => v.name.toLowerCase() === alias.toLowerCase());
      return vh ? vh.name : alias;
    }
    const vh = voteheads.find((v) => v.name.toLowerCase() === key);
    return vh ? vh.name : (raw.trim() || "(Unassigned)");
  };
  const map = new Map<string, VoteheadLine>();
  for (const item of items) {
    const key = resolveName(item.category ?? "");
    const line = map.get(key) ?? { voteheadName: key, voteheadId: null, billed: 0, allocated: 0, balance: 0 };
    line.billed = round2(line.billed + item.quantity * item.amount);
    map.set(key, line);
  }
  for (const a of allocations) {
    const line = map.get(a.voteheadName) ?? { voteheadName: a.voteheadName, voteheadId: a.voteheadId ?? null, billed: 0, allocated: 0, balance: 0 };
    line.allocated = round2(line.allocated + a.amount);
    line.voteheadId = a.voteheadId ?? line.voteheadId;
    map.set(a.voteheadName, line);
  }
  return [...map.values()]
    .map((l) => ({ ...l, balance: round2(l.billed - l.allocated) }))
    .sort((a, b) => b.billed - a.billed);
}

export const invoiceBreakdown = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "invoices", invoiceId);
    const lines = await invoiceVoteheadBreakdown(ctx, schoolId, invoiceId);
    return { lines };
  },
});

/* ================================================================== */
/* Allocation settings                                                 */
/* ================================================================== */

export const getAllocationSettings = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "finance.view");
    const schoolId = session.schoolId as Id<"schools">;
    const row = await ctx.db.query("allocationSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).first();
    return { strategy: row?.strategy ?? "votehead_priority" };
  },
});

export const setAllocationStrategy = mutation({
  args: { strategy: v.string() },
  handler: async (ctx, { strategy }) => {
    const session = await requirePermission(ctx, "payments.allocate");
    const schoolId = session.schoolId as Id<"schools">;
    if (!ALLOCATION_STRATEGIES.includes(strategy as never)) throw new ConvexError("Unknown allocation strategy.");
    const row = await ctx.db.query("allocationSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).first();
    if (row) {
      await ctx.db.patch(row._id, { strategy, updatedAt: Date.now(), updatedById: session.userId });
    } else {
      await ctx.db.insert("allocationSettings", { schoolId, strategy, updatedAt: Date.now(), updatedById: session.userId });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payments.allocation_strategy_changed",
      entityType: "allocationSettings",
      description: `Allocation strategy set to ${strategy}`,
    });
    return { ok: true as const };
  },
});

/* ================================================================== */
/* Allocation engine                                                   */
/* ================================================================== */

interface AllocationTarget { invoiceId: Id<"invoices">; voteheadName: string; voteheadId: Id<"feeVoteheads"> | null; remaining: number }

/**
 * Compute an allocation plan for a payment. Strategy rules:
 *  - votehead_priority: invoice lines of the LATEST invoice by votehead
 *    priority order; then older invoices (oldest balance first inside).
 *  - oldest_first: strictly by issue date across all unpaid invoices.
 *  - manual: caller-provided lines (validated against balances).
 */
export async function computeAllocationPlan(
  ctx: import("../_generated/server").MutationCtx,
  schoolId: Id<"schools">,
  paymentId: Id<"payments">,
  amount: number,
): Promise<Array<{ invoiceId: Id<"invoices">; voteheadName: string; voteheadId: Id<"feeVoteheads"> | null; amount: number }>> {
  const settings = await ctx.db.query("allocationSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).first();
  const strategy = settings?.strategy ?? "votehead_priority";
  const payment = await ctx.db.get(paymentId);
  if (!payment) throw new ConvexError("Payment not found.");

  // All open (non-cancelled) invoices for the student, oldest first.
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_student", (q) => q.eq("studentId", payment.studentId))
    .collect()
    .then((rows) =>
      rows
        .filter((r) => r.schoolId === schoolId && r.status !== "cancelled" && r.status !== "draft")
        .sort((a, b) => (a.issueDate < b.issueDate ? -1 : 1)),
    );

  // Live remaining balance per invoice (paid/discounted from the finance tables).
  const targets: AllocationTarget[] = [];
  for (const inv of invoices) {
    const livePayments = await ctx.db
      .query("payments")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id))
      .collect()
      .then((ps) => ps.filter((p) => p.status !== "reversed" && p._id !== paymentId));
    const liveDiscounts = await ctx.db
      .query("discounts")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id))
      .collect()
      .then((ds) => ds.filter((d) => d.status === "applied"));
    const settled = livePayments.reduce((s, p) => s + p.amount, 0) + liveDiscounts.reduce((s, d) => s + d.computedAmount, 0);
    const invoiceRemaining = round2(inv.totalAmount - settled);
    if (invoiceRemaining <= 0) continue;

    const breakdown = await invoiceVoteheadBreakdown(ctx, schoolId, inv._id);
    for (const b of breakdown) {
      const bRemaining = round2(b.balance - (b.allocated === 0 ? 0 : 0));
      if (bRemaining > 0) {
        targets.push({ invoiceId: inv._id, voteheadName: b.voteheadName, voteheadId: b.voteheadId, remaining: bRemaining });
      }
    }
    // If the breakdown has no lines at all (legacy invoice), fall back to a
    // single unassigned bucket for the whole invoice remaining.
    if (breakdown.length === 0) {
      targets.push({ invoiceId: inv._id, voteheadName: "(Unassigned)", voteheadId: null, remaining: invoiceRemaining });
    }
  }

  const voteheads = await ctx.db.query("feeVoteheads").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  const priority = new Map(voteheads.map((vh) => [vh.name, vh.allocationPriority]));

  if (strategy === "votehead_priority") {
    targets.sort((a, b) => (priority.get(a.voteheadName) ?? 999) - (priority.get(b.voteheadName) ?? 999));
  } // oldest_first keeps the invoice-date order above.

  let remainingAmount = amount;
  const plan: Array<{ invoiceId: Id<"invoices">; voteheadName: string; voteheadId: Id<"feeVoteheads"> | null; amount: number }> = [];
  for (const t of targets) {
    if (remainingAmount <= 0) break;
    const alloc = round2(Math.min(remainingAmount, t.remaining));
    if (alloc <= 0) continue;
    plan.push({ invoiceId: t.invoiceId, voteheadName: t.voteheadName, voteheadId: t.voteheadId, amount: alloc });
    remainingAmount = round2(remainingAmount - alloc);
  }
  // Surplus beyond all invoice balances stays unallocated (credit note
  // territory) — surfaced by the reconciliation centre, never silently lost.
  return plan;
}

/** Post an allocation plan as paymentAllocations rows (audited). */
async function postAllocations(
  ctx: import("../_generated/server").MutationCtx,
  session: { userId: Id<"users"> },
  schoolId: Id<"schools">,
  paymentId: Id<"payments">,
  plan: Array<{ invoiceId: Id<"invoices">; voteheadName: string; voteheadId: Id<"feeVoteheads"> | null; amount: number }>,
  strategy: string,
) {
  let total = 0;
  for (const line of plan) {
    if (!(line.amount > 0)) continue;
    await ctx.db.insert("paymentAllocations", {
      schoolId, paymentId, invoiceId: line.invoiceId,
      voteheadId: line.voteheadId ?? undefined, voteheadName: line.voteheadName,
      amount: line.amount, allocatedById: session.userId, allocatedAt: Date.now(), strategy,
    });
    total = round2(total + line.amount);
  }
  return total;
}

/**
 * Auto-allocate a payment per the school's strategy. Called after any
 * payment is recorded (or re-run by an accountant from the centre).
 */
export const allocatePayment = mutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const session = await requirePermission(ctx, "payments.allocate");
    const schoolId = session.schoolId as Id<"schools">;
    const payment = await getSchoolRecord(ctx, schoolId, "payments", paymentId);
    if (payment.status === "reversed") throw new ConvexError("Cannot allocate a reversed payment.");
    const existing = await ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentId", paymentId)).collect();
    if (existing.length > 0) throw new ConvexError("This payment already has allocations — clear them first for re-allocation.");
    const plan = await computeAllocationPlan(ctx, schoolId, paymentId, payment.amount);
    const settings = await ctx.db.query("allocationSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).first();
    const strategy = settings?.strategy ?? "votehead_priority";
    const total = await postAllocations(ctx, session, schoolId, paymentId, plan, strategy);
    const paymentNumber = payment.paymentNumber;
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payments.allocated",
      entityType: "payments", entityId: paymentId,
      description: `Allocated ${total} of payment ${paymentNumber} (${strategy}) across ${plan.length} line(s)`,
    });
    return { allocated: total, unallocated: round2(payment.amount - total), lines: plan.length, strategy };
  },
});

/** Accountant manual allocation (explicit lines). */
export const allocateManually = mutation({
  args: {
    paymentId: v.id("payments"),
    lines: v.array(v.object({
      invoiceId: v.id("invoices"),
      voteheadName: v.string(),
      amount: v.number(),
    })),
  },
  handler: async (ctx, { paymentId, lines }) => {
    const session = await requirePermission(ctx, "payments.allocate");
    const schoolId = session.schoolId as Id<"schools">;
    const payment = await getSchoolRecord(ctx, schoolId, "payments", paymentId);
    if (payment.status === "reversed") throw new ConvexError("Cannot allocate a reversed payment.");
    const existing = await ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentId", paymentId)).collect();
    if (existing.length > 0) throw new ConvexError("This payment already has allocations.");
    if (lines.length === 0) throw new ConvexError("Provide at least one allocation line.");
    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    if (total > payment.amount + 0.001) {
      throw new ConvexError(`Allocation total (${total}) exceeds the payment amount (${payment.amount}).`);
    }
    // Validate balances per votehead.
    const voteheads = await ctx.db.query("feeVoteheads").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    for (const line of lines) {
      await getSchoolRecord(ctx, schoolId, "invoices", line.invoiceId);
      if (!(line.amount > 0)) throw new ConvexError("Allocation amounts must be positive.");
      const vh = voteheads.find((v) => v.name.toLowerCase() === line.voteheadName.toLowerCase());
      const breakdown = await invoiceVoteheadBreakdown(ctx, schoolId, line.invoiceId);
      const bucket = breakdown.find((b) => b.voteheadName.toLowerCase() === line.voteheadName.toLowerCase());
      const billed = bucket?.billed ?? 0;
      if (billed <= 0 && line.voteheadName !== "(Unassigned)") {
        throw new ConvexError(`Invoice has no "${line.voteheadName}" charges. Votehead "${vh?.name ?? line.voteheadName}" is not billed on this invoice.`);
      }
    }
    await postAllocations(
      ctx, session, schoolId, paymentId,
      lines.map((l) => ({
        invoiceId: l.invoiceId,
        voteheadName: l.voteheadName,
        voteheadId: voteheads.find((v) => v.name.toLowerCase() === l.voteheadName.toLowerCase())?._id ?? null,
        amount: l.amount,
      })),
      "manual",
    );
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payments.manually_allocated",
      entityType: "payments", entityId: paymentId,
      description: `Manually allocated ${total} of payment ${payment.paymentNumber} across ${lines.length} line(s)`,
    });
    return { allocated: total, unallocated: round2(payment.amount - total) };
  },
});

/** Clear allocations (for re-allocation); audited. */
export const clearAllocations = mutation({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const session = await requirePermission(ctx, "payments.allocate");
    const schoolId = session.schoolId as Id<"schools">;
    const payment = await getSchoolRecord(ctx, schoolId, "payments", paymentId);
    const existing = await ctx.db.query("paymentAllocations").withIndex("by_payment", (q) => q.eq("paymentId", paymentId)).collect();
    for (const row of existing) await ctx.db.delete(row._id);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payments.allocations_cleared",
      entityType: "payments", entityId: paymentId,
      description: `Cleared ${existing.length} allocation(s) on payment ${payment.paymentNumber} for re-allocation`,
    });
    return { cleared: existing.length };
  },
});

/* ================================================================== */
/* Reconciliation centre                                               */
/* ================================================================== */

export const reconciliationOverview = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "payments.reconcile");
    const schoolId = session.schoolId as Id<"schools">;
    const payments = await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const active = payments.filter((p) => p.status !== "reversed");
    const allocations = await ctx.db.query("paymentAllocations").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const allocatedByPayment = new Map<Id<"payments">, number>();
    for (const a of allocations) {
      allocatedByPayment.set(a.paymentId, round2((allocatedByPayment.get(a.paymentId) ?? 0) + a.amount));
    }
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const nameOf = new Map(students.map((s) => [s._id, `${s.firstName} ${s.lastName}`]));

    const rows = active
      .sort((a, b) => (a.paymentDate < b.paymentDate ? 1 : -1))
      .slice(0, 300)
      .map((p) => {
        const allocated = allocatedByPayment.get(p._id) ?? 0;
        const unallocated = round2(p.amount - allocated);
        const status = allocated <= 0 ? "unallocated" : unallocated > 0.001 ? "partially_allocated" : "allocated";
        return {
          _id: p._id,
          paymentNumber: p.paymentNumber,
          studentName: nameOf.get(p.studentId) ?? "—",
          amount: p.amount,
          paymentDate: p.paymentDate,
          method: p.method,
          referenceNumber: p.referenceNumber ?? null,
          invoiceId: p.invoiceId ?? null,
          allocated: round2(allocated),
          unallocated,
          status,
        };
      });

    // Provider transactions (external money-in) pending match.
    const providerTxns = await ctx.db
      .query("providerTransactions")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((rs) => rs.filter((r) => !r.matchedPaymentId).slice(0, 100));

    return {
      payments: rows,
      summary: {
        totalReceived: round2(active.reduce((s, p) => s + p.amount, 0)),
        allocated: round2(active.reduce((s, p) => s + (allocatedByPayment.get(p._id) ?? 0), 0)),
        unallocated: round2(active.reduce((s, p) => s + (p.amount - (allocatedByPayment.get(p._id) ?? 0)), 0)),
        unallocatedCount: rows.filter((r) => r.status !== "allocated").length,
        providerPending: providerTxns.length,
      },
      providerTransactions: providerTxns.map((t) => ({
        _id: t._id, account: t.account, providerTxnId: t.providerTxnId,
        amount: t.amount, status: t.status, receivedAt: t.receivedAt,
      })),
    };
  },
});

/** Replaces the Phase 6 stub: real reconciliation list. */
export const reconciliationList = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "payments_external.reconcile");
    const schoolId = session.schoolId as Id<"schools">;
    const rows = await ctx.db
      .query("providerTransactions")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return rows
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, 200)
      .map((r) => ({
        _id: r._id, account: r.account, providerTxnId: r.providerTxnId,
        amount: r.amount, status: r.status, matchedPaymentId: r.matchedPaymentId ?? null,
        receivedAt: r.receivedAt,
      }));
  },
});

/** Allocation audit trail for one payment (§26). */
export const paymentAllocationTrail = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const session = await requirePermission(ctx, "payments.reconcile");
    const schoolId = session.schoolId as Id<"schools">;
    const payment = await getSchoolRecord(ctx, schoolId, "payments", paymentId);
    const allocations = await ctx.db
      .query("paymentAllocations")
      .withIndex("by_payment", (q) => q.eq("paymentId", paymentId))
      .collect();
    const student = await ctx.db.get(payment.studentId);
    const allocatorNames = new Map<string, string>();
    const out = [];
    for (const a of allocations.sort((x, y) => x.allocatedAt - y.allocatedAt)) {
      if (!allocatorNames.has(a.allocatedById)) {
        allocatorNames.set(a.allocatedById, (await ctx.db.get(a.allocatedById))?.name ?? "—");
      }
      out.push({
        _id: a._id,
        invoiceId: a.invoiceId,
        voteheadName: a.voteheadName,
        amount: a.amount,
        strategy: a.strategy,
        allocatedAt: a.allocatedAt,
        allocatedBy: allocatorNames.get(a.allocatedById) ?? "—",
      });
    }
    return {
      payment: {
        paymentNumber: payment.paymentNumber,
        amount: payment.amount,
        paymentDate: payment.paymentDate,
        method: payment.method,
        referenceNumber: payment.referenceNumber ?? null,
        status: payment.status,
      },
      student: student ? { name: `${student.firstName} ${student.lastName}`, admissionNumber: student.admissionNumber } : null,
      allocations: out,
    };
  },
});

/* ================================================================== */
/* Bank statement import                                               */
/* ================================================================== */

export type BankRowInput = { date: string; reference: string; amount: number; narration?: string };

/** Stage a bank statement: rows are stored with an auto-match attempt. */
export const stageBankImport = mutation({
  args: { filename: v.string(), bankReference: v.optional(v.string()), rows: v.array(v.object({
    date: v.string(),
    reference: v.string(),
    amount: v.number(),
    narration: v.optional(v.string()),
  })) },
  handler: async (ctx, { filename, bankReference, rows }) => {
    const session = await requirePermission(ctx, "bank_imports.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (rows.length === 0) throw new ConvexError("The statement has no rows.");
    for (const r of rows) {
      if (!r.date.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(r.date.trim())) {
        throw new ConvexError(`Row date must be YYYY-MM-DD (got "${r.date}").`);
      }
      if (!r.reference.trim()) throw new ConvexError("Every row needs a reference.");
      if (!(r.amount > 0)) throw new ConvexError(`Row ${r.reference}: amount must be positive.`);
    }

    const batchId = await ctx.db.insert("bankImportBatches", {
      schoolId, filename, bankReference, rowCount: rows.length,
      status: "draft", createdById: session.userId, createdAt: Date.now(),
    });

    // Duplicate detection: references already used by a payment.
    const payments = await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const usedRefs = new Set(payments.filter((p) => p.status !== "reversed" && p.referenceNumber).map((p) => p.referenceNumber!));
    // In-batch duplicates too.
    const inBatch = new Set<string>();

    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const admissionSet = new Map(students.map((s) => [s.admissionNumber.toLowerCase(), s._id]));
    const guardians = await ctx.db.query("guardians").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const phoneSet = new Map(guardians.filter((g) => g.phone).map((g) => [normPhone(g.phone!), g._id]));

    let matched = 0, duplicates = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ref = r.reference.trim();
      const narration = r.narration?.trim() ?? "";
      const duplicate = usedRefs.has(ref) || inBatch.has(ref);
      if (duplicate) duplicates++;
      inBatch.add(ref);

      // Match: admission number in reference or narration, else guardian phone.
      let candidateStudentId: Id<"students"> | undefined;
      let matchBasis: string | undefined;
      const lowerRef = ref.toLowerCase();
      const lowerNar = narration.toLowerCase();
      for (const [adm, sid] of admissionSet) {
        if (lowerRef.includes(adm) || lowerNar.includes(adm)) {
          candidateStudentId = sid; matchBasis = "admission_number"; break;
        }
      }
      if (!candidateStudentId) {
        const digits = narration.replace(/\D+/g, "");
        for (const [phone] of phoneSet) {
          if (digits.endsWith(phone.slice(-9)) && phone.length >= 9) {
            const gid = phoneSet.get(phone)!;
            const link = await ctx.db
              .query("guardianStudents")
              .withIndex("by_guardian", (q) => q.eq("guardianId", gid))
              .first();
            if (link) { candidateStudentId = link.studentId; matchBasis = "guardian_phone"; }
            break;
          }
        }
      }

      let candidateInvoiceId: Id<"invoices"> | undefined;
      if (candidateStudentId) {
        const openInvoices = await ctx.db
          .query("invoices")
          .withIndex("by_student", (q) => q.eq("studentId", candidateStudentId!))
          .collect()
          .then((rs) => rs.filter((x) => x.schoolId === schoolId && ["issued", "partially_paid", "overdue"].includes(x.status))
            .sort((a, b) => (a.issueDate < b.issueDate ? -1 : 1)));
        candidateInvoiceId = openInvoices[0]?._id;
      }

      await ctx.db.insert("bankImportRows", {
        schoolId, batchId, lineNo: i + 1, date: r.date.trim(), reference: ref,
        amount: r.amount, narration: narration || undefined,
        candidateStudentId, candidateInvoiceId, matchBasis, duplicate,
        status: "draft",
      });
      if (candidateStudentId) matched++;
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "bank_import.staged",
      entityType: "bankImportBatches", entityId: batchId,
      description: `Bank statement "${filename}" staged: ${rows.length} rows, ${matched} auto-matched, ${duplicates} duplicate reference(s)`,
    });
    return { batchId, rowCount: rows.length, matched, duplicates };
  },
});

export const listBankImportBatches = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "bank_imports.view");
    const schoolId = session.schoolId as Id<"schools">;
    const rows = await ctx.db.query("bankImportBatches").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).map((r) => ({
      _id: r._id, filename: r.filename, bankReference: r.bankReference ?? null,
      rowCount: r.rowCount, status: r.status, createdAt: r.createdAt,
    }));
  },
});

export const bankImportRows = query({
  args: { batchId: v.id("bankImportBatches") },
  handler: async (ctx, { batchId }) => {
    const session = await requirePermission(ctx, "bank_imports.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "bankImportBatches", batchId);
    const rows = await ctx.db.query("bankImportRows").withIndex("by_batch", (q) => q.eq("batchId", batchId)).collect();
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const nameOf = new Map(students.map((s) => [s._id, `${s.firstName} ${s.lastName}`]));
    return rows.sort((a, b) => a.lineNo - b.lineNo).map((r) => ({
      _id: r._id, lineNo: r.lineNo, date: r.date, reference: r.reference,
      amount: r.amount, narration: r.narration ?? null,
      candidateStudentId: r.candidateStudentId ?? null,
      candidateStudentName: r.candidateStudentId ? nameOf.get(r.candidateStudentId) ?? null : null,
      candidateInvoiceId: r.candidateInvoiceId ?? null,
      matchBasis: r.matchBasis ?? null,
      duplicate: r.duplicate,
      status: r.status,
      paymentId: r.paymentId ?? null,
      discardReason: r.discardReason ?? null,
    }));
  },
});

/** Fix a row's match before posting. */
export const setBankRowMatch = mutation({
  args: { rowId: v.id("bankImportRows"), studentId: v.optional(v.id("students")) },
  handler: async (ctx, { rowId, studentId }) => {
    const session = await requirePermission(ctx, "bank_imports.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const row = await getSchoolRecord(ctx, schoolId, "bankImportRows", rowId);
    if (row.status !== "draft") throw new ConvexError("Only draft rows can be re-matched.");
    let candidateInvoiceId: Id<"invoices"> | undefined;
    if (studentId) {
      await getSchoolRecord(ctx, schoolId, "students", studentId);
      const open = await ctx.db
        .query("invoices")
        .withIndex("by_student", (q) => q.eq("studentId", studentId))
        .collect()
        .then((rs) => rs.filter((x) => x.schoolId === schoolId && ["issued", "partially_paid", "overdue"].includes(x.status))
          .sort((a, b) => (a.issueDate < b.issueDate ? -1 : 1)));
      candidateInvoiceId = open[0]?._id;
    }
    await ctx.db.patch(rowId, {
      candidateStudentId: studentId, candidateInvoiceId,
      matchBasis: studentId ? "manual" : undefined,
    });
    void row;
    return { ok: true as const };
  },
});

/** Confirm + post matched rows through the real payment engine. */
export const postBankRows = mutation({
  args: {
    rowIds: v.array(v.id("bankImportRows")),
    method: v.optional(v.string()),
  },
  handler: async (ctx, { rowIds, method }) => {
    const session = await requirePermission(ctx, "bank_imports.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (rowIds.length === 0) throw new ConvexError("Select at least one row to post.");
    const { recordPaymentInternal } = await import("./bankPosting");
    let posted = 0, skipped = 0;
    const errors: string[] = [];
    for (const rowId of rowIds) {
      const row = await getSchoolRecord(ctx, schoolId, "bankImportRows", rowId);
      if (row.status !== "draft") { skipped++; continue; }
      if (row.duplicate) { skipped++; continue; }
      if (!row.candidateStudentId) { skipped++; continue; }
      try {
        const result = await recordPaymentInternal(ctx, {
          schoolId,
          userId: session.userId,
          studentId: row.candidateStudentId,
          invoiceId: row.candidateInvoiceId,
          amount: row.amount,
          method: method ?? "bank_transfer",
          referenceNumber: row.reference,
          notes: `Bank import: ${row.narration ?? row.reference}`,
        });
        await ctx.db.patch(rowId, {
          status: "posted", paymentId: result.paymentId,
          postedAt: Date.now(), postedById: session.userId,
        });
        posted++;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Posting failed";
        errors.push(`Row ${row.lineNo} (${row.reference}): ${message}`);
        await ctx.db.patch(rowId, { status: "draft", discardReason: message });
      }
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "bank_import.posted",
      entityType: "bankImportRows",
      description: `Bank import posting: ${posted} posted, ${skipped} skipped, ${errors.length} error(s)`,
    });
    return { posted, skipped, errors };
  },
});

/** Discard a row (unmatchable / test transaction). */
export const discardBankRow = mutation({
  args: { rowId: v.id("bankImportRows"), reason: v.string() },
  handler: async (ctx, { rowId, reason }) => {
    const session = await requirePermission(ctx, "bank_imports.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const row = await getSchoolRecord(ctx, schoolId, "bankImportRows", rowId);
    if (row.status !== "draft") throw new ConvexError("Only draft rows can be discarded.");
    if (!reason.trim()) throw new ConvexError("A discard reason is required.");
    await ctx.db.patch(rowId, { status: "discarded", discardReason: reason.trim() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "bank_import.row_discarded",
      entityType: "bankImportRows", entityId: rowId,
      description: `Bank row ${row.reference} discarded: ${reason.trim()}`,
    });
    return { ok: true as const };
  },
});

/** Complete a batch (marks it matched once reviewed). */
export const finalizeBatch = mutation({
  args: { batchId: v.id("bankImportBatches") },
  handler: async (ctx, { batchId }) => {
    const session = await requirePermission(ctx, "bank_imports.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const batch = await getSchoolRecord(ctx, schoolId, "bankImportBatches", batchId);
    const rows = await ctx.db.query("bankImportRows").withIndex("by_batch", (q) => q.eq("batchId", batchId)).collect();
    const pending = rows.filter((r) => r.status === "draft").length;
    if (pending > 0) {
      throw new ConvexError(`${pending} row(s) are still unposted — post or discard them first.`);
    }
    await ctx.db.patch(batchId, { status: "posted" });
    void batch;
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "bank_import.finalized",
      entityType: "bankImportBatches", entityId: batchId,
      description: `Bank import batch finalized (${rows.length} rows processed)`,
    });
    return { ok: true as const };
  },
});

void BANK_IMPORT_STATUSES;
