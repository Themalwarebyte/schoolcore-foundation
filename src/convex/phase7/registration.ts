/**
 * Phase 7 — public school registration + platform approval workflow.
 *
 * Public (unauthenticated): submitRequest — creates a SchoolRequest with
 * status "submitted" and stores uploads (certificate/logo/supporting) in the
 * existing files table.
 *
 * Super admin (platform): list, detail (incl. documents), review decisions
 * (approve / reject / more_info). Approve provisions the school workspace
 * (schools + onboardingRecords + subscription) but does NOT create full
 * school data — that happens through the onboarding wizard.
 *
 * Every platform action is audited.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requirePlatformSession } from "../session";
import { recordAudit } from "../audit";

const REQUEST_STATUSES = [
  "submitted", "under_review", "approved", "rejected", "onboarding", "active",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */
/* Public: submit a school registration request                        */
/* ------------------------------------------------------------------ */

export const submitRequest = mutation({
  args: {
    schoolName: v.string(),
    registrationNumber: v.optional(v.string()),
    country: v.optional(v.string()),
    county: v.optional(v.string()),
    physicalAddress: v.optional(v.string()),
    postalAddress: v.optional(v.string()),
    schoolType: v.optional(v.string()),
    curriculum: v.optional(v.string()),
    expectedStudents: v.optional(v.number()),
    expectedTeachers: v.optional(v.number()),
    website: v.optional(v.string()),
    email: v.string(),
    phone: v.optional(v.string()),
    contactName: v.string(),
    contactPosition: v.optional(v.string()),
    contactEmail: v.string(),
    contactPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const schoolName = args.schoolName.trim();
    const email = args.email.trim().toLowerCase();
    const contactEmail = args.contactEmail.trim().toLowerCase();
    if (schoolName.length < 3) throw new ConvexError("School name is required.");
    if (!EMAIL_RE.test(email)) throw new ConvexError("Enter a valid school email.");
    if (!EMAIL_RE.test(contactEmail)) throw new ConvexError("Enter a valid contact email.");
    if (!args.contactName.trim()) throw new ConvexError("Contact person name is required.");

    // One open request per school email (approved/rejected ones don't block).
    const existing = await ctx.db
      .query("schoolRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    if (existing.some((r) => ["submitted", "under_review", "onboarding"].includes(r.status))) {
      throw new ConvexError("A registration request for this school email is already in progress.");
    }

    const id = await ctx.db.insert("schoolRequests", {
      ...args,
      schoolName,
      email,
      contactEmail,
      contactName: args.contactName.trim(),
      status: "submitted",
      createdAt: Date.now(),
    });
    return { requestId: id };
  },
});

/** Public status check by email so applicants can see where they stand. */
export const requestStatus = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();
    const row = await ctx.db
      .query("schoolRequests")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .order("desc")
      .first();
    if (!row) return null;
    return {
      status: row.status,
      schoolName: row.schoolName,
      submittedAt: row.createdAt,
      decisionNotes: row.decisionNotes ?? null,
      // Deliberately minimal: no contact details leak without authentication.
    };
  },
});

/* ------------------------------------------------------------------ */
/* Platform: review + decisions (super admin)                          */
/* ------------------------------------------------------------------ */

export const listRequests = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    await requirePlatformSession(ctx);
    let rows;
    if (status && status !== "all") {
      rows = await ctx.db
        .query("schoolRequests")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
    } else {
      rows = await ctx.db.query("schoolRequests").collect();
    }
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        _id: r._id,
        schoolName: r.schoolName,
        email: r.email,
        county: r.county ?? null,
        country: r.country ?? null,
        curriculum: r.curriculum ?? null,
        schoolType: r.schoolType ?? null,
        expectedStudents: r.expectedStudents ?? null,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        status: r.status,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt ?? null,
        decisionNotes: r.decisionNotes ?? null,
        schoolId: r.schoolId ?? null,
      }));
  },
});

export const requestDetail = query({
  args: { requestId: v.id("schoolRequests") },
  handler: async (ctx, { requestId }) => {
    await requirePlatformSession(ctx);
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("Request not found.");
    const docs = await ctx.db
      .query("schoolRequestDocuments")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .collect();
    const reviewer = r.reviewedById ? await ctx.db.get(r.reviewedById) : null;
    const school = r.schoolId ? await ctx.db.get(r.schoolId) : null;
    return {
      request: { ...r },
      documents: docs.map((d) => ({
        _id: d._id, kind: d.kind, fileId: d.fileId, uploadedAt: d.uploadedAt,
      })),
      reviewer: reviewer ? { name: reviewer.name ?? reviewer.email ?? "" } : null,
      school: school ? { _id: school._id, name: school.name, code: school.code } : null,
    };
  },
});

export const reviewRequest = mutation({
  args: {
    requestId: v.id("schoolRequests"),
    decision: v.union(v.literal("approve"), v.literal("reject"), v.literal("more_info"), v.literal("under_review")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, decision, notes }) => {
    const session = await requirePlatformSession(ctx);
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("Request not found.");
    if (r.status === "approved") throw new ConvexError("This request is already approved.");
    if (r.status === "active") throw new ConvexError("This school is already active.");

    const now = Date.now();
    let schoolId: Id<"schools"> | undefined = r.schoolId;

    if (decision === "under_review") {
      if (r.status !== "submitted" && r.status !== "under_review") {
        throw new ConvexError("Only submitted requests can move to review.");
      }
      await ctx.db.patch(requestId, {
        status: "under_review", reviewedById: session.userId, reviewedAt: now,
        decisionNotes: notes ?? r.decisionNotes, updatedAt: now,
      });
    } else if (decision === "reject") {
      if (!notes?.trim()) throw new ConvexError("A rejection reason is required.");
      await ctx.db.patch(requestId, {
        status: "rejected", reviewedById: session.userId, reviewedAt: now,
        decisionNotes: notes.trim(), updatedAt: now,
      });
    } else if (decision === "more_info") {
      if (!notes?.trim()) throw new ConvexError("Describe what information is needed.");
      if (r.status !== "submitted" && r.status !== "under_review") {
        throw new ConvexError("Only open requests can be sent back for more information.");
      }
      await ctx.db.patch(requestId, {
        status: "under_review", reviewedById: session.userId, reviewedAt: now,
        decisionNotes: notes.trim(), updatedAt: now,
      });
    } else {
      // approve → provision the workspace (school shell + onboarding record).
      if (r.status === "onboarding") throw new ConvexError("Onboarding already started for this request.");
      if (schoolId) throw new ConvexError("This request already has a school workspace.");
      schoolId = await ctx.runMutation(internal.phase7.registration.provisionSchoolInternal, {
        requestId, userId: session.userId, notes: notes ?? undefined,
      });
    }

    await recordAudit(ctx, {
      userId: session.userId,
      action: `school_request.${decision}`,
      entityType: "schoolRequests",
      entityId: requestId,
      schoolId: schoolId ?? undefined,
      description: `School request "${r.schoolName}": ${decision}` + (notes ? ` — ${notes}` : ""),
    });
    return { ok: true as const, schoolId: schoolId ?? null, status: decision === "approve" ? "onboarding" : undefined };
  },
});

/* ------------------------------------------------------------------ */
/* Internal: workspace provisioning                                    */
/* ------------------------------------------------------------------ */

/**
 * Approved request → Onboarding record → School workspace.
 * Creates the school shell (slug + unique code), an onboarding record and a
 * Starter subscription. No academic/user data is created here.
 */
export const provisionSchoolInternal = internalMutation({
  args: {
    requestId: v.id("schoolRequests"),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, userId, notes }) => {
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("Request not found.");
    if (r.schoolId) return r.schoolId;

    const now = Date.now();
    // Unique slug from the school name.
    const baseSlug = r.schoolName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "school";
    let slug = baseSlug;
    for (let i = 0; i < 20; i++) {
      const clash = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
      if (!clash) break;
      slug = `${baseSlug}-${i + 2}`;
    }
    // Unique short school code.
    let code = "";
    for (let i = 0; i < 30; i++) {
      code = `SCH-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const clash = await ctx.db.query("schools").withIndex("by_code", (q) => q.eq("code", code)).first();
      if (!clash) break;
    }

    const schoolId = await ctx.db.insert("schools", {
      name: r.schoolName,
      code,
      slug,
      phone: r.phone,
      email: r.email,
      website: r.website,
      postalAddress: r.postalAddress,
      physicalAddress: r.physicalAddress,
      county: r.county,
      country: r.country,
      currency: "KES",
      curriculum: r.curriculum,
      status: "inactive", // activated by the onboarding wizard's final step
      createdBy: userId,
    });

    // Onboarding progress record (idempotent).
    const existingRecord = await ctx.db
      .query("onboardingRecords")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    if (!existingRecord) {
      await ctx.db.insert("onboardingRecords", {
        schoolId,
        requestId,
        profileDone: false,
        academicsDone: false,
        usersDone: false,
        importDone: false,
        activated: false,
        notes,
        createdAt: now,
      });
    }

    // Default Starter subscription so the school is commercially usable.
    const starter = await ctx.db.query("plans").withIndex("by_slug", (q) => q.eq("slug", "starter")).first();
    if (starter) {
      const existingSub = await ctx.db
        .query("schoolSubscriptions")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .first();
      if (!existingSub) {
        await ctx.db.insert("schoolSubscriptions", {
          schoolId,
          planId: starter._id,
          status: "trial",
          trialEndsAt: now + 30 * 24 * 3600 * 1000,
          startedAt: now,
        });
      }
    }

    await ctx.db.patch(requestId, {
      status: "onboarding",
      schoolId,
      reviewedById: userId,
      reviewedAt: now,
      decisionNotes: notes ?? r.decisionNotes,
      updatedAt: now,
    });
    return schoolId;
  },
});

/** Allowed statuses exported for UI + tests. */
export const statuses = query({
  args: {},
  handler: async () => ({ statuses: REQUEST_STATUSES }),
});
