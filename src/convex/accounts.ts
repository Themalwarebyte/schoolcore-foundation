import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  createAccount,
  retrieveAccount,
  modifyAccountCredentials,
  getAuthUserId,
} from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { recordAudit } from "./audit";
import { ROLES, type Role } from "./schema";
import { requirePermission } from "./session";

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/** Session resolution callable from actions (checks a permission). */
export const sessionInfo = internalQuery({
  args: { permission: v.string() },
  handler: async (ctx, { permission }) => {
    const session = await requirePermission(ctx, permission as never);
    return {
      userId: session.userId,
      role: session.role.role,
      isPlatform: session.isPlatform,
      schoolId: session.schoolId,
      email: session.user.email ?? null,
    };
  },
});

export const findUserByEmailInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (!user) return null;
    return { userId: user._id, email: user.email ?? null, name: user.name ?? null };
  },
});

export const hasPasswordAccount = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .unique();
    return account !== null;
  },
});

/** Create a user record if missing; returns userId. */
export const ensureUserRecordInternal = internalMutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { email, name }) => {
    const normalized = email.trim().toLowerCase();
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("users", {
      email: normalized,
      name: name ?? normalized.split("@")[0],
      isActive: true,
    });
  },
});

export const addMembershipInternal = internalMutation({
  args: {
    userId: v.id("users"),
    schoolId: v.optional(v.id("schools")),
    role: v.string(),
    createdById: v.optional(v.id("users")),
  },
  handler: async (ctx, { userId, schoolId, role, createdById }) => {
    if (!ROLES.includes(role as Role)) throw new ConvexError("Unknown role.");
    const existing = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = existing.find((m) => m.schoolId === schoolId);
    if (match) {
      await ctx.db.patch(match._id, { role, status: "active" });
      return match._id;
    }
    return await ctx.db.insert("schoolMemberships", {
      userId,
      schoolId,
      role,
      status: "active",
      createdById,
    });
  },
});

export const auditInternal = internalMutation({
  args: {
    userId: v.id("users"),
    action: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    schoolId: v.optional(v.id("schools")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await recordAudit(ctx, args);
  },
});

/** Delete all sessions for a user. */
export const deleteSessionsInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const s of sessions) await ctx.db.delete(s._id);
  },
});

export const getUserAccessInfo = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("User not found.");
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return {
      email: user.email ?? null,
      schoolIds: memberships.map((m) => m.schoolId).filter((s): s is Id<"schools"> => !!s),
      isSuperAdmin: memberships.some((m) => m.role === "super_admin"),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Platform bootstrap: ensure a super admin exists (idempotent)        */
/* ------------------------------------------------------------------ */

const BOOTSTRAP_EMAIL = (process.env.PLATFORM_ADMIN_EMAIL ?? "admin@schoolcore.dev")
  .trim()
  .toLowerCase();
const BOOTSTRAP_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD ?? "ChangeMe!2026";
const BOOTSTRAP_NAME = process.env.PLATFORM_ADMIN_NAME ?? "Platform Administrator";

export const ensureBootstrapAdmin = internalAction({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.runQuery(internal.accounts.findUserByEmailInternal, {
      email: BOOTSTRAP_EMAIL,
    });
    let userId: Id<"users">;
    if (existing) {
      userId = existing.userId;
    } else {
      userId = await ctx.runMutation(internal.accounts.ensureUserRecordInternal, {
        email: BOOTSTRAP_EMAIL,
        name: BOOTSTRAP_NAME,
      });
    }
    const hasAccount = await ctx.runQuery(internal.accounts.hasPasswordAccount, {
      email: BOOTSTRAP_EMAIL,
    });
    if (!hasAccount) {
      await createAccount(ctx, {
        provider: "password",
        account: { id: BOOTSTRAP_EMAIL, secret: BOOTSTRAP_PASSWORD },
        profile: { email: BOOTSTRAP_EMAIL, name: BOOTSTRAP_NAME },
      });
    }
    await ctx.runMutation(internal.accounts.addMembershipInternal, {
      userId,
      role: "super_admin",
    });
    return userId;
  },
});

/** Create a password account for an existing user (idempotent). */
export const ensurePasswordAccount = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    const normalized = email.trim().toLowerCase();
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
  },
});

/* ------------------------------------------------------------------ */
/* Queries used by the frontend                                        */
/* ------------------------------------------------------------------ */

/** Resolve the signed-in user's memberships for routing and headers. */
export const myMemberships = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.isActive === false) return null;
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const active = memberships.filter((m) => m.status === "active");
    const schools = await Promise.all(
      active.map(async (m) => {
        const school = m.schoolId ? await ctx.db.get(m.schoolId) : null;
        return {
          membershipId: m._id,
          role: m.role,
          schoolId: m.schoolId ?? null,
          schoolName: school?.name ?? null,
          schoolStatus: school?.status ?? null,
        };
      }),
    );
    return {
      userId,
      name: user.name ?? null,
      email: user.email ?? null,
      isSuperAdmin: active.some((m) => m.role === "super_admin"),
      memberships: schools,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Password management (public actions with server-side checks)        */
/* ------------------------------------------------------------------ */

/** Verify credentials (used by tests + seed validation). */
export const verifyCredentials = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    const normalized = email.trim().toLowerCase();
    const result = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: normalized, secret: password },
    });
    return result !== null;
  },
});

/** Admin resets a user's password. School admins cannot touch platform users. */
export const adminResetPasswordAction = action({
  args: { userId: v.id("users"), newPassword: v.string() },
  handler: async (ctx, { userId, newPassword }) => {
    if (newPassword.length < 8) {
      throw new ConvexError("Password must be at least 8 characters.");
    }
    const session = await ctx.runQuery(internal.accounts.sessionInfo, {
      permission: "users.update",
    });
    const target = await ctx.runQuery(internal.accounts.getUserAccessInfo, { userId });
    if (!session.isPlatform) {
      if (!session.schoolId || !target.schoolIds.includes(session.schoolId)) {
        throw new ConvexError("This user is not part of your school.");
      }
      if (target.isSuperAdmin) {
        throw new ConvexError("You cannot modify a platform administrator.");
      }
    }
    if (!target.email) throw new ConvexError("This user has no email account.");
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: target.email, secret: newPassword },
    });
    await ctx.runMutation(internal.accounts.deleteSessionsInternal, { userId });
    await ctx.runMutation(internal.accounts.auditInternal, {
      userId: session.userId,
      schoolId: session.schoolId ?? undefined,
      action: "user.password_reset",
      entityType: "users",
      entityId: userId,
      description: `Password reset for ${target.email}`,
    });
    return null;
  },
});

/** Self-service password change requiring the current password. */
export const changeMyPasswordAction = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }) => {
    if (newPassword.length < 8) {
      throw new ConvexError("New password must be at least 8 characters.");
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("You are not signed in.");
    const info = await ctx.runQuery(internal.accounts.getUserAccessInfo, { userId });
    if (!info.email) throw new ConvexError("Your account has no email.");
    const account = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: info.email, secret: currentPassword },
    });
    if (!account) throw new ConvexError("Your current password is incorrect.");
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: info.email, secret: newPassword },
    });
    await ctx.runMutation(internal.accounts.auditInternal, {
      userId,
      action: "user.password_changed",
      entityType: "users",
      entityId: userId,
      description: "You changed your own password",
    });
    return null;
  },
});
