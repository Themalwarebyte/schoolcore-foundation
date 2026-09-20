import { ConvexError, v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { recordAudit } from "./audit";
import { ROLES, type Role } from "./schema";
import { requirePermission } from "./session";

const SCHOOL_ASSIGNABLE: Role[] = [
  "school_admin",
  "principal",
  "teacher",
  "accountant",
  "parent",
  "student",
];

export const list = query({
  args: {
    search: v.optional(v.string()),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
    paginationOpts: v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) }),
  },
  handler: async (ctx, { search, role, status, paginationOpts }) => {
    const session = await requirePermission(ctx, "users.view");
    const members = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    let rows = await Promise.all(
      members.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        if (!user) return null;
        const staffLink = await ctx.db
          .query("staff")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .first();
        return {
          membershipId: m._id,
          userId: user._id,
          name: user.name ?? user.email ?? "—",
          email: user.email ?? "—",
          role: m.role,
          isActive: user.isActive !== false,
          membershipStatus: m.status,
          staffId: staffLink?._id ?? null,
          staffName: staffLink ? `${staffLink.firstName} ${staffLink.lastName}` : null,
        };
      }),
    );
    rows = rows.filter(Boolean) as NonNullable<(typeof rows)[number]>[];
    if (role && role !== "all") rows = rows.filter((r) => r!.role === role);
    if (status && status !== "all") {
      rows = rows.filter((r) => r!.isActive === (status === "active"));
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) => r!.name.toLowerCase().includes(q) || r!.email.toLowerCase().includes(q),
      );
    }
    rows.sort((a, b) => a!.name.localeCompare(b!.name));
    return { page: rows, isDone: true, pageToken: undefined, continueCursor: "" };
  },
});

/** Create a school user with a working password account (action-based). */
export const createUser = action({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.string(),
    password: v.string(),
  },
  handler: async (ctx, { email, name, role, password }) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) throw new ConvexError("Enter a valid email address.");
    if (password.length < 8) throw new ConvexError("Password must be at least 8 characters.");
    if (!SCHOOL_ASSIGNABLE.includes(role as Role)) {
      throw new ConvexError("This role cannot be assigned within a school.");
    }
    const session = await ctx.runQuery(internal.accounts.sessionInfo, {
      permission: "users.create",
    });
    if (role === "school_admin" && !["school_admin", "super_admin"].includes(session.role)) {
      throw new ConvexError("Only an administrator can create school administrators.");
    }
    const { createAccount } = await import("@convex-dev/auth/server");
    const userId = await ctx.runMutation(internal.accounts.ensureUserRecordInternal, {
      email: normalized,
      name,
    });
    const hasAccount = await ctx.runQuery(internal.accounts.hasPasswordAccount, {
      email: normalized,
    });
    if (!hasAccount) {
      await createAccount(ctx, {
        provider: "password",
        account: { id: normalized, secret: password },
        profile: { email: normalized },
      });
    }
    await ctx.runMutation(internal.accounts.addMembershipInternal, {
      userId,
      schoolId: session.schoolId ?? undefined,
      role,
      createdById: session.userId,
    });
    await ctx.runMutation(internal.accounts.auditInternal, {
      userId: session.userId,
      schoolId: session.schoolId ?? undefined,
      action: "user.created",
      entityType: "users",
      entityId: userId,
      description: `Created ${role} account for ${normalized}`,
    });
    return userId;
  },
});

export const changeRole = mutation({
  args: { membershipId: v.id("schoolMemberships"), role: v.string() },
  handler: async (ctx, { membershipId, role }) => {
    const session = await requirePermission(ctx, "users.update");
    const schoolId = session.schoolId as Id<"schools">;
    const membership = await ctx.db.get(membershipId);
    if (!membership || membership.schoolId !== schoolId) {
      throw new ConvexError("Membership not found in your school.");
    }
    if (!SCHOOL_ASSIGNABLE.includes(role as Role)) {
      throw new ConvexError("This role cannot be assigned within a school.");
    }
    if (membership.userId === session.userId) {
      throw new ConvexError("You cannot change your own role.");
    }
    const targetMemberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", membership.userId))
      .collect();
    if (targetMemberships.some((m) => m.role === "super_admin")) {
      throw new ConvexError("Platform administrators cannot be modified from a school.");
    }
    await ctx.db.patch(membershipId, { role, updatedAt: Date.now() });
    const user = await ctx.db.get(membership.userId);
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "user.role_changed",
      entityType: "users",
      entityId: membership.userId,
      description: `${user?.email ?? "User"}: role → ${role}`,
    });
    return null;
  },
});

export const setActive = mutation({
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, { userId, isActive }) => {
    const session = await requirePermission(ctx, "users.disable");
    const schoolId = session.schoolId as Id<"schools">;
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (!memberships.some((m) => m.schoolId === schoolId)) {
      throw new ConvexError("This user does not belong to your school.");
    }
    if (memberships.some((m) => m.role === "super_admin")) {
      throw new ConvexError("Platform administrators cannot be disabled from a school.");
    }
    if (userId === session.userId && !isActive) {
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
    const user = await ctx.db.get(userId);
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: isActive ? "user.activated" : "user.disabled",
      entityType: "users",
      entityId: userId,
      description: `${user?.email ?? "User"}: ${isActive ? "activated" : "disabled"}`,
    });
    return null;
  },
});

/** The signed-in user's own profile for the topbar and routing. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const active = memberships.filter((m) => m.status === "active");
    const schools = await Promise.all(
      active.map(async (m) => {
        const school = m.schoolId ? await ctx.db.get(m.schoolId) : null;
        return {
          role: m.role,
          schoolId: m.schoolId,
          schoolName: school?.name ?? null,
        };
      }),
    );
    return {
      userId,
      name: user.name ?? null,
      email: user.email ?? null,
      isActive: user.isActive !== false,
      isSuperAdmin: active.some((m) => m.role === "super_admin"),
      memberships: schools,
    };
  },
});
