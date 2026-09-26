/**
 * Phase 6 — integration configuration.
 *
 * Secrets NEVER enter the database or any API response. This module stores
 * only provider kind/environment and safe display metadata. Actual M-Pesa /
 * SMS / email credentials are read from server env vars at call time.
 *
 * Env var contract (documented in docs/integrations.md):
 *   MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE,
 *   MPESA_PASSKEY, MPESA_ENV (sandbox|production), MPESA_CALLBACK_SECRET
 *   SMS_API_KEY, SMS_SENDER_ID, SMS_PROVIDER_URL
 *   EMAIL_API_KEY, EMAIL_FROM_ADDRESS
 *   GPS_INGEST_SECRET (shared secret for device ping ingestion)
 */
import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query, internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePermission } from "../session";

export const INTEGRATION_KINDS = ["payments", "sms", "email", "whatsapp", "gps"] as const;

/** Env var names required per provider kind (checked, never returned). */
const REQUIRED_ENV: Record<string, string[]> = {
  payments: ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY"],
  sms: ["SMS_API_KEY"],
  email: ["EMAIL_API_KEY"],
  whatsapp: ["WHATSAPP_API_KEY"],
  gps: ["GPS_INGEST_SECRET"],
};


export function providerConfigured(kind: string): boolean {
  const required = REQUIRED_ENV[kind] ?? [];
  return required.length === 0 || required.every((key) => !!process.env[key]);
}

/** Internal: resolved integration row for a school + kind (or defaults). */
export const getForSchoolInternal = internalQuery({
  args: { schoolId: v.id("schools"), kind: v.string() },
  handler: async (ctx, { schoolId, kind }) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_school_kind", (q) => q.eq("schoolId", schoolId).eq("kind", kind))
      .first();
    return row ?? null;
  },
});

/** Internal mutation used by seed/demo setup. */
export const upsertInternal = internalMutation({
  args: {
    schoolId: v.id("schools"),
    kind: v.string(),
    provider: v.string(),
    environment: v.string(),
    enabled: v.boolean(),
    displayMetadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, { schoolId, kind, provider, environment, enabled, displayMetadata }) => {
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_school_kind", (q) => q.eq("schoolId", schoolId).eq("kind", kind))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        provider, environment, enabled, displayMetadata, updatedAt: Date.now(),
      });
      return existing._id;
    }
    return ctx.db.insert("integrations", {
      schoolId, kind, provider, environment, enabled, displayMetadata,
    });
  },
});

/** Public: list the caller's school's integrations (safe metadata only). */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "integrations.view");
    const schoolId = session.schoolId as Id<"schools">;
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const out = [];
    for (const kind of INTEGRATION_KINDS) {
      const row = rows.find((r) => r.kind === kind);
      const envConfigured = providerConfigured(kind);
      const metadata: Record<string, string> = {};
      if (row?.displayMetadata) Object.assign(metadata, row.displayMetadata);
      out.push({
        kind,
        provider: row?.provider ?? "none",
        environment: envConfigured ? row?.environment ?? "sandbox" : "not_configured",
        enabled: row?.enabled ?? false,
        envConfigured,
        metadata,
      });
    }
    return out;
  },
});

/** Admin: enable/disable a configured integration for this school. */
export const setEnabled = mutation({
  args: { kind: v.string(), enabled: v.boolean() },
  handler: async (ctx, { kind, enabled }) => {
    const session = await requirePermission(ctx, "integrations.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!INTEGRATION_KINDS.includes(kind as never)) throw new ConvexError("Unknown integration kind.");
    if (enabled && !providerConfigured(kind)) {
      throw new ConvexError(
        "Server credentials for this integration are not configured. Ask the platform operator to set the required environment variables.",
      );
    }
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_school_kind", (q) => q.eq("schoolId", schoolId).eq("kind", kind))
      .first();
    if (!existing) {
      await ctx.db.insert("integrations", {
        schoolId, kind, provider: "none",
        environment: "sandbox", enabled,
        configuredById: session.userId, updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(existing._id, {
        enabled, configuredById: session.userId, updatedAt: Date.now(),
      });
    }
    return true;
  },
});
