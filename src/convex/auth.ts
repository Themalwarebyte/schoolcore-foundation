// Adding the Password provider for demo/production credentials. The template
// providers (email OTP + anonymous) are preserved per the template contract.
import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { emailOtp } from "./auth/emailOtp";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password(), emailOtp, Anonymous],
});
