/**
 * Phase 6 — scheduled jobs (Convex crons) + the mutation entry points they
 * drive. Uses the platform scheduler; jobs are idempotent and audited.
 *
 * All event dispatch goes through the automation engine
 * (phase6/automations.ts fireEventInternal); there is no event-queue table.
 */
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { fireEvent } from "./automations";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Days between two YYYY-MM-DD strings. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/**
 * De-duplicated dispatch helper: fires an automation trigger for a target at
 * most once per 7-day window by checking recent automationRuns.
 */
async function fireOncePerWeek(
  ctx: MutationCtx,
  args: {
    schoolId: Id<"schools">;
    trigger: string;
    targetKind: string;
    targetId: string;
    context?: Record<string, number>;
  },
): Promise<boolean> {
  const recent = await ctx.db
    .query("automationRuns")
    .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
    .order("desc")
    .take(100);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const alreadyFired = recent.some(
    (run) =>
      run.trigger === args.trigger &&
      run.targetId === args.targetId &&
      run.ranAt > weekAgo,
  );
  if (alreadyFired) return false;
  await fireEvent(ctx, {
    schoolId: args.schoolId,
    trigger: args.trigger,
    targetKind: args.targetKind,
    targetId: args.targetId,
    context: args.context,
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

/** Find overdue invoices and emit invoice_overdue automation events. */
export const detectOverdueInvoices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    // Invoices have no global by-status index (schoolId comes first), so
    // scan and filter — the same shape the platform cron would use.
    const invoices = await ctx.db.query("invoices").collect();
    let emitted = 0;
    for (const inv of invoices) {
      if (inv.status !== "issued" && inv.status !== "partially_paid") continue;
      if (inv.dueDate >= today) continue;
      const fired = await fireOncePerWeek(ctx, {
        schoolId: inv.schoolId,
        trigger: "invoice_overdue",
        targetKind: "invoices",
        targetId: inv._id,
        context: { daysOverdue: daysBetween(inv.dueDate, today) },
      });
      if (fired) emitted++;
    }
    return { scanned: invoices.length, emitted };
  },
});

/** Refresh overdue library loans and emit library_overdue events. */
export const refreshLibraryOverdue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const loans = await ctx.db.query("bookLoans").collect();
    let marked = 0;
    for (const loan of loans) {
      if (loan.status !== "active" || loan.dueDate >= today) continue;
      // bookLoans has no updatedAt field — status-only patch.
      await ctx.db.patch(loan._id, { status: "overdue" });
      const fired = await fireOncePerWeek(ctx, {
        schoolId: loan.schoolId,
        trigger: "library_overdue",
        targetKind: "bookLoans",
        targetId: loan._id,
        context: { daysOverdue: daysBetween(loan.dueDate, today) },
      });
      if (fired) marked++;
    }
    return { scanned: loans.length, marked };
  },
});

/** Notify about contracts expiring within 30 days. */
export const notifyExpiringContracts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const contracts = await ctx.db.query("contracts").collect();
    let notified = 0;
    for (const c of contracts) {
      if (c.status !== "active" || !c.endDate) continue;
      const daysToExpiry = daysBetween(today, c.endDate);
      if (daysToExpiry < 0 || daysToExpiry > 30) continue;
      const fired = await fireOncePerWeek(ctx, {
        schoolId: c.schoolId,
        trigger: "contract_nearing_expiry",
        targetKind: "contracts",
        targetId: c._id,
        context: { daysToExpiry },
      });
      if (fired) notified++;
    }
    return { scanned: contracts.length, notified };
  },
});

/** Emit inventory low-stock (stock_below_threshold) events. */
export const emitStockAlerts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("inventoryItems").collect();
    let emitted = 0;
    for (const item of items) {
      if (item.status !== "active") continue;
      if (item.reorderLevel <= 0 || item.quantity > item.reorderLevel) continue;
      const fired = await fireOncePerWeek(ctx, {
        schoolId: item.schoolId,
        trigger: "stock_below_threshold",
        targetKind: "inventoryItems",
        targetId: item._id,
        context: { quantity: item.quantity, reorderLevel: item.reorderLevel },
      });
      if (fired) emitted++;
    }
    return { scanned: items.length, emitted };
  },
});
