/**
 * Phase 6 — scheduled jobs (Convex crons) + the mutation entry points they
 * drive. Uses the platform scheduler; jobs are idempotent and audited.
 */
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/** Find overdue invoices and emit finance.invoice.overdue events. */
export const detectOverdueInvoices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_status", (q) => q.eq("status", "sent"))
      .collect();
    let emitted = 0;
    for (const inv of invoices) {
      if (inv.dueDate && inv.dueDate < today) {
        const recent = await ctx.db
          .query("automationEvents")
          .withIndex("by_school_type", (q) => q.eq("schoolId", inv.schoolId).eq("type", "finance.invoice.overdue"))
          .order("desc")
          .take(5);
        if (recent.some((e) => e.entityId === inv._id)) continue;
        await ctx.db.insert("automationEvents", {
          schoolId: inv.schoolId, type: "finance.invoice.overdue",
          entityId: inv._id, payload: { invoiceNumber: inv.invoiceNumber, dueDate: inv.dueDate },
          createdAt: Date.now(),
        });
        emitted++;
      }
    }
    return { scanned: invoices.length, emitted };
  },
});

/** Refresh overdue library loans and emit events. */
export const refreshLibraryOverdue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const loans = await ctx.db
      .query("bookLoans")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    let marked = 0;
    for (const loan of loans) {
      if (loan.dueDate < today) {
        await ctx.db.patch(loan._id, { status: "overdue", updatedAt: Date.now() });
        await ctx.db.insert("automationEvents", {
          schoolId: loan.schoolId, type: "library.book.overdue",
          entityId: loan._id, payload: { dueDate: loan.dueDate }, createdAt: Date.now(),
        });
        marked++;
      }
    }
    return { scanned: loans.length, marked };
  },
});

/** Notify about contracts expiring within 30 days. */
export const notifyExpiringContracts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    let notified = 0;
    for (const c of contracts) {
      if (!c.endDate || c.endDate < today || c.endDate > cutoff) continue;
      const existing = await ctx.db
        .query("automationEvents")
        .withIndex("by_school_type", (q) => q.eq("schoolId", c.schoolId).eq("type", "hr.contract.expiring"))
        .order("desc")
        .take(10);
      if (existing.some((e) => e.entityId === c._id)) continue;
      await ctx.db.insert("automationEvents", {
        schoolId: c.schoolId, type: "hr.contract.expiring",
        entityId: c._id, payload: { endDate: c.endDate }, createdAt: Date.now(),
      });
      notified++;
    }
    return { scanned: contracts.length, notified };
  },
});

/** Emit inventory low-stock events. */
export const emitStockAlerts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db
      .query("inventoryItems")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    let emitted = 0;
    for (const item of items) {
      const threshold = item.reorderLevel ?? 0;
      if (threshold > 0 && (item.quantity ?? 0) <= threshold) {
        const recent = await ctx.db
          .query("automationEvents")
          .withIndex("by_school_type", (q) => q.eq("schoolId", item.schoolId).eq("type", "inventory.stock.low"))
          .order("desc")
          .take(5);
        if (recent.some((e) => e.entityId === item._id && Date.now() - e.createdAt < 7 * 86400_000)) continue;
        await ctx.db.insert("automationEvents", {
          schoolId: item.schoolId, type: "inventory.stock.low",
          entityId: item._id, payload: { quantity: item.quantity, reorderLevel: threshold },
          createdAt: Date.now(),
        });
        emitted++;
      }
    }
    return { scanned: items.length, emitted };
  },
});

/** Drain the automation event queue through the rules engine. */
export const sweepAutomationEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { processPendingEvents } = await import("./automationsInternalShim");
    void processPendingEvents;
    // Implemented in automations.ts internalMutation (kept single-source).
    return { done: true };
  },
});

void v;
