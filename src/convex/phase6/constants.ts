/**
 * Phase 6 — shared constants and small pure helpers used across the
 * platform modules (payments, comms, automation, SaaS, QR).
 */

export const PAYMENT_REQUEST_STATUSES = [
  "pending", "successful", "failed", "cancelled", "timed_out", "reversed",
] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const PROVIDER_TXN_STATUSES = [
  "successful", "failed", "cancelled", "timed_out", "reversed",
] as const;
export type ProviderTxnStatus = (typeof PROVIDER_TXN_STATUSES)[number];

export const COMM_CHANNELS = ["in_app", "sms", "email", "whatsapp"] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];

export const COMM_STATUSES = ["queued", "processing", "sent", "failed"] as const;

export const COMM_EVENTS = [
  "attendance_absence", "fee_reminder", "payment_receipt", "result_published",
  "announcement", "emergency", "portal_invite", "custom",
] as const;
export type CommEvent = (typeof COMM_EVENTS)[number];

export const AUTOMATION_TRIGGERS = [
  "student_absent", "invoice_overdue", "payment_confirmed", "results_published",
  "assignment_published", "leave_requested", "stock_below_threshold",
  "library_overdue", "contract_nearing_expiry",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_ACTION_TYPES = [
  "in_app", "sms", "email", "task", "admin_alert",
] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const SUBSCRIPTION_STATUSES = [
  "trial", "active", "past_due", "suspended", "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const FEATURE_FLAG_KEYS = [
  "payments_external", "sms", "email", "whatsapp", "gps_tracking",
  "biometrics", "ai_insights", "advanced_analytics", "data_import",
] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/** Entitlement keys used by plans. */
export const ENTITLEMENT_KEYS = [
  "maxStudents", "maxAdmins", "sms", "email", "gps", "ai",
  "advancedAnalytics", "paymentsExternal",
] as const;

/* ------------------------------------------------------------------ */
/* Template rendering                                                  */
/* ------------------------------------------------------------------ */

const TEMPLATE_VAR = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Safe {variable} substitution. Unknown/invalid variables render as empty
 * strings; no code execution is possible because values are inserted as
 * plain strings and variable names are strictly validated.
 */
export function renderTemplate(body: string, vars: Record<string, string | number | undefined | null>): string {
  return body.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, name: string) => {
    if (!TEMPLATE_VAR.test(name)) return "";
    const value = vars[name];
    return value === undefined || value === null ? "" : String(value);
  });
}

/** Extract variable names used by a template body. */
export function templateVariables(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) {
    names.add(match[1]);
  }
  return [...names];
}

/* ------------------------------------------------------------------ */
/* QR token generation (opaque, URL-safe, 32 chars ≈ 190 bits)         */
/* ------------------------------------------------------------------ */

const QR_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += QR_ALPHABET[b % QR_ALPHABET.length];
  return out;
}

/** Mask a phone number for display: +254 712 *** ***4. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 6) return "***";
  return `${phone.slice(0, phone.length - 4).replace(/\d/g, "*")}${phone.slice(-4)}`;
}

/** Mask a reference code, keeping only the first 4 characters visible. */
export function maskReference(ref: string): string {
  if (ref.length <= 4) return "****";
  return `${ref.slice(0, 4)}****`;
}
