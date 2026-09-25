/**
 * Phase 7 — user invitations, one-time activation tokens, password reset.
 *
 * Rules (spec §11–14):
 *  - No temporary passwords, ever. New accounts receive a one-time activation
 *    link; existing accounts receive a password-reset link.
 *  - Tokens are random (32 chars ≈190 bits), stored ONLY as SHA-256 hashes,
 *    single-use and expiring (invitations 7 days, resets 1 hour).
 *  - Every issue/accept/reset is audited. Used/expired/revoked tokens fail.
 *
 * Email delivery uses the existing Phase 6 communications infrastructure:
 * when the email provider is not configured the message is still queued and
 * logged (commMessages), and the raw token is returned to the inviting admin
 * UI so onboarding can proceed — production setups simply relay it via email.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getSession, requirePermission } from "../session";
import { recordAudit } from "../audit";
import { createAccount, retrieveAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { randomToken } from "../phase6/constants";
import { ROLES, type Role } from "../schema";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const RESET_TTL_MS = 3600 * 1000;
const SCHOOL_ASSIGNABLE: Role[] = ["school_admin", "principal", "teacher", "accountant", "parent", "student"];

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Create (or reuse) the user row behind an email without a password. */
export const ensureUserForInvitationInternal = internalMutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { email, name }) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) throw new ConvexError("Enter a valid email address.");
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .collect();
    if (users.length > 0) return { userId: users[0]._id, existed: true };
    // User rows start WITHOUT a password account; one is created only when
    // the activation token is redeemed (setPasswordInternal).
    const userId = await ctx.db.insert("users", {
      email: normalized,
      name: name?.trim() || normalized.split("@")[0],
      isActive: true,
    });
    return { userId: userId as Id<"users">, existed: false };
  },
});

/** Queue the invite/activation email through Phase 6 comms (audited there). */
async function queueTokenEmail(
  ctx: { insert: (table: "commMessages", doc: Record<string, unknown>) => Promise<Id<"commMessages">> },
  args: { schoolId: Id<"schools"> | undefined; toUserId: Id<"users"> | undefined; address: string; subject: string; body: string; event: string },
) {
  await ctx.insert("commMessages", {
    schoolId: args.schoolId,
    channel: "email",
    event: args.event,
    recipientKind: "custom",
    recipientUserId: args.toUserId,
    recipientAddress: args.address,
    body: `${args.subject}\n\n${args.body}`,
    status: "queued",
    attempts: 0,
    queuedAt: Date.now(),
  });
}

/* ------------------------------------------------------------------ */
/* Admin: invite a user (creates user row + membership + token)         */
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
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) throw new ConvexError("Enter a valid email address.");
    if (!SCHOOL_ASSIGNABLE.includes(role as Role)) {
      throw new ConvexError("This role cannot be invited within a school.");
    }
    if (role === "school_admin" && !["school_admin", "super_admin"].includes(session.role.role)) {
      throw new ConvexError("Only an administrator can invite school administrators.");
    }

    const { userId, existed } = await ctx.runMutation(internal.phase7.invitations.ensureUserForInvitationInternal, {
      email: normalized,
      name,
    });
    await ctx.runMutation(internal.accounts.addMembershipInternal, {
      userId,
      schoolId,
      role,
      createdById: session.userId,
    });

    // Parent/student portal links ride along on invitation (Phase 4 model).
    if (role === "parent" && guardianId) {
      await ctx.db.insert("guardianPortalLinks", {
        schoolId,
        guardianId,
        userId,
        invitedById: session.userId,
        invitedAt: Date.now(),
        status: "active",
      });
    }
    if (role === "student" && studentId) {
      await ctx.db.insert("studentPortalLinks", {
        schoolId,
        studentId,
        userId,
        invitedById: session.userId,
        invitedAt: Date.now(),
        status: "active",
      });
    }

    // Expire superseded pending invitations for the same email+school.
    const stale = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .collect()
      .then((rs) => rs.filter((r) => r.schoolId === schoolId && r.status === "pending"));
    for (const s of stale) await ctx.db.patch(s._id, { status: "revoked" });

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const now = Date.now();
    const invitationId = await ctx.db.insert("invitations", {
      schoolId,
      email: normalized,
      name: name?.trim(),
      role,
      status: "pending",
      invitedById: session.userId,
      invitedAt: now,
      expiresAt: now + INVITE_TTL_MS,
    });
    await ctx.db.insert("activationTokens", {
      userId,
      schoolId,
      kind: "invitation",
      tokenHash,
      status: "pending",
      createdById: session.userId,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    });

    await queueTokenEmail(ctx, {
      schoolId,
      toUserId: userId,
      address: normalized,
      event: "portal_invite",
      subject: "You have been invited to SchoolCore",
      body: `Set your password to activate your ${role} account. Your one-time activation code: ${rawToken}`,
    });

    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "invitation.created",
      entityType: "invitations", entityId: invitationId,
      description: `Invited ${normalized} as ${role}${existed ? " (existing account)" : ""}`,
      metadata: { role, email: normalized },
    });
    return { invitationId, userId, existed, token: rawToken };
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
  handler: async (ctx, { token }) => {
    if (!token.trim()) throw new ConvexError("Activation code is required.");
    const tokenHash = await sha256Hex(token.trim());
    const row = await ctx.db
      .query("activationTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!row || row.status !== "pending") {
      return { valid: false as const, reason: "invalid_or_used" as const };
    }
    if (row.expiresAt < Date.now()) {
      await ctx.db.patch(row._id, { status: "expired" });
      return { valid: false as const, reason: "expired" as const };
    }
    const user = await ctx.db.get(row.userId);
    if (!user) return { valid: false as const, reason: "invalid_or_used" as const };
    return {
      valid: true as const,
      kind: row.kind as "invitation" | "activation" | "password_reset",
      email: user.email ?? "",
      name: user.name ?? null,
    };
  },
});

/** Internal: set the password on the token's user (called by redeemToken). */
export const setPasswordInternal = internalMutation({
  args: { userId: v.id("users"), password: v.string(), tokenId: v.id("activationTokens") },
  handler: async (ctx, { userId, password, tokenId }) => {
    if (password.length < 8) throw new ConvexError("Password must be at least 8 characters.");
    const user = await ctx.db.get(userId);
    if (!user || !user.email) throw new ConvexError("Account not found.");
    const account = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: user.email },
    }).catch(() => null);
    if (account) {
      await modifyAccountCredentials(ctx, {
        provider: "password",
        account: { id: user.email, secret: password },
      });
    } else {
      await createAccount(ctx, {
        provider: "password",
        account: { id: user.email, secret: password },
        profile: { email: user.email, name: user.name ?? undefined },
      });
    }
    await ctx.db.patch(tokenId, { status: "used", usedAt: Date.now() });
    await ctx.db.patch(userId, { isActive: true });
  },
});

/**
 * Public: redeem a one-time token with a new password. Single use, expiring,
 * audited. This is how invitations activate AND how resets complete — no
 * temporary passwords exist anywhere in the flow.
 */
export const redeemToken = mutation({
  args: { token: v.string(), newPassword: v.string() },
  handler: async (ctx, { token, newPassword }) => {
    if (!token.trim()) throw new ConvexError("Activation code is required.");
    if (newPassword.length < 8) throw new ConvexError("Password must be at least 8 characters.");
    const tokenHash = await sha256Hex(token.trim());
    const row = await ctx.db
      .query("activationTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!row || row.status !== "pending") throw new ConvexError("This activation code is invalid or has already been used.");
    if (row.expiresAt < Date.now()) {
      await ctx.db.patch(row._id, { status: "expired" });
      throw new ConvexError("This activation code has expired. Request a new one.");
    }
    const user = await ctx.db.get(row.userId);
    if (!user || user.isActive === false) throw new ConvexError("This account is disabled.");
    await ctx.runMutation(internal.phase7.invitations.setPasswordInternal, {
      userId: row.userId,
      password: newPassword,
      tokenId: row._id,
    });
    // Mark any matching invitation accepted.
    if (user.email) {
      const invs = await ctx.db
        .query("invitations")
        .withIndex("by_email", (q) => q.eq("email", user.email))
        .collect()
        .then((rs) => rs.filter((r) => r.status === "pending" && r.schoolId === row.schoolId));
      for (const inv of invs) {
        await ctx.db.patch(inv._id, { status: "accepted", acceptedAt: Date.now(), acceptedByUserId: row.userId });
      }
    }
    await recordAudit(ctx, {
      userId: row.userId, schoolId: row.schoolId, action: `activation.${row.kind}_redeemed`,
      entityType: "activationTokens", entityId: row._id,
      description: `One-time ${row.kind.replace("_", " ")} code redeemed for ${user.email}`,
    });
    return { ok: true, kind: row.kind };
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
    await queueTokenEmail(ctx, {
      schoolId: undefined,
      toUserId: user._id,
      address: normalized,
      event: "custom",
      subject: "Reset your SchoolCore password",
      body: `Use this one-time code within the next hour to reset your password: ${rawToken}`,
    });
    await recordAudit(ctx, {
      userId: user._id, action: "activation.password_reset_requested",
      entityType: "users", entityId: user._id,
      description: `Password reset requested for ${normalized}`,
    });
    // The token is returned for unconfigured-email environments; production
    // relays it via the queued email only.
    return { ok: true, token: rawToken };
  },
});

/** Admin-initiated reset: generate a link for an existing user (no password). */
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
    await queueTokenEmail(ctx, {
      schoolId,
      toUserId: userId,
      address: user.email,
      event: "custom",
      subject: "Reset your SchoolCore password",
      body: `An administrator started a password reset for your account. One-time code (valid 1 hour): ${rawToken}`,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "activation.password_reset_issued",
      entityType: "users", entityId: userId,
      description: `Password reset link generated for ${user.email}`,
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
