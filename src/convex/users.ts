import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.users.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) {
      return null;
    }
    return user;
  },
});

/**
 * Use this function internally to get the current user data. Remember to handle the null user case.
 * @param ctx
 */
export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
};

/** Internal: set a user's disabled state and delete their sessions when disabling. */
export const internalSetUserActive = internalMutation({
  args: { userId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, { userId, isActive }) => {
    await ctx.db.patch(userId, { isActive });
    if (!isActive) {
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", userId))
        .collect();
      for (const s of sessions) await ctx.db.delete(s._id);
    }
  },
});
