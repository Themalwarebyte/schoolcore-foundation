/**
 * Phase 6 — communication platform.
 *
 * Architecture (spec §8/§14):
 *   Notification Event → Channel Router → In-App / SMS / Email / WhatsApp
 *
 * Providers are pluggable; business logic never calls a provider directly.
 * Without provider credentials the router records messages as queued with a
 * "not configured" failure reason — never fake success.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requirePermission, getSession } from "../session";
import { recordAudit } from "../audit";
import { COMM_EVENTS, renderTemplate, templateVariables } from "./constants";

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

export const listSmsTemplates = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "communications.view");
    return ctx.db
      .query("smsTemplates")
      .withIndex("by_school_event", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
  },
});

export const upsertSmsTemplate = mutation({
  args: { event: v.string(), name: v.string(), body: v.string(), enabled: v.boolean() },
  handler: async (ctx, { event, name, body, enabled }) => {
    const session = await requirePermission(ctx, "communications.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!COMM_EVENTS.includes(event as never)) throw new ConvexError("Unknown communication event.");
    if (!body.trim()) throw new ConvexError("Template body is required.");
    const existing = await ctx.db
      .query("smsTemplates")
      .withIndex("by_school_event", (q) => q.eq("schoolId", schoolId).eq("event", event))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { name, body, enabled, updatedAt: Date.now(), updatedById: session.userId });
      return existing._id;
    }
    return ctx.db.insert("smsTemplates", { schoolId, event, name, body, enabled, updatedById: session.userId });
  },
});

export const listEmailTemplates = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "communications.view");
    return ctx.db
      .query("emailTemplates")
      .withIndex("by_school_event", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
  },
});

export const upsertEmailTemplate = mutation({
  args: { event: v.string(), name: v.string(), subject: v.string(), text: v.string(), enabled: v.boolean() },
  handler: async (ctx, { event, name, subject, text, enabled }) => {
    const session = await requirePermission(ctx, "communications.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!COMM_EVENTS.includes(event as never)) throw new ConvexError("Unknown communication event.");
    const existing = await ctx.db
      .query("emailTemplates")
      .withIndex("by_school_event", (q) => q.eq("schoolId", schoolId).eq("event", event))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { name, subject, text, enabled, updatedAt: Date.now(), updatedById: session.userId });
      return existing._id;
    }
    return ctx.db.insert("emailTemplates", { schoolId, event, name, subject, text, enabled, updatedById: session.userId });
  },
});

/* ------------------------------------------------------------------ */
/* Delivery log                                                        */
/* ------------------------------------------------------------------ */

export const deliveryLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const session = await requirePermission(ctx, "communications.view");
    const rows = await ctx.db
      .query("commMessages")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return rows
      .sort((a, b) => b.queuedAt - a.queuedAt)
      .slice(0, limit ?? 100)
      .map((m) => ({
        _id: m._id, channel: m.channel, event: m.event, status: m.status,
        // Address is masked: deliverability info without exposing full PII.
        recipientMasked: m.recipientAddress
          ? m.recipientAddress.includes("@")
            ? `${m.recipientAddress.slice(0, 2)}***${m.recipientAddress.slice(m.recipientAddress.indexOf("@"))}`
            : m.recipientAddress.replace(/\d(?=\d{4})/g, "*")
          : "in-app",
        body: m.body.slice(0, 120),
        failureReason: m.failureReason ?? null,
        attempts: m.attempts,
        queuedAt: m.queuedAt, sentAt: m.sentAt ?? null,
      }));
  },
});

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

export const myPreferences = query({
  args: {},
  handler: async (ctx) => {
    const session = await getSession(ctx);
    const row = await ctx.db
      .query("commPreferences")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    return row ?? { inApp: true, sms: true, email: false, whatsapp: false };
  },
});

export const setMyPreferences = mutation({
  args: { inApp: v.boolean(), sms: v.boolean(), email: v.boolean(), whatsapp: v.optional(v.boolean()) },
  handler: async (ctx, { inApp, sms, email, whatsapp }) => {
    const session = await getSession(ctx);
    const schoolId = session.schoolId as Id<"schools">;
    const existing = await ctx.db
      .query("commPreferences")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { inApp, sms, email, whatsapp, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("commPreferences", { schoolId, userId: session.userId, inApp, sms, email, whatsapp, updatedAt: Date.now() });
    }
    return true;
  },
});

/* ------------------------------------------------------------------ */
/* Channel router (internal)                                           */
/* ------------------------------------------------------------------ */

/** Resolve recipients for an event + audience (parents of students, staff...). */
export const resolveRecipientsInternal = internalQuery({
  args: {
    schoolId: v.id("schools"),
    audience: v.string(), // all_parents | class | grade | student | staff_all
    audienceId: v.optional(v.string()),
  },
  handler: async (ctx, { schoolId, audience, audienceId }) => {
    const out: Array<{ userId: Id<"users">; studentId?: Id<"students">; address?: string }> = [];
    if (audience === "all_parents") {
      const links = await ctx.db
        .query("guardianPortalLinks")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect()
        .then((ls) => ls.filter((l) => l.status === "active"));
      for (const l of links) out.push({ userId: l.userId });
    } else if (audience === "class" && audienceId) {
      const enrolls = await ctx.db
        .query("enrollments")
        .withIndex("by_class_section", (q) => q.eq("classSectionId", audienceId as Id<"classSections">))
        .collect()
        .then((es) => es.filter((e) => e.status === "active"));
      for (const e of enrolls) {
        const links = await ctx.db
          .query("guardianStudents")
          .withIndex("by_student", (q) => q.eq("studentId", e.studentId))
          .collect();
        for (const gl of links) {
          const portal = await ctx.db
            .query("guardianPortalLinks")
            .withIndex("by_guardian", (q) => q.eq("guardianId", gl.guardianId))
            .collect()
            .then((ps) => ps.find((p) => p.status === "active" && p.schoolId === schoolId));
          if (portal) out.push({ userId: portal.userId, studentId: e.studentId });
        }
      }
    }
    // Dedupe by user.
    const seen = new Set<string>();
    return out.filter((o) => (seen.has(o.userId) ? false : (seen.add(o.userId), true)));
  },
});

/**
 * Queue messages for a set of recipients through the channel router.
 * In-app messages are delivered via the existing notifications table.
 * SMS/email/WhatsApp require a configured provider — otherwise they are
 * stored with status failed + reason "not_configured" (never fake success).
 */
export const queueMessagesInternal = internalMutation({
  args: {
    schoolId: v.id("schools"),
    channel: v.string(), // in_app | sms | email | whatsapp
    event: v.string(),
    body: v.string(),
    recipients: v.array(v.object({ userId: v.string(), studentId: v.optional(v.string()) })),
    actorId: v.optional(v.id("users")),
  },
  handler: async (ctx, { schoolId, channel, event, body, recipients, actorId }) => {
    let queued = 0;
    for (const r of recipients) {
      if (channel === "in_app") {
        // Existing Phase 4 notification pipeline.
        await ctx.db.insert("appNotifications", {
          schoolId,
          userId: r.userId as Id<"users">,
          type: event,
          title: "School notice",
          body,
          readAt: undefined,
          createdAt: Date.now(),
        });
        await ctx.db.insert("commMessages", {
          schoolId, channel, event, recipientKind: "parent",
          recipientUserId: r.userId as Id<"users">, studentId: r.studentId as Id<"students"> | undefined,
          body, status: "sent", attempts: 1, queuedAt: Date.now(), sentAt: Date.now(),
        });
      } else {
        // Provider channel: check configuration from integrations config.
        const kind = channel === "sms" ? "sms" : channel === "email" ? "email" : "whatsapp";
        const cfg = await ctx.db
          .query("integrations")
          .withIndex("by_school_kind", (q) => q.eq("schoolId", schoolId).eq("kind", kind))
          .first();
        const envConfigured =
          kind === "sms" ? !!process.env.SMS_API_KEY :
          kind === "email" ? !!process.env.EMAIL_API_KEY :
          !!process.env.WHATSAPP_API_KEY;
        const deliverable = cfg?.enabled && envConfigured;
        await ctx.db.insert("commMessages", {
          schoolId, channel, event, recipientKind: "parent",
          recipientUserId: r.userId as Id<"users">, studentId: r.studentId as Id<"students"> | undefined,
          body, status: deliverable ? "queued" : "failed",
          failureReason: deliverable ? undefined : `${kind} integration is not configured`,
          attempts: 0, queuedAt: Date.now(),
        });
      }
      queued++;
    }
    return { queued };
  },
});

/** Bulk job runner: processes a comm job in batches (idempotent per batch). */
export const processJobInternal = internalMutation({
  args: { jobId: v.id("commJobs"), batchSize: v.optional(v.number()) },
  handler: async (ctx, { jobId, batchSize }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status === "completed") return { done: true as const };
    const size = batchSize ?? 50;
    const pending = await ctx.db
      .query("commMessages")
      .withIndex("by_school_status", (q) => q.eq("schoolId", job.schoolId).eq("status", "queued"))
      .collect()
      .then((ms) => ms.filter((m) => m.event === job.event).slice(0, size));
    let sent = 0, failed = 0;
    for (const m of pending) {
      // Provider send would happen here; without credentials, fail fast with
      // a clear reason and bounded retries (max 3 → permanent failure).
      const attempts = m.attempts + 1;
      const canRetry = attempts < 3;
      const providerReady =
        (m.channel === "sms" && process.env.SMS_API_KEY) ||
        (m.channel === "email" && process.env.EMAIL_API_KEY) ||
        (m.channel === "whatsapp" && process.env.WHATSAPP_API_KEY);
      if (!providerReady) {
        await ctx.db.patch(m._id, { status: "failed", failureReason: `${m.channel} integration is not configured`, attempts });
        failed++;
      } else if (canRetry) {
        await ctx.db.patch(m._id, { status: "queued", attempts });
      } else {
        await ctx.db.patch(m._id, { status: "failed", failureReason: "Delivery failed after retries", attempts });
        failed++;
      }
    }
    const totalSent = job.sentCount + sent;
    const totalFailed = job.failedCount + failed;
    const remaining = pending.filter((m) => m.status === "queued").length;
    await ctx.db.patch(jobId, {
      sentCount: totalSent, failedCount: totalFailed,
      status: remaining === 0 && pending.length > 0 ? "completed" : job.status,
      completedAt: remaining === 0 && pending.length > 0 ? Date.now() : undefined,
    });
    return { done: remaining === 0, processed: pending.length };
  },
});

/* ------------------------------------------------------------------ */
/* Bulk send (admin)                                                   */
/* ------------------------------------------------------------------ */

export const createBulkJob = mutation({
  args: {
    channel: v.string(), // in_app | sms | email
    event: v.string(),
    audience: v.string(),
    audienceId: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, { channel, event, audience, audienceId, body }) => {
    const session = await requirePermission(ctx, "communications.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!body.trim()) throw new ConvexError("Message body is required.");
    if (body.length > 1000) throw new ConvexError("Message body is too long (max 1000 characters).");
    const recipients = await ctx.runQuery(internal.phase6.communications.resolveRecipientsInternal, { schoolId, audience, audienceId });
    const jobId = await ctx.db.insert("commJobs", {
      schoolId, channel, event, audience, audienceId,
      body: renderTemplate(body, {}),
      totalCount: recipients.length, sentCount: 0, failedCount: 0,
      status: "queued", createdById: session.userId, createdAt: Date.now(),
    });
    await ctx.runMutation(internal.phase6.communications.queueMessagesInternal, {
      schoolId, channel, event, body,
      recipients: recipients.map((r) => ({ userId: r.userId, studentId: r.studentId })),
      actorId: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "communication.bulk_queued",
      entityType: "commJobs", entityId: jobId,
      description: `Bulk ${channel} job queued for ${recipients.length} recipient(s) (${event})`,
    });
    return { jobId, recipients: recipients.length };
  },
});

export const listJobs = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "communications.view");
    const rows = await ctx.db
      .query("commJobs")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  },
});

void internalQuery;
void templateVariables;
