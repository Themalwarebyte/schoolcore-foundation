/**
 * Phase 7 — activation-token leaf operations.
 *
 * Deliberately dependency-free (no @convex-dev/auth imports, no api-handle
 * references) so its exported types always resolve: `redeemToken` is a public
 * ACTION (createAccount/modifyAccountCredentials require an action context),
 * and actions orchestrate these leaf mutations for their database work.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { recordAudit } from "../audit";

/**
 * Validate a hashed activation token and return the redemption target.
 * Marks expired tokens. Never returns the raw hash or secret material.
 */
export const resolveTokenInternal = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
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
    if (!user || user.isActive === false) {
      return { valid: false as const, reason: "account_disabled" as const };
    }
    const email = user.email;
    if (!email) return { valid: false as const, reason: "invalid_or_used" as const };
    return {
      valid: true as const,
      tokenId: row._id,
      kind: row.kind,
      userId: row.userId,
      schoolId: row.schoolId ?? null,
      email,
      name: user.name ?? null,
    };
  },
});

/**
 * Adopt the auth-account user row before completing a redemption.
 *
 * The invitation flow pre-creates (or reuses) a `users` row by email and
 * attaches the school membership + portal links to it. When the invitee had
 * no password account yet, `createAccount` in redeemToken creates a SECOND
 * user row — the one sign-in resolves to. Without adoption the invitee signs
 * in with no school membership (the "account not linked to school" failure).
 *
 * This moves memberships and guardian/student portal links onto the
 * account's user row, then deactivates the orphan row so the duplicate can
 * never resolve to a membership-less session. Mirrors team.createUser,
 * which attaches membership to account.user._id for exactly this reason.
 */
export const adoptAccountUserInternal = internalMutation({
  args: { orphanUserId: v.id("users"), accountUserId: v.id("users") },
  handler: async (ctx, { orphanUserId, accountUserId }) => {
    if (orphanUserId === accountUserId) return { adopted: false };
    let movedMemberships = 0, movedLinks = 0;
    for (const m of await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", orphanUserId))
      .collect()) {
      const clash = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_user_school", (q) => q.eq("userId", accountUserId).eq("schoolId", m.schoolId))
        .unique();
      if (clash) {
        await ctx.db.patch(clash._id, { role: m.role, status: m.status });
        await ctx.db.delete(m._id);
      } else {
        await ctx.db.patch(m._id, { userId: accountUserId });
      }
      movedMemberships++;
    }
    for (const link of [
      ...(await ctx.db.query("guardianPortalLinks").withIndex("by_user", (q) => q.eq("userId", orphanUserId)).collect()),
      ...(await ctx.db.query("studentPortalLinks").withIndex("by_user", (q) => q.eq("userId", orphanUserId)).collect()),
    ]) {
      await ctx.db.patch(link._id, { userId: accountUserId });
      movedLinks++;
    }
    // The orphan row keeps audit history (auditLogs reference it) but must
    // never sign in or appear as an active account again.
    await ctx.db.patch(orphanUserId, { isActive: false });
    await ctx.db.patch(accountUserId, { isActive: true });
    return { adopted: true, movedMemberships, movedLinks };
  },
});

/**
 * Complete a redemption: consume the token, activate the user, accept any
 * matching pending invitation, and audit. Throws if the token was consumed
 * concurrently — single-use is enforced here, at the database step.
 */
export const completeRedemptionInternal = internalMutation({
  args: { tokenId: v.id("activationTokens"), userId: v.id("users") },
  handler: async (ctx, { tokenId, userId }) => {
    const token = await ctx.db.get(tokenId);
    if (!token || token.status !== "pending") {
      throw new ConvexError("This activation code is invalid or has already been used.");
    }
    if (token.expiresAt < Date.now()) {
      await ctx.db.patch(tokenId, { status: "expired" });
      throw new ConvexError("This activation code has expired. Request a new one.");
    }
    const user = await ctx.db.get(userId);
    await ctx.db.patch(tokenId, { status: "used", usedAt: Date.now() });
    await ctx.db.patch(userId, { isActive: true });
    if (user?.email) {
      const invs = await ctx.db
        .query("invitations")
        .withIndex("by_email", (q) => q.eq("email", user.email as string))
        .collect();
      for (const inv of invs) {
        if (inv.status === "pending" && inv.schoolId === token.schoolId) {
          await ctx.db.patch(inv._id, {
            status: "accepted",
            acceptedAt: Date.now(),
            acceptedByUserId: userId,
          });
        }
      }
    }
    await recordAudit(ctx, {
      userId,
      schoolId: token.schoolId,
      action: `activation.${token.kind}_redeemed`,
      entityType: "activationTokens",
      entityId: tokenId,
      description: `One-time ${token.kind.replace("_", " ")} code redeemed${user?.email ? ` for ${user.email}` : ""}`,
    });
    return { ok: true as const, kind: token.kind };
  },
});
