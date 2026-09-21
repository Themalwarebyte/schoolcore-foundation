// Custom auth providers for SchoolCore.
//
// - `password`: a sign-in-only credentials provider. It intentionally does NOT
//   implement the stock Password provider's `signUp` flow (no public
//   self-service signup — accounts are provisioned by administrators via
//   team:createUser / seed) and it rejects users whose `isActive` flag is
//   false, so disabled accounts cannot mint sessions at all.
// - Template providers (email OTP + anonymous) are preserved per the template
//   contract.
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth, retrieveAccount } from "@convex-dev/auth/server";
import { emailOtp } from "./auth/emailOtp";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { Scrypt } from "lucia";

export const passwordCredentials = ConvexCredentials({
  id: "password",
  authorize: async (params, ctx) => {
    const flow = params.flow;
    if (flow !== "signIn") {
      // No public sign-up / reset flows: accounts are provisioned and
      // passwords are reset only through authenticated administrator
      // workflows (team.createUser, accounts.adminResetPasswordAction).
      throw new Error(
        "Only sign-in is supported. Accounts are provisioned by your administrator.",
      );
    }
    const email = String(params.email ?? "").trim().toLowerCase();
    const secret = params.password;
    if (!email || typeof secret !== "string" || secret.length === 0) {
      throw new Error("Invalid credentials");
    }
    const retrieved = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: email, secret },
    });
    if (retrieved === null) {
      throw new Error("Invalid credentials");
    }
    const active = await ctx.runQuery(internal.accounts.isUserActive, {
      userId: retrieved.user._id as Id<"users">,
    });
    if (!active) {
      throw new Error("Your account has been disabled. Contact your administrator.");
    }
    return { userId: retrieved.user._id };
  },
  crypto: {
    async hashSecret(password: string) {
      return await new Scrypt().hash(password);
    },
    async verifySecret(password: string, hash: string) {
      return await new Scrypt().verify(hash, password);
    },
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [passwordCredentials, emailOtp, Anonymous],
});
