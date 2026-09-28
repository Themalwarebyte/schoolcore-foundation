// Email provider abstraction for SchoolCore.
//
// Business logic (Convex Auth OTP, the communications queue) must never call a
// provider SDK directly. This module selects a provider from the deployment
// environment and exposes a single `send()` shape.
//
// Selection order (first match wins):
//   1. RESEND_API_KEY              -> Resend          (self-hosted target)
//   2. VLY_EMAIL_OTP_API_KEY       -> legacy gateway  (Convex Cloud, transitional)
//   3. (neither)                   -> null            -> callers fail clearly
//
// The legacy VLY gateway is DEPRECATED and scheduled for deletion after
// production cutover. See docs/EMAIL_RESEND_MIGRATION.md.
//
// The self-hosted deployment sets RESEND_API_KEY and therefore never requires
// VLY_* or freebuff.com.

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  id?: string;
};

export type EmailProvider = {
  id: "resend" | "vly-gateway";
  send(message: EmailMessage): Promise<EmailSendResult>;
};

/**
 * Resend sending address.
 *
 * Production MUST set RESEND_FROM_EMAIL to an address on a verified sending
 * domain (SPF/DKIM). If unset we fall back to Resend's onboarding address,
 * which Resend only permits for sending to the account owner's own mailbox —
 * it is a development convenience and will fail for arbitrary recipients.
 */
export function resolveFromAddress(): string {
  const configured = process.env.RESEND_FROM_EMAIL?.trim();
  if (configured) return configured;
  return "SchoolCore <onboarding@resend.dev>";
}

function resendProvider(apiKey: string): EmailProvider {
  return {
    id: "resend",
    async send({ to, subject, text, html }: EmailMessage): Promise<EmailSendResult> {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: resolveFromAddress(),
          to: [to],
          subject,
          text,
          ...(html ? { html } : {}),
        }),
      });

      if (!response.ok) {
        // Log status only. Resend error bodies can echo the recipient address,
        // which is PII we do not want in deployment logs.
        const status = response.status;
        throw new Error(`Resend rejected the message (HTTP ${status}).`);
      }

      const payload = (await response.json()) as { id?: string };
      return { id: payload.id };
    },
  };
}

function legacyGatewayProvider(apiKey: string): EmailProvider {
  return {
    id: "vly-gateway",
    async send({ to, text }: EmailMessage): Promise<EmailSendResult> {
      // Imported lazily so the legacy code path is only pulled in when the
      // deployment is still configured for the Convex Cloud gateway.
      const { default: axios } = await import("axios");
      await axios.post(
        "https://auth.freebuff.app/send_otp",
        {
          to,
          otp: text,
          appName: process.env.VLY_APP_NAME || "a freebuff.com application",
        },
        { headers: { "x-api-key": apiKey } },
      );
      return {};
    },
  };
}

/**
 * Resolve the active email provider, or null when none is configured.
 * Callers must handle null explicitly rather than silently succeeding.
 */
export function getEmailProvider(): EmailProvider | null {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (resendKey) return resendProvider(resendKey);

  // DEPRECATED: transitional fallback for the existing Convex Cloud deployment.
  const legacyKey = process.env.VLY_EMAIL_OTP_API_KEY?.trim();
  if (legacyKey) return legacyGatewayProvider(legacyKey);

  return null;
}
