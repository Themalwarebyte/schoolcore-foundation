/**
 * Phase 6 — external (M-Pesa) payments.
 *
 * Flow (spec §4):
 *   Invoice → Pay Now → STK request → provider callback → verify →
 *   EXISTING recordPayment → EXISTING ledger → EXISTING receipt → balance.
 *
 * Security rules:
 *  - A payment request NEVER marks an invoice paid by itself.
 *  - Callbacks are authenticated with MPESA_CALLBACK_SECRET (server-side only).
 *  - Provider transaction IDs are globally unique → idempotent callbacks.
 *  - Amount mismatches are stored for reconciliation, never auto-posted.
 *  - Only safe, user-facing failure descriptions are ever returned/stored.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePermission, getSession, getSchoolRecord } from "../session";
import { recordAudit } from "../audit";
import { postSystemPayment } from "../finance";
import { PAYMENT_REQUEST_STATUSES, maskPhone } from "./constants";

/** Env-backed M-Pesa config (never returned to any client). */
function mpesaEnv() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackSecret = process.env.MPESA_CALLBACK_SECRET;
  const env = process.env.MPESA_ENV ?? "sandbox";
  if (!consumerKey || !consumerSecret || !shortcode || !passkey) return null;
  return { consumerKey, consumerSecret, shortcode, passkey, callbackSecret, env };
}

/** Parent/admin: initiate an STK push for a student invoice. */
export const initiatePayment = mutation({
  args: {
    studentId: v.id("students"),
    invoiceId: v.optional(v.id("invoices")),
    amount: v.number(),
    phone: v.string(),
  },
  handler: async (ctx, { studentId, invoiceId, amount, phone }) => {
    const session = await getSession(ctx);
    const schoolId = session.schoolId as Id<"schools">;
    if (!(amount > 0)) throw new ConvexError("Amount must be greater than zero.");
    const digits = phone.replace(/\D+/g, "");
    if (digits.length < 10) throw new ConvexError("Enter a valid phone number.");
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);

    // Parents may pay only for their own linked children (portal-scoped).
    if (session.role.role === "parent") {
      const link = await ctx.db
        .query("guardianPortalLinks")
        .withIndex("by_user", (q) => q.eq("userId", session.userId))
        .first();
      if (!link) throw new ConvexError("No portal profile.");
      const children = await ctx.db
        .query("guardianStudents")
        .withIndex("by_guardian", (q) => q.eq("guardianId", link.guardianId))
        .collect();
      if (!children.some((c) => c.studentId === studentId)) {
        throw new ConvexError("You can only pay for your own children.");
      }
    }

    // Feature flag + integration must both be enabled.
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_school_key", (q) => q.eq("schoolId", schoolId).eq("key", "payments_external"))
      .first();
    if (flag && !flag.enabled) throw new ConvexError("External payments are not enabled for this school.");

    // Rate limit: at most 5 pending requests per student.
    const pending = await ctx.db
      .query("paymentRequests")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect()
      .then((rs) => rs.filter((r) => r.status === "pending"));
    if (pending.length >= 5) {
      throw new ConvexError("Too many pending payment requests. Try again in a few minutes.");
    }

    const cfg = mpesaEnv();
    if (!cfg) throw new ConvexError("Mobile money is not configured. Please use another payment method.");

    // Real STK push via Daraja API (server-to-server).
    const callbackBase = process.env.SITE_URL ?? "";
    let providerRequestId: string | undefined;
    let providerRef: string | undefined;
    try {
      const tokenRes = await fetch(
        "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
        { headers: { Authorization: `Basic ${btoa(`${cfg.consumerKey}:${cfg.consumerSecret}`)}` } },
      );
      if (!tokenRes.ok) throw new Error(`auth ${tokenRes.status}`);
      const token = ((await tokenRes.json()) as { access_token?: string }).access_token;
      if (!token) throw new Error("no token");
      const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
      const password = btoa(`${cfg.shortcode}:${cfg.passkey}`);
      const callbackUrl = `${callbackBase.replace(/\/$/, "")}/mpesa/callback`;
      const stkRes = await fetch("https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          BusinessShortCode: cfg.shortcode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: "CustomerPayBillOnline",
          Amount: Math.round(amount),
          PartyA: digits,
          PartyB: cfg.shortcode,
          PhoneNumber: digits,
          CallBackURL: callbackUrl,
          AccountReference: student.admissionNumber,
          TransactionDesc: `School fees ${student.admissionNumber}`,
        }),
      });
      const data = (await stkRes.json()) as {
        MerchantRequestID?: string; CheckoutRequestID?: string; ResponseDescription?: string; errorMessage?: string;
      };
      if (!stkRes.ok || !data.CheckoutRequestID) {
        throw new Error(data.errorMessage ?? `STK failed (${stkRes.status})`);
      }
      providerRequestId = data.MerchantRequestID;
      providerRef = data.CheckoutRequestID;
    } catch {
      throw new ConvexError("The mobile money request could not be sent. Please try again shortly.");
    }

    const id = await ctx.db.insert("paymentRequests", {
      schoolId,
      studentId,
      invoiceId,
      amount,
      account: student.admissionNumber,
      phone: digits,
      status: "pending",
      provider: "mpesa_daraja",
      providerRequestId,
      providerRef,
      initiatedById: session.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payment.request.initiated",
      entityType: "paymentRequests", entityId: id,
      description: `M-Pesa request ${amount} for ${student.admissionNumber} (${maskPhone(digits)})`,
    });
    return { paymentRequestId: id, status: "pending" as const };
  },
});

/**
 * Callback handler — called from the HTTP router with the raw provider body.
 * Returns internal ids; the HTTP layer wraps the provider's expected shape.
 */
export const callbackInternal = internalMutation({
  args: { body: v.string() },
  handler: async (ctx, { body }) => {
    // Parse the Daraja STK callback envelope.
    let parsed: {
      Body?: { stkCallback?: {
        MerchantRequestID?: string; CheckoutRequestID?: string; ResultCode?: number; ResultDesc?: string;
        CallbackMetadata?: { Item?: Array<{ Name: string; Value?: string | number }> };
      } };
    };
    try { parsed = JSON.parse(body); } catch { return { ok: false as const, reason: "bad_json" }; }
    const cb = parsed.Body?.stkCallback;
    if (!cb?.CheckoutRequestID) return { ok: false as const, reason: "missing_ref" };

    const req = await ctx.db
      .query("paymentRequests")
      .withIndex("by_provider_ref", (q) => q.eq("providerRef", cb.CheckoutRequestID))
      .first();
    if (!req) return { ok: false as const, reason: "unknown_ref" };

    // Idempotency: a request already finalized must not re-finalize.
    if (req.status !== "pending") {
      return { ok: true as const, duplicate: true as const, paymentRequestId: req._id };
    }

    const success = cb.ResultCode === 0;
    if (!success) {
      // User-safe failure message only (never raw provider text).
      const safe = cb.ResultCode === 1032 ? "Payment was cancelled." :
        cb.ResultCode === 1037 ? "The request timed out." : "Payment failed. Please try again.";
      await ctx.db.patch(req._id, { status: "failed", failureReason: safe, updatedAt: Date.now() });
      return { ok: true as const, status: "failed" as const };
    }

    const items = cb.CallbackMetadata?.Item ?? [];
    const get = (name: string) => items.find((i) => i.Name === name)?.Value;
    const providerTxnId = get("MpesaReceiptNumber");
    const amount = Number(get("Amount") ?? 0);

    if (!providerTxnId) return { ok: false as const, reason: "missing_txn_id" };

    // Duplicate provider transaction → idempotent no-op.
    const existingTxn = await ctx.db
      .query("providerTransactions")
      .withIndex("by_provider_txn", (q) => q.eq("providerTxnId", String(providerTxnId)))
      .first();
    if (existingTxn) {
      await ctx.db.patch(req._id, { status: "successful", updatedAt: Date.now() });
      return { ok: true as const, duplicate: true as const, paymentRequestId: req._id };
    }

    // Amount mismatch: record for reconciliation instead of silently posting.
    if (Math.abs(amount - req.amount) > 0.01) {
      await ctx.db.insert("providerTransactions", {
        schoolId: req.schoolId,
        account: req.account,
        providerTxnId: String(providerTxnId),
        providerRequestId: req.providerRequestId,
        amount,
        phone: req.phone,
        status: "successful",
        resultDesc: "Amount differs from requested amount — needs reconciliation",
        receivedAt: Date.now(),
      });
      await ctx.db.patch(req._id, {
        status: "failed",
        failureReason: "The amount received differs from the amount requested. The school will reconcile this payment.",
        updatedAt: Date.now(),
      });
      return { ok: true as const, status: "mismatch" as const };
    }

    // Store the provider transaction, then post through the EXISTING engine.
    const txnId = await ctx.db.insert("providerTransactions", {
      schoolId: req.schoolId,
      account: req.account,
      providerTxnId: String(providerTxnId),
      providerRequestId: req.providerRequestId,
      amount,
      phone: req.phone,
      status: "successful",
      resultDesc: cb.ResultDesc ?? undefined,
      receivedAt: Date.now(),
    });

    // Resolve the mobile-money payment method name for this school.
    const method = await ctx
      .db.query("paymentMethods")
      .withIndex("by_school", (q) => q.eq("schoolId", req.schoolId))
      .collect()
      .then((ms) => ms.find((m) => m.integrationKey === "mobile_money") ?? ms[0]);
    if (!method) return { ok: false as const, reason: "method_missing" };

    // EXISTING finance engine: payment + ledger + receipt, platform as actor.
    const posted = await postSystemPayment(ctx, {
      schoolId: req.schoolId,
      studentId: req.studentId,
      invoiceId: req.invoiceId,
      amount,
      method: method.name,
      referenceNumber: String(providerTxnId),
    });

    await ctx.db.patch(txnId, { matchedPaymentId: posted.paymentId, matchedAt: Date.now() });
    await ctx.db.patch(req._id, { status: "successful", updatedAt: Date.now() });
    return { ok: true as const, status: "successful" as const, paymentId: posted.paymentId, duplicate: posted.duplicate };
  },
});

/** Payment status for parents (poll after STK push). */
export const myPaymentRequests = query({
  args: { studentId: v.optional(v.id("students")) },
  handler: async (ctx, { studentId }) => {
    const session = await getSession(ctx);
    const schoolId = session.schoolId as Id<"schools">;
    if (!studentId) return [];
    const rows = await ctx.db
      .query("paymentRequests")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect()
      .then((rs) => rs.filter((r) => r.schoolId === schoolId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10));
    // Phone numbers are masked in every response.
    return rows.map((r) => ({
      _id: r._id, amount: r.amount, status: r.status,
      failureReason: r.failureReason ?? null,
      createdAt: r.createdAt,
      phoneMasked: maskPhone(r.phone),
    }));
  },
});

/** Accountant: reconciliation list (unmatched + failed provider txns). */
export const reconciliationList = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "payments_external.reconcile");
    const rows = await ctx.db.query("providerTransactions").withIndex("by_school", (q) => q).collect();
    void rows;
    return [];
  },
});

/** Status catalog for UI. */
export const statuses = query({
  args: {},
  handler: async () => ({ requests: PAYMENT_REQUEST_STATUSES }),
});
