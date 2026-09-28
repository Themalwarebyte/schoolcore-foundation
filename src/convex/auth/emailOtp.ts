import { Email } from "@convex-dev/auth/providers/Email";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { getEmailProvider } from "../emailProvider";

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    // Transport is selected in ../emailProvider: Resend when RESEND_API_KEY is
    // set (self-hosted), otherwise the deprecated VLY gateway (Convex Cloud,
    // transitional). The provider ID, OTP format, expiry and verification
    // behaviour are unchanged.
    const provider = getEmailProvider();
    if (!provider) {
      throw new Error(
        "Email OTP is not configured. Set RESEND_API_KEY (self-hosted) or VLY_EMAIL_OTP_API_KEY (legacy Convex Cloud).",
      );
    }

    // The token is never logged. It is only placed in the message body.
    await provider.send({
      to: email,
      subject: "Your SchoolCore sign-in code",
      text: token,
    });
  },
});
