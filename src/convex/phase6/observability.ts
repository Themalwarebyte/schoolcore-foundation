/**
 * Phase 6 — observability: structured events for backend failures,
 * integration failures, delivery failures and payment callback failures.
 * Frontend errors are captured client-side and reported here.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getSession } from "../session";

export async function recordObservabilityEvent(
  ctx: MutationCtx,
  args: {
    schoolId?: Id<"schools"> | null;
    severity: "info" | "warning" | "error" | "critical";
    component: string;
    message: string;
    details?: unknown;
  },
) {
  return ctx.db.insert("observabilityEvents", {
    schoolId: args.schoolId ?? undefined,
    severity: args.severity,
    component: args.component,
    message: args.message,
    details: args.details ?? undefined,
    createdAt: Date.now(),
  });
}

export const reportFrontendError = mutation({
  args: {
    component: v.string(),
    message: v.string(),
    stack: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Auth optional — anonymous crashes still surface to the platform.
    const session = await getSession(ctx).catch(() => null);
    await recordObservabilityEvent(ctx, {
      schoolId: session?.schoolId,
      severity: "error",
      component: `frontend:${args.component}`,
      message: args.message,
      details: { stack: args.stack?.slice(0, 2000), url: args.url },
    });
    return true;
  },
});

export const errorSummary = query({
  args: {},
  handler: async (ctx) => {
    const session = await getSession(ctx);
    if (!session.isPlatform) throw new ConvexError("Platform access only.");
    const events = await ctx.db
      .query("observabilityEvents")
      .withIndex("by_time", (q) => q)
      .order("desc")
      .take(500);
    const byComponent: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const e of events) {
      byComponent[e.component] = (byComponent[e.component] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    }
    return { totalRecent: events.length, byComponent, bySeverity, latest: events.slice(0, 20) };
  },
});
