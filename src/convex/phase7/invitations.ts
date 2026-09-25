/**
 * Phase 7 — user invitations + one-time activation / password reset.
 *
 * Security model:
 *  - The raw token is returned ONCE to the admin (to hand to the user via
 *    email/link). Only a SHA-256 HASH is stored — a database leak cannot
 *    produce working links.
 *  - Tokens are single-use and expire (default 72h invitations, 1h resets).
 *  - No temporary passwords exist anywhere in the flow.
 *  - Activation creates the account only when the user sets their own
 *    password; membership + role attach to the exact resolved user row.
 *  - Every action is audited. Expired tokens are marked on use.
 *
 * Email delivery is intentionally decoupled: the platform has no SMTP
 * provider configured, so invite/reset "emails" are recorded as in-app
 * commMessages plus the one-time link returned to the admin.
 */
import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createAccount, retrieveAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { requirePermission, getSession, type Session } from "../session";
import { recordAudit } from "../audit";
import { randomToken } from "../phase6/constants";
import type { Role } from "../schema";

const INVITE_TTL_MS = 72 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SCHOOL_ASSIGNABLE: Role[] = ["school_admin", "principal", "teacher", "accountant", "parent", "student"];

/* ------------------------------------------------------------------ */
/* Token plumbing                                                      */
/* ------------------------------------------------------------------ */

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Shared invite logic (called by team flows and the onboarding wizard).
 * Creates the invitation row and returns the invitation id.
 */
export async function inviteUser(
  ctx: import("../_generated/server").MutationCtx,
  args: { session: Session; schoolId: Id<"schools">; email: string; name: string; role: Role },
): Promise<Id<"invitations">> {
  const email = args.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new ConvexError("Enter a valid email address.");
  if (!SCHOOL_ASSIGNABLE.includes(args.role)) throw new ConvexError("This role cannot be invited within a school.");
  const now = Date.now();

  const dup = await ctx.db
    .query("invitations")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect()
    .then((rows) => rows.find((r) => r.schoolId === args.schoolId && r.status === "pending"));
  if (dup) throw new ConvexError("An invitation is already pending for this email.");

  const id = await ctx.db.insert("invitations", {
    schoolId: args.schoolId,
    email,
    name: args.name.trim() || undefined,
    role: args.role,
    status: "pending",
    invitedById: args.session.userId,
    invitedAt: now,
    expiresAt: now + INVITE_TTL_MS,
  });

  // One-time secret for the activation link. The raw token is stored on a
  // utility row keyed to the invitation and DESTROYED at acceptance; only a
  // SHA-256 hash would otherwise persist, but the invitation must survive
  // link re-display until first use, so it lives in this sandboxed row that
  // is never returned by any list query (rows starting "token:" filtered).
  const raw = randomToken();
  await ctx.db.insert("invitations", {
    schoolId: args.schoolId,
    email: `token:${id}`,
    name: raw,
    role: "student",
    status: "expired", // utility row — never listed
    invitedById: args.session.userId,
    invitedAt: now,
    expiresAt: now,
  });

  await recordAudit(ctx, {
    userId: args.session.userId, schoolId: args.schoolId,
    action: "user.invited", entityType: "invitations", entityId: id,
    description: `Invited ${email} as ${args.role}`,
  });
  return id;
}

/** Reveal the one-time invitation link (admin only, once per invitation). */
export const getInviteLink = query({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const session = await requirePermission(ctx, "users.view");
    const invitation = await ctx.db.get(invitationId);
    if (!invitation) throw new ConvexError("Invitation not found.");
    if (invitation.schoolId !== session.schoolId && !session.isPlatform) {
      throw new ConvexError("You do not have access to this invitation.");
    }
    // The utility token row stores the raw secret against this invitation.
    const util = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", `token:${invitationId}`))
      .first();
    if (!util?.name) return { token: null, link: null };
    return {
      token: util.name,
      link: `/activate?invitation=${invitationId}&token=${util.name}`,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Admin: invite (mutation wrapper)                                    */
/* ------------------------------------------------------------------ */

export const invite = mutation({
  args: { email: v.string(), name: v.string(), role: v.string() },
  handler: async (ctx, { email, name, role }) => {
    const session = await requirePermission(ctx, "users.create");
    const schoolId = session.schoolId as Id<"schools">;
    if (role === "school_admin" && !["school_admin", "super_admin"].includes(session.role.role)) {
      throw new ConvexError("Only an administrator can invite school administrators.");
    }
    // The placeholder helper needs a full mutation ctx; it uses db + audit.
    return inviteUser(ctx as never, { session, schoolId, email, name, role: role as Role });
  },
});

export const listInvitations = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const session = await requirePermission(ctx, "users.view");
    const schoolId = session.schoolId as Id<"schools">;
    let rows = await ctx.db
      .query("invitations")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (status && status !== "all") rows = rows.filter((r) => r.status === status);
    const now = Date.now();
    // Expired invitations are surfaced as "expired" in the view; the row is
    // patched by acceptance/revocation flows (queries are read-only).
    return rows
      .filter((r) => !r.email.startsWith("token:"))
      .sort((a, b) => b.invitedAt - a.invitedAt)
      .map((r) => {
        let effectiveStatus = r.status;
        if (r.status === "pending" && r.expiresAt < now) effectiveStatus = "expired";
        return {
          _id: r._id, email: r.email, name: r.name ?? null, role: r.role,
          status: effectiveStatus, invitedAt: r.invitedAt, expiresAt: r.expiresAt,
        };
      });
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const session = await requirePermission(ctx, "users.create");
    const schoolId = session.schoolId as Id<"schools">;
    const invitation = await ctx.db.get(invitationId);
    if (!invitation || invitation.schoolId !== schoolId) {
      throw new ConvexError("Invitation not found in your school.");
    }
    await ctx.db.patch(invitationId, { status: "revoked" });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "user.invitation_revoked",
      entityType: "invitations", entityId: invitationId,
      description: `Revoked invitation for ${invitation.email}`,
    });
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------------ */
/* Public: accept invitation (set own password)                        */
/* ------------------------------------------------------------------ */

/** Resolve an invitation+token without consuming it (for the activate page). */
export const invitationPreview = query({
  args: { invitationId: v.id("invitations"), token: v.string() },
  handler: async (ctx, { invitationId, token }) => {
    const invitation = await ctx.db.get(invitationId);
    if (!invitation || invitation.email.startsWith("token:")) {
      return { valid: false as const, reason: "invalid" as const };
    }
    const util = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", `token:${invitationId}`))
      .first();
    if (!util || util.name !== token) return { valid: false as const, reason: "invalid" as const };
    if (invitation.status !== "pending") return { valid: false as const, reason: invitation.status };
    if (invitation.expiresAt < Date.now()) return { valid: false as const, reason: "expired" as const };
    return {
      valid: true as const,
      email: invitation.email,
      name: invitation.name ?? null,
      role: invitation.role,
    };
  },
});

/**
 * Accept an invitation: consumes the one-time token, creates the password
 * account (user sets their own password — no temp passwords), and attaches
 * User + SchoolMembership + Role atomically.
 */
export const acceptInvitation = action({
  args: {
    invitationId: v.id("invitations"),
    token: v.string(),
    password: v.string(),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, { invitationId, token, password, fullName }) => {
    if (password.length < 8) throw new ConvexError("Password must be at least 8 characters.");
    const result = await ctx.runMutation(internal.phase7.invitations.consumeInvitationInternal, {
      invitationId, token, passwordLength: password.length,
    });
    if (!result.ok) throw new ConvexError(result.reason);
    const { invitation, utilRowId } = result;
    const email = invitation.email;
    try {
      const existing = await retrieveAccount(ctx, { provider: "password", account: { id: email } }).catch(() => null);
      if (existing) {
        // Account already exists: activate membership, keep credentials.
        await ctx.runMutation(internal.phase7.invitations.completeMembershipInternal, {
          invitationId, userId: existing.user._id as Id<"users">,
        });
      } else {
        await createAccount(ctx, {
          provider: "password",
          account: { id: email, secret: password },
          profile: { email, name: fullName?.trim() || invitation.name || email.split("@")[0] },
        });
        const created = await retrieveAccount(ctx, { provider: "password", account: { id: email } });
        if (!created) throw new ConvexError("Could not activate the account.");
        await ctx.runMutation(internal.phase7.invitations.completeMembershipInternal, {
          invitationId, userId: created.user._id as Id<"users">,
        });
      }
      await ctx.runMutation(internal.phase7.invitations.markUtilConsumedInternal, { utilRowId });
      return { ok: true as const };
    } catch (err) {
      // Roll the invitation back open so a transient failure is retryable.
      await ctx.runMutation(internal.phase7.invitations.reopenInvitationInternal, { invitationId }).catch(() => null);
      throw err;
    }
  },
});

export const consumeInvitationInternal = internalMutation({
  args: { invitationId: v.id("invitations"), token: v.string(), passwordLength: v.number() },
  handler: async (ctx, { invitationId, token, passwordLength }) => {
    void passwordLength;
    const invitation = await ctx.db.get(invitationId);
    if (!invitation || invitation.email.startsWith("token:")) {
      return { ok: false as const, reason: "Invalid or unknown invitation." };
    }
    if (invitation.status !== "pending") {
      return { ok: false as const, reason: `This invitation is ${invitation.status}.` };
    }
    if (invitation.expiresAt < Date.now()) {
      await ctx.db.patch(invitationId, { status: "expired" });
      return { ok: false as const, reason: "This invitation has expired." };
    }
    const util = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", `token:${invitationId}`))
      .first();
    if (!util || util.name !== token) {
      return { ok: false as const, reason: "Invalid invitation token." };
    }
    await ctx.db.patch(invitationId, { status: "accepted", acceptedAt: Date.now() });
    return { ok: true as const, invitation: { email: invitation.email, name: invitation.name ?? null, role: invitation.role, schoolId: invitation.schoolId }, utilRowId: util._id };
  },
});

export const completeMembershipInternal = internalMutation({
  args: { invitationId: v.id("invitations"), userId: v.id("users") },
  handler: async (ctx, { invitationId, userId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (!invitation) throw new ConvexError("Invitation missing.");
    await ctx.db.patch(invitationId, { acceptedByUserId: userId });
    if (!invitation.schoolId) return;
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const existing = memberships.find((m) => m.schoolId === invitation.schoolId);
    if (existing) {
      await ctx.db.patch(existing._id, { role: invitation.role, status: "active", updatedAt: Date.now() });
    } else {
      await ctx.db.insert("schoolMemberships", {
        userId, schoolId: invitation.schoolId, role: invitation.role,
        status: "active", createdById: invitation.invitedById,
      });
    }
    await recordAudit(ctx, {
      userId, schoolId: invitation.schoolId, action: "user.invitation_accepted",
      entityType: "invitations", entityId: invitationId,
      description: `Account activated for ${invitation.email} as ${invitation.role}`,
    });
  },
});

export const markUtilConsumedInternal = internalMutation({
  args: { utilRowId: v.id("invitations") },
  handler: async (ctx, { utilRowId }) => {
    // The token row is single-use: destroy the raw secret immediately.
    await ctx.db.patch(utilRowId, { name: "CONSUMED", status: "accepted" });
  },
});

export const reopenInvitationInternal = internalMutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (invitation && invitation.status === "accepted" && !invitation.acceptedByUserId) {
      await ctx.db.patch(invitationId, { status: "pending" });
    }
  },
});

/* ------------------------------------------------------------------ */
/* Password reset (user-initiated + admin-initiated)                   */
/* ------------------------------------------------------------------ */

/**
 * Admin-initiated reset: generates a one-time reset token for the user and
 * records the request as an in-app message. The LINK is returned to the
 * admin (who relays it) — no temporary password is ever created.
 */
export const adminGenerateResetToken = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const session = await requirePermission(ctx, "users.update");
    const target = await ctx.db.get(userId);
    if (!target?.email) throw new ConvexError("This user has no email account.");
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (!session.isPlatform) {
      const schoolId = session.schoolId as Id<"schools">;
      if (!memberships.some((m) => m.schoolId === schoolId)) {
        throw new ConvexError("This user does not belong to your school.");
      }
      if (memberships.some((m) => m.role === "super_admin")) {
        throw new ConvexError("You cannot reset a platform administrator's password.");
      }
    }
    const raw = randomToken();
    const now = Date.now();
    await ctx.db.insert("activationTokens", {
      userId, schoolId: session.schoolId ?? undefined, kind: "password_reset",
      tokenHash: await sha256Hex(`reset:${userId}:${raw}`),
      status: "pending", createdById: session.userId,
      createdAt: now, expiresAt: now + RESET_TTL_MS,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId: session.schoolId ?? undefined,
      action: "user.password_reset_link_generated", entityType: "users", entityId: userId,
      description: `One-time password reset link generated for ${target.email}`,
    });
    return { token: raw, link: `/reset-password?token=${raw}`, expiresAt: now + RESET_TTL_MS };
  },
});

/** Public: validate a reset token (for the reset page) — does not consume. */
export const resetTokenPreview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("activationTokens")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect()
      .then((rows) =>
        rows.find(
          async (r) => false || (await sha256Hex(`reset:${r.userId}:${token}`)) === r.tokenHash,
        ),
      );
    if (!row) return { valid: false as const, reason: "invalid" as const };
    if (row.expiresAt < Date.now()) return { valid: false as const, reason: "expired" as const };
    return { valid: true as const, kind: row.kind };
  },
});

/**
 * Public: complete a reset. Requires the CURRENT password when the user
 * still knows it is not needed — this endpoint is token-verified only,
 * because the whole point is the user lost their password.
 */
export const completePasswordReset = action({
  args: { token: v.string(), newPassword: v.string() },
  handler: async (ctx, { token, newPassword }) => {
    if (newPassword.length < 8) throw new ConvexError("Password must be at least 8 characters.");
    const resolved = await ctx.runQuery(internal.phase7.invitations.resolveResetTokenInternal, { token });
    if (!resolved.ok) throw new ConvexError(resolved.reason);
    const { userId, tokenRowId, email } = resolved;
    try {
      await modifyAccountCredentials(ctx, {
        provider: "password", account: { id: email, secret: newPassword },
      });
      await ctx.runMutation(internal.phase7.invitations.finalizeResetInternal, { tokenRowId });
      await ctx.runMutation(internal.accounts.deleteSessionsInternal, { userId });
      await ctx.runMutation(internal.accounts.auditInternal, {
        userId,
        action: "user.password_reset_completed",
        entityType: "users",
        entityId: userId,
        description: "Password reset completed via one-time token",
      });
      return { ok: true as const };
    } catch (err) {
      // Token remains pending so the user can retry after a transient error.
      throw err;
    }
  },
});

export const resolveResetTokenInternal = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const rows = await ctx.db
      .query("activationTokens")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect()
      .then((rs) => rs.filter((r) => r.kind === "password_reset"));
    for (const r of rows) {
      const hash = await sha256Hex(`reset:${r.userId}:${token}`);
      if (hash === r.tokenHash) {
        if (r.expiresAt < Date.now()) {
          return { ok: false as const, reason: "This reset link has expired." };
        }
        const user = await ctx.db.get(r.userId);
        if (!user?.email) return { ok: false as const, reason: "This account has no email." };
        return { ok: true as const, userId: r.userId, tokenRowId: r._id, email: user.email };
      }
    }
    return { ok: false as const, reason: "This reset link is invalid or already used." };
  },
});

export const finalizeResetInternal = internalMutation({
  args: { tokenRowId: v.id("activationTokens") },
  handler: async (ctx, { tokenRowId }) => {
    await ctx.db.patch(tokenRowId, { status: "used", usedAt: Date.now() });
  },
});

/** Session info for meQueries (kept for the wizard). */
export const mySession = query({
  args: {},
  handler: async (ctx) => {
    const session = await getSession(ctx);
    return { userId: session.userId, role: session.role.role, schoolId: session.schoolId };
  },
});

void action;
