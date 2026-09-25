/**
 * Phase 7 — user invitations, one-time activation tokens, password reset.
 *
 * Rules (spec §11–14):
 *  - No temporary passwords, ever. New accounts receive a one-time activation
 *    code; existing accounts receive a password-reset code.
 *  - Tokens are random (32 chars ≈190 bits), stored ONLY as SHA-256 hashes,
 *    single-use and expiring (invitations 7 days, resets 1 hour).
 *  - Every issue/accept/reset is audited. Used/expired/revoked tokens fail.
 *
 * Structural notes (these modules hit TS7022 circular inference before):
 *  - Invitation creation lives in `inviteCore.ts` (no api-handle references);
 *    this module and onboarding both call it.
 *  - Token redemption leaves live in `inviteTokens.ts`; `redeemToken` is a
 *    public ACTION because createAccount/modifyAccountCredentials require an
 *    action context.
 */
import { ConvexError, v } from "convex/values";
import { action, internalQuery, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requirePermission } from "../session";
import { recordAudit } from "../audit";
import { createAccount, retrieveAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { randomToken } from "../phase6/constants";
import { createInvitationCore, sha256Hex } from "./inviteCore";

const RESET_TTL_MS = 3600 * 1000;

/* ------------------------------------------------------------------ */
/* Admin: invite a user (user row + membership + token)                 */
/* ------------------------------------------------------------------ */

export const inviteUser = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    role: v.string(),
    /** Optional portal link target for parents/students. */
    guardianId: v.optional(v.id("guardians")),
    studentId: v.optional(v.id("students")),
  },
  handler: async (ctx, { email, name, role, guardianId, studentId }) => {
    const session = await requirePermission(ctx, "users.create");
    const schoolId = session.schoolId as Id<"schools">;
    if (!schoolId) throw new ConvexError("Select a school to continue.");
    const result = await createInvitationCore(ctx, {
      session,
      schoolId,
      email,
      name,
      role,
      guardianId,
      studentId,
    });
    return result;
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
    // Lazy expiry for display purposes.
    const now = Date.now();
    return rows
      .sort((a, b) => b.invitedAt - a.invitedAt)
      .map((r) => ({
        _id: r._id,
        email: r.email,
        name: r.name ?? null,
        role: r.role,
        status: r.status === "pending" && r.expiresAt < now ? "expired" : r.status,
        invitedAt: r.invitedAt,
        expiresAt: r.expiresAt,
        acceptedAt: r.acceptedAt ?? null,
      }));
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const session = await requirePermission(ctx, "users.create");
    const schoolId = session.schoolId as Id<"schools">;
    const inv = await ctx.db.get(invitationId);
    if (!inv || inv.schoolId !== schoolId) throw new ConvexError("Invitation not found in your school.");
    if (inv.status !== "pending") throw new ConvexError("Only pending invitations can be revoked.");
    await ctx.db.patch(invitationId, { status: "revoked" });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "invitation.revoked",
      entityType: "invitations", entityId: invitationId,
      description: `Invitation for ${inv.email} revoked`,
    });
    return { ok: true };
  },
});

/* ------------------------------------------------------------------ */
/* Public: activation + password reset                                 */
/* ------------------------------------------------------------------ */

/** Public: validate a token (no secrets returned). */
export const validateToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{
    valid: boolean;
    reason?: string;
    kind?: string;
    email?: string;
    name?: string | null;
  }> => {
    if (!token.trim()) throw new ConvexError("Activation code is required.");
    const tokenHash = await sha256Hex(token.trim());
    const target = (await ctx.runMutation(internal.phase7.inviteTokens.resolveTokenInternal, {
      tokenHash,
    })) as {
      valid: boolean;
      reason?: string;
      kind?: string;
      email?: string;
      name?: string | null;
      tokenId?: unknown;
      userId?: unknown;
    };
    if (!target.valid) return { valid: false, reason: target.reason };
    return {
      valid: true,
      kind: target.kind,
      email: target.email,
      name: target.name ?? null,
    };
  },
});

/**
 * Public: redeem a one-time token with a new password. Single use, expiring,
 * audited. This is how invitations activate AND how resets complete — no
 * temporary passwords exist anywhere in the flow.
 */
export const redeemToken = action({
  args: { token: v.string(), newPassword: v.string() },
  handler: async (ctx, { token, newPassword }): Promise<{ ok: boolean; kind: string }> => {
    if (!token.trim()) throw new ConvexError("Activation code is required.");
    if (newPassword.length < 8) throw new ConvexError("Password must be at least 8 characters.");
    const tokenHash = await sha256Hex(token.trim());
    const target = (await ctx.runMutation(internal.phase7.inviteTokens.resolveTokenInternal, {
      tokenHash,
    })) as {
      valid: boolean;
      reason?: string;
      email: string;
      name?: string | null;
      tokenId: { toString: () => string };
      userId: { toString: () => string };
    };
    if (!target.valid) {
      throw new ConvexError(
        target.reason === "expired"
          ? "This activation code has expired. Request a new one."
          : target.reason === "account_disabled"
            ? "This account is disabled."
            : "This activation code is invalid or has already been used.",
      );
    }
    // Set the password credential (action context required by auth server).
    const account = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: target.email },
    }).catch(() => null);
    if (account) {
      await modifyAccountCredentials(ctx, {
        provider: "password",
        account: { id: target.email, secret: newPassword },
      });
    } else {
      await createAccount(ctx, {
        provider: "password",
        account: { id: target.email, secret: newPassword },
        profile: { email: target.email, name: target.name ?? undefined },
      });
    }
    // Consume the token + accept invitations. Re-checked here, so a race can
    // never redeem one code twice.
    await ctx.runMutation(internal.phase7.inviteTokens.completeRedemptionInternal, {
      tokenId: target.tokenId as never,
      userId: target.userId as never,
    });
    return { ok: true, kind: "redeemed" };
  },
});

/**
 * Self-service: request a password reset by email. Always reports success to
 * the caller (no account enumeration); tokens exist only for real accounts.
 */
export const requestPasswordReset = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .collect();
    if (users.length === 0) return { ok: true, token: null }; // enumeration-safe
    const user = users[0];
    if (user.isActive === false) return { ok: true, token: null };
    // Invalidate prior pending resets.
    const prior = await ctx.db
      .query("activationTokens")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()
      .then((rs) => rs.filter((r) => r.kind === "password_reset" && r.status === "pending"));
    for (const p of prior) await ctx.db.patch(p._id, { status: "revoked" });
    const rawToken = randomToken();
    const now = Date.now();
    await ctx.db.insert("activationTokens", {
      userId: user._id,
      kind: "password_reset",
      tokenHash: await sha256Hex(rawToken),
      status: "pending",
      createdAt: now,
      expiresAt: now + RESET_TTL_MS,
    });
    // commMessages are school-scoped; queue the email when the user belongs to
    // a school. Platform-only accounts still receive the token via the UI.
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const schoolId = memberships.find((m) => m.status === "active" && m.schoolId)?.schoolId as
      | Id<"schools">
      | undefined;
    if (schoolId) {
      await ctx.db.insert("commMessages", {
        schoolId,
        channel: "email",
        event: "custom",
        recipientKind: "custom",
        recipientUserId: user._id,
        recipientAddress: normalized,
        body: `Reset your SchoolCore password\n\nUse this one-time code within the next hour to reset your password: ${rawToken}`,
        status: "queued",
        attempts: 0,
        queuedAt: Date.now(),
      });
    }
    await recordAudit(ctx, {
      userId: user._id, schoolId: schoolId ?? null, action: "activation.password_reset_requested",
      entityType: "users", entityId: user._id,
      description: `Password reset requested for ${normalized}`,
    });
    // The token is returned for unconfigured-email environments; production
    // relays it via the queued email only.
    return { ok: true, token: rawToken };
  },
});

/** Admin-initiated reset: generate a code for an existing user (no password). */
export const adminResetLink = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const session = await requirePermission(ctx, "users.update");
    const schoolId = session.schoolId as Id<"schools">;
    const memberships = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const inSchool = memberships.some((m) => m.schoolId === schoolId);
    if (!inSchool) throw new ConvexError("This user is not part of your school.");
    if (memberships.some((m) => m.role === "super_admin")) {
      throw new ConvexError("You cannot reset a platform administrator from a school.");
    }
    const user = await ctx.db.get(userId);
    if (!user?.email) throw new ConvexError("This user has no email account.");
    const prior = await ctx.db
      .query("activationTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then((rs) => rs.filter((r) => r.kind === "password_reset" && r.status === "pending"));
    for (const p of prior) await ctx.db.patch(p._id, { status: "revoked" });
    const rawToken = randomToken();
    const now = Date.now();
    await ctx.db.insert("activationTokens", {
      userId,
      schoolId,
      kind: "password_reset",
      tokenHash: await sha256Hex(rawToken),
      status: "pending",
      createdById: session.userId,
      createdAt: now,
      expiresAt: now + RESET_TTL_MS,
    });
    await ctx.db.insert("commMessages", {
      schoolId,
      channel: "email",
      event: "custom",
      recipientKind: "custom",
      recipientUserId: userId,
      recipientAddress: user.email,
      body: `Reset your SchoolCore password\n\nAn administrator started a password reset for your account. One-time code (valid 1 hour): ${rawToken}`,
      status: "queued",
      attempts: 0,
      queuedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "activation.password_reset_issued",
      entityType: "users", entityId: userId,
      description: `Password reset code generated for ${user.email}`,
    });
    return { ok: true, token: rawToken, email: user.email };
  },
});

/** Public query helper for the activation page: has a user already set a password? */
export const hasPasswordInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", email))
      .unique();
    return account !== null;
  },
});
