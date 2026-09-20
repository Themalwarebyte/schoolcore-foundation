import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePlatformSession } from "./session";
import { recordAudit } from "./audit";

/* ------------------------------------------------------------------ */
/* Platform users                                                      */
/* ------------------------------------------------------------------ */

/** Every user with their memberships and school names. Super admin only. */
export const listPlatformUsers = query({
  args: {
    search: v.optional(v.string()),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { search, role, status }) => {
    await requirePlatformSession(ctx);
    const memberships = await ctx.db.query("schoolMemberships").collect();
    const rows = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        if (!user) return null;
        const school = m.schoolId ? await ctx.db.get(m.schoolId) : null;
        return {
          _id: m._id,
          userId: m.userId,
          name: user.name ?? user.email ?? "—",
          email: user.email ?? "—",
          isActive: user.isActive !== false,
          role: m.role,
          schoolId: m.schoolId ?? null,
          schoolName: school?.name ?? null,
        };
      }),
    );
    let filtered = rows.filter(Boolean) as NonNullable<(typeof rows)[number]>[];
    if (role && role !== "all") filtered = filtered.filter((r) => r.role === role);
    if (status === "active") filtered = filtered.filter((r) => r.isActive);
    if (status === "inactive") filtered = filtered.filter((r) => !r.isActive);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
      );
    }
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  },
});

/** Enable/disable any non-platform user. Blocks privilege abuse. */
export const setUserActive = mutation({
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, { userId, isActive }) => {
    const session = await requirePlatformSession(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw new ConvexError("User not found.");
    const targetMemberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (targetMemberships.some((m) => m.role === "super_admin")) {
      throw new ConvexError("Platform administrators cannot be modified.");
    }
    if (userId === session.userId) {
      throw new ConvexError("You cannot disable your own account.");
    }
    await ctx.db.patch(userId, { isActive });
    if (!isActive) {
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", userId))
        .collect();
      for (const s of sessions) await ctx.db.delete(s._id);
    }
    await recordAudit(ctx, {
      userId: session.userId,
      action: isActive ? "user.activated" : "user.disabled",
      entityType: "users",
      entityId: userId,
      description: `${target.email ?? "User"}: ${isActive ? "activated" : "disabled"} at platform level`,
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* Platform activity                                                   */
/* ------------------------------------------------------------------ */

/** Latest audit entries across all schools, enriched with school names. */
export const platformActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requirePlatformSession(ctx);
    const logs = await ctx.db.query("auditLogs").order("desc").take(limit ?? 50);
    return await Promise.all(
      logs.map(async (l) => {
        const user = await ctx.db.get(l.userId);
        const school = l.schoolId ? await ctx.db.get(l.schoolId) : null;
        return {
          _id: l._id,
          _creationTime: l._creationTime,
          action: l.action,
          entityType: l.entityType,
          description: l.description ?? "",
          userName: user?.name ?? user?.email ?? "Unknown",
          schoolName: school?.name ?? "Platform",
        };
      }),
    );
  },
});

/** Convenience count for the activity page header. */
export const platformAuditCount = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformSession(ctx);
    const logs = await ctx.db.query("auditLogs").collect();
    return logs.length;
  },
});
