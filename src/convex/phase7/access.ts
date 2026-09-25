/**
 * Phase 7 — access management dashboard.
 *
 * Platform view (super admin): every user + membership + role + status +
 * last-login-style session presence + permission counts. Tenant-safe:
 * school admins get their OWN school's roster only, without platform rows.
 * Also exposes the effective permission matrix per role for review.
 */
import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getSession, requirePermission } from "../session";
import { ROLE_PERMISSIONS, type Role } from "../schema";

/** Last session timestamp per user (presence proxy for "last login"). */
async function lastSessionAt(
  ctx: import("../_generated/server").QueryCtx,
  userId: Id<"users">,
): Promise<number | null> {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  return sessions.reduce<number | null>((max, s) => Math.max(max ?? 0, s._creationTime), null);
}

export const accessOverview = query({
  args: { schoolId: v.optional(v.id("schools")) },
  handler: async (ctx, { schoolId }) => {
    const session = await requirePermission(ctx, "users.view", { schoolId });
    const isPlatform = session.isPlatform;
    const scopeSchoolId = isPlatform ? (schoolId ?? null) : (session.schoolId as Id<"schools"> | null);

    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex(scopeSchoolId ? "by_school" : "by_user", (q) =>
        scopeSchoolId ? q.eq("schoolId", scopeSchoolId) : q,
      )
      .collect();

    const users = await ctx.db.query("users").collect();
    const userById = new Map(users.map((u) => [u._id, u]));
    const schools = await ctx.db.query("schools").collect();
    const schoolName = new Map(schools.map((s) => [s._id, s.name]));

    const rows = [];
    for (const m of memberships) {
      const user = userById.get(m.userId);
      if (!user) continue;
      const staffLink = await ctx.db
        .query("staff")
        .withIndex("by_user", (q) => q.eq("userId", m.userId))
        .first();
      const lastLogin = await lastSessionAt(ctx, m.userId);
      const role = m.role as Role;
      rows.push({
        membershipId: m._id,
        userId: m.userId,
        name: user.name ?? user.email ?? "—",
        email: user.email ?? "—",
        role,
        roleLabel: role.replace(/_/g, " "),
        permissionCount: (ROLE_PERMISSIONS[role] ?? []).length,
        isActive: user.isActive !== false,
        membershipStatus: m.status,
        schoolId: m.schoolId ?? null,
        schoolName: m.schoolId ? schoolName.get(m.schoolId) ?? "—" : "(platform)",
        staffName: staffLink ? `${staffLink.firstName} ${staffLink.lastName}` : null,
        lastLoginAt: lastLogin,
        inactiveDays: lastLogin ? Math.floor((Date.now() - lastLogin) / 86_400_000) : null,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return {
      scope: isPlatform ? (scopeSchoolId ? "school" : "platform") : "school",
      users: rows,
      summary: {
        total: rows.length,
        active: rows.filter((r) => r.isActive && r.membershipStatus === "active").length,
        inactive: rows.filter((r) => !r.isActive || r.membershipStatus !== "active").length,
        neverLoggedIn: rows.filter((r) => r.lastLoginAt === null).length,
        dormant30d: rows.filter((r) => r.lastLoginAt !== null && (r.inactiveDays ?? 0) > 30).length,
      },
    };
  },
});

/** Effective permission matrix per role (for the review UI). */
export const permissionMatrix = query({
  args: {},
  handler: async (ctx) => {
    await getSession(ctx);
    return Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => ({
      role,
      count: perms.length,
      permissions: [...perms].sort(),
    }));
  },
});

/** Pending invitations summary for the access dashboard. */
export const pendingInvitations = query({
  args: { schoolId: v.optional(v.id("schools")) },
  handler: async (ctx, { schoolId }) => {
    const session = await requirePermission(ctx, "users.view", { schoolId });
    const scope = session.isPlatform ? schoolId : (session.schoolId as Id<"schools"> | null);
    const rows = await ctx.db
      .query("invitations")
      .withIndex(scope ? "by_school" : "by_status", (q) =>
        scope ? q.eq("schoolId", scope) : q.eq("status", "pending"),
      )
      .collect();
    const filtered = rows.filter((r) => !r.email.startsWith("token:"));
    const schools = await ctx.db.query("schools").collect();
    const schoolName = new Map(schools.map((s) => [s._id, s.name]));
    return filtered
      .filter((r) => (scope ? true : r.status === "pending"))
      .sort((a, b) => b.invitedAt - a.invitedAt)
      .slice(0, 100)
      .map((r) => ({
        _id: r._id, email: r.email, role: r.role, status: r.status,
        invitedAt: r.invitedAt, expiresAt: r.expiresAt,
        schoolName: r.schoolId ? schoolName.get(r.schoolId) ?? "—" : "(platform)",
      }));
  },
});

void ConvexError;
