import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission } from "./session";

export const list = query({
  args: {
    action: v.optional(v.string()),
    paginationOpts: v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) }),
  },
  handler: async (ctx, { action, paginationOpts }) => {
    const session = await requirePermission(ctx, "audit_logs.view");
    const result = await ctx.db
      .query("auditLogs")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .order("desc")
      .paginate(paginationOpts);
    let page = result.page;
    if (action && action !== "all") {
      page = page.filter((l) => l.action === action);
    }
    const enriched = await Promise.all(
      page.map(async (l) => {
        const user = await ctx.db.get(l.userId);
        return {
          _id: l._id,
          _creationTime: l._creationTime,
          action: l.action,
          entityType: l.entityType,
          description: l.description ?? "",
          userName: user?.name ?? user?.email ?? "Unknown",
        };
      }),
    );
    return { ...result, page: enriched };
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const session = await requirePermission(ctx, "dashboard.view");
    const logs = await ctx.db
      .query("auditLogs")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .order("desc")
      .take(limit ?? 8);
    return await Promise.all(
      logs.map(async (l) => {
        const user = await ctx.db.get(l.userId);
        return {
          _id: l._id,
          action: l.action,
          entityType: l.entityType,
          description: l.description ?? "",
          _creationTime: l._creationTime,
          userName: user?.name ?? user?.email ?? "Unknown",
        };
      }),
    );
  },
});
