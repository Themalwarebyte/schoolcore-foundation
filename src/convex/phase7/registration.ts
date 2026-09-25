/**
 * Phase 7 — public school registration + approval workflow.
 *
 * Flow (spec §1–5):
 *   Landing "Register Your School" → submitRequest (public)
 *   → Super Admin portal: review / more_info / reject / approve
 *   → approve creates: School workspace + super-admin membership +
 *     onboarding record (status onboarding). No school data beyond the empty
 *     workspace exists until the onboarding wizard runs.
 *
 * Every review action is audited. Documents attach to schoolRequestDocuments
 * (files table rows). Statuses: submitted → under_review → approved/rejected;
 * approved moves to onboarding; activation marks it active.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePlatformSession } from "../session";
import { recordAudit } from "../audit";
import { createInvitationCore } from "./inviteCore";

const SCHOOL_TYPES = ["public", "private", "international", "community", "faith_based"] as const;
const STATUS_FLOW: Record<string, string[]> = {
  submitted: ["under_review", "rejected"],
  under_review: ["approved", "rejected", "submitted"],
};

/** Public: submit a school registration request (no auth). */
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
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const schoolName = args.schoolName.trim();
    const email = args.email.trim().toLowerCase();
    const contactEmail = args.contactEmail.trim().toLowerCase();
    if (schoolName.length < 3) throw new ConvexError("School name must be at least 3 characters.");
    if (!email.includes("@")) throw new ConvexError("Enter a valid school email address.");
    if (!contactEmail.includes("@")) throw new ConvexError("Enter a valid contact email address.");
    if (!args.contactName.trim()) throw new ConvexError("Contact person name is required.");
    if (args.schoolType && !SCHOOL_TYPES.includes(args.schoolType as never)) {
      throw new ConvexError("Unknown school type.");
    }
    if (args.expectedStudents !== undefined && (args.expectedStudents < 0 || args.expectedStudents > 100000)) {
      throw new ConvexError("Expected students looks invalid.");
    }
    // Simple abuse guard: one open request per school email.
    const existing = await ctx.db
      .query("schoolRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()
      .then((rs) => rs.filter((r) => !["rejected", "active"].includes(r.status)));
    if (existing.length > 0) {
      throw new ConvexError("A registration request for this school email is already in progress.");
    }
    const now = Date.now();
    const requestId = await ctx.db.insert("schoolRequests", {
      schoolName,
      registrationNumber: args.registrationNumber?.trim(),
      country: args.country?.trim(),
      county: args.county?.trim(),
      physicalAddress: args.physicalAddress?.trim(),
      postalAddress: args.postalAddress?.trim(),
      schoolType: args.schoolType,
      curriculum: args.curriculum?.trim(),
      expectedStudents: args.expectedStudents,
      expectedTeachers: args.expectedTeachers,
      website: args.website?.trim(),
      email,
      phone: args.phone?.trim(),
      contactName: args.contactName.trim(),
      contactPosition: args.contactPosition?.trim(),
      contactEmail,
      contactPhone: args.contactPhone?.trim(),
      status: "submitted",
      createdAt: now,
    });
    // Public submission has no authenticated actor to attribute. auditLogs
    // rows require a real user id, so the request row itself (createdAt,
    // status, contact) is the submission record; every REVIEW action below is
    // audited against the acting super admin. Attribute the audit entry when
    // the contact email already maps to an account (re-submission case).
    const contactUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", contactEmail))
      .first();
    if (contactUser) {
      await recordAudit(ctx, {
        userId: contactUser._id,
        action: "school_request.submitted",
        entityType: "schoolRequests",
        entityId: requestId,
        description: `Registration request submitted for "${schoolName}" (${email})${args.notes ? `: ${args.notes.slice(0, 200)}` : ""}`,
      });
    }
    return { requestId };
  },
});

/** Public: attach a document (certificate/logo/supporting) to a request. */
export const attachRequestDocument = mutation({
  args: {
    requestId: v.id("schoolRequests"),
    kind: v.string(),
    filename: v.string(),
    mimeType: v.string(),
    bytes: v.bytes(),
  },
  handler: async (ctx, { requestId, kind, filename, mimeType, bytes }) => {
    if (!["registration_certificate", "logo", "supporting"].includes(kind)) {
      throw new ConvexError("Unknown document kind.");
    }
    if (bytes.byteLength > 5 * 1024 * 1024) throw new ConvexError("File exceeds the 5MB limit.");
    const request = await ctx.db.get(requestId);
    if (!request) throw new ConvexError("Registration request not found.");
    if (["approved", "rejected", "active"].includes(request.status)) {
      throw new ConvexError("This request is no longer open for uploads.");
    }
    const fileId = await ctx.db.insert("files", {
      schoolId: request.schoolId,
      uploadedById: undefined,
      filename: filename.slice(0, 200),
      mimeType: mimeType.slice(0, 100),
      bytes,
    });
    const docId = await ctx.db.insert("schoolRequestDocuments", {
      requestId,
      kind,
      fileId,
      uploadedAt: Date.now(),
    });
    return { documentId: docId, fileId };
  },
});

/** Public: check request status by email (shows coarse status only). */
export const requestStatusByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.trim().toLowerCase();
    const rows = await ctx.db
      .query("schoolRequests")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .collect();
    return rows.map((r) => ({
      requestId: r._id,
      schoolName: r.schoolName,
      status: r.status,
      submittedAt: r.createdAt,
      // Deliberately coarse: no reviewer notes to the public channel.
    }));
  },
});

/* ------------------------------------------------------------------ */
/* Super admin portal                                                  */
/* ------------------------------------------------------------------ */

/** Platform: list school requests with optional status filter. */
export const platformListRequests = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    await requirePlatformSession(ctx);
    let rows;
    if (status && status !== "all") {
      rows = await ctx.db.query("schoolRequests").withIndex("by_status", (q) => q.eq("status", status)).collect();
    } else {
      rows = await ctx.db.query("schoolRequests").collect();
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt).map((r) => ({
      _id: r._id,
      schoolName: r.schoolName,
      email: r.email,
      contactName: r.contactName,
      contactEmail: r.contactEmail,
      county: r.county ?? null,
      country: r.country ?? null,
      curriculum: r.curriculum ?? null,
      schoolType: r.schoolType ?? null,
      expectedStudents: r.expectedStudents ?? null,
      status: r.status,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt ?? null,
      schoolId: r.schoolId ?? null,
    }));
  },
});

/** Platform: full request detail incl. documents metadata. */
export const platformRequestDetail = query({
  args: { requestId: v.id("schoolRequests") },
  handler: async (ctx, { requestId }) => {
    await requirePlatformSession(ctx);
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("Registration request not found.");
    const docs = await ctx.db
      .query("schoolRequestDocuments")
      .withIndex("by_request", (q) => q.eq("requestId", requestId))
      .collect();
    const documents = [];
    for (const d of docs) {
      const file = await ctx.db.get(d.fileId);
      documents.push({
        documentId: d._id,
        kind: d.kind,
        filename: file?.filename ?? "—",
        mimeType: file?.mimeType ?? "",
        sizeBytes: file?.bytes?.byteLength ?? 0,
        uploadedAt: d.uploadedAt,
      });
    }
    const school = r.schoolId ? await ctx.db.get(r.schoolId) : null;
    return {
      request: {
        _id: r._id,
        schoolName: r.schoolName,
        registrationNumber: r.registrationNumber ?? null,
        country: r.country ?? null,
        county: r.county ?? null,
        physicalAddress: r.physicalAddress ?? null,
        postalAddress: r.postalAddress ?? null,
        schoolType: r.schoolType ?? null,
        curriculum: r.curriculum ?? null,
        expectedStudents: r.expectedStudents ?? null,
        expectedTeachers: r.expectedTeachers ?? null,
        website: r.website ?? null,
        email: r.email,
        phone: r.phone ?? null,
        contactName: r.contactName,
        contactPosition: r.contactPosition ?? null,
        contactEmail: r.contactEmail,
        contactPhone: r.contactPhone ?? null,
        status: r.status,
        decisionNotes: r.decisionNotes ?? null,
        reviewedAt: r.reviewedAt ?? null,
        createdAt: r.createdAt,
        schoolId: r.schoolId ?? null,
      },
      school: school ? { _id: school._id, name: school.name, code: school.code, status: school.status } : null,
      documents,
    };
  },
});

/** Platform: download a request document (super admin only). */
export const platformRequestDocument = query({
  args: { documentId: v.id("schoolRequestDocuments") },
  handler: async (ctx, { documentId }) => {
    await requirePlatformSession(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new ConvexError("Document not found.");
    const file = await ctx.db.get(doc.fileId);
    if (!file) throw new ConvexError("File not found.");
    return {
      filename: file.filename,
      mimeType: file.mimeType,
      bytes: file.bytes ?? null,
    };
  },
});

/** Platform: update review status (under_review / more_info back to submitted). */
export const reviewRequest = mutation({
  args: {
    requestId: v.id("schoolRequests"),
    action: v.union(v.literal("start_review"), v.literal("more_info")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, action, notes }) => {
    const session = await requirePlatformSession(ctx);
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("Registration request not found.");
    const now = Date.now();
    if (action === "start_review") {
      if (r.status !== "submitted") throw new ConvexError("Only submitted requests can move to review.");
      await ctx.db.patch(requestId, {
        status: "under_review",
        reviewedById: session.userId,
        reviewedAt: now,
        decisionNotes: notes?.trim(),
        updatedAt: now,
      });
      await recordAudit(ctx, {
        userId: session.userId, action: "school_request.review_started",
        entityType: "schoolRequests", entityId: requestId,
        description: `Review started for "${r.schoolName}"`,
      });
      return { status: "under_review" as const };
    }
    // more_info: send back to submitted with reviewer notes.
    if (!["submitted", "under_review"].includes(r.status)) {
      throw new ConvexError("Only open requests can be sent back for more information.");
    }
    if (!notes?.trim()) throw new ConvexError("Tell the school what information you need.");
    await ctx.db.patch(requestId, {
      status: "submitted",
      reviewedById: session.userId,
      reviewedAt: now,
      decisionNotes: notes.trim(),
      updatedAt: now,
    });
    await recordAudit(ctx, {
      userId: session.userId, action: "school_request.more_info",
      entityType: "schoolRequests", entityId: requestId,
      description: `More information requested for "${r.schoolName}": ${notes.trim().slice(0, 200)}`,
    });
    return { status: "submitted" as const };
  },
});

/** Platform: reject a request (audited, with mandatory reason). */
export const rejectRequest = mutation({
  args: { requestId: v.id("schoolRequests"), reason: v.string() },
  handler: async (ctx, { requestId, reason }) => {
    const session = await requirePlatformSession(ctx);
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("Registration request not found.");
    if (!["submitted", "under_review"].includes(r.status)) {
      throw new ConvexError("Only open requests can be rejected.");
    }
    if (!reason.trim()) throw new ConvexError("A rejection reason is required.");
    const now = Date.now();
    await ctx.db.patch(requestId, {
      status: "rejected",
      decisionNotes: reason.trim(),
      reviewedById: session.userId,
      reviewedAt: now,
      updatedAt: now,
    });
    await recordAudit(ctx, {
      userId: session.userId, action: "school_request.rejected",
      entityType: "schoolRequests", entityId: requestId,
      description: `Request for "${r.schoolName}" rejected: ${reason.trim().slice(0, 200)}`,
    });
    return { status: "rejected" as const };
  },
});

/**
 * Platform: approve a request. Creates the school workspace (empty except
 * identity + the requesting contact as school admin), the onboarding record
 * and flips the request to "onboarding". No students/staff/fees are created.
 */
export const approveRequest = mutation({
  args: {
    requestId: v.id("schoolRequests"),
    notes: v.optional(v.string()),
    /** Approval may adjust the final school name (normalized). */
    finalSchoolName: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, notes, finalSchoolName }) => {
    const session = await requirePlatformSession(ctx);
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("Registration request not found.");
    if (r.status !== "under_review") {
      throw new ConvexError("Start a review before approving this request.");
    }
    if (r.schoolId) throw new ConvexError("This request already has a workspace.");
    const now = Date.now();
    const name = (finalSchoolName?.trim() || r.schoolName).trim();

    // Unique school code + slug derived from the request.
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "school";
    let slug = baseSlug;
    for (let i = 2; ; i++) {
      const clash = await ctx.db.query("schools").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
      if (!clash) break;
      slug = `${baseSlug}-${i}`;
    }
    const allSchools = await ctx.db.query("schools").collect();
    const code = `SCH-${String(allSchools.length + 1).padStart(3, "0")}`;

    const schoolId = await ctx.db.insert("schools", {
      name,
      code,
      slug,
      email: r.email,
      phone: r.phone,
      website: r.website,
      postalAddress: r.postalAddress,
      physicalAddress: r.physicalAddress,
      county: r.county,
      country: r.country,
      currency: "KES",
      curriculum: r.curriculum,
      status: "inactive", // activated at the end of onboarding
      createdBy: session.userId,
    });

    // Contact person becomes the first school admin via a one-time activation
    // token (never a shared temp password — Phase 7 rule §12).
    let contactUserId: Id<"users"> | null = null;
    try {
      const result = await createInvitationCore(ctx, {
        session,
        schoolId,
        email: r.contactEmail,
        name: r.contactName,
        role: "school_admin",
      });
      contactUserId = result.userId;
    } catch {
      // The wizard's Initial Users step can still provision the admin if the
      // contact email collides with an existing platform account.
      contactUserId = null;
    }

    await ctx.db.insert("onboardingRecords", {
      schoolId,
      requestId,
      profileDone: false,
      academicsDone: false,
      usersDone: false,
      importDone: false,
      activated: false,
      notes: notes?.trim(),
      createdAt: now,
    });

    await ctx.db.patch(requestId, {
      status: "onboarding",
      schoolId,
      decisionNotes: notes?.trim() ?? r.decisionNotes,
      reviewedById: session.userId,
      reviewedAt: now,
      updatedAt: now,
    });

    await recordAudit(ctx, {
      userId: session.userId, action: "school_request.approved",
      entityType: "schoolRequests", entityId: requestId,
      description: `Request approved — workspace "${name}" (${code}) created; onboarding started`,
      metadata: { schoolId, code },
    });
    return { schoolId, status: "onboarding" as const, contactUserId };
  },
});

/** Internal: mark a request active once its onboarding completes. */
export const activateRequestInternal = internalMutation({
  args: { requestId: v.id("schoolRequests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("Registration request not found.");
    if (r.status !== "onboarding") throw new ConvexError("Only onboarding requests can be activated.");
    await ctx.db.patch(requestId, { status: "active", updatedAt: Date.now() });
    return { status: "active" as const };
  },
});

/** Platform: aggregate counts for the platform dashboard. */
export const platformRequestStats = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformSession(ctx);
    const rows = await ctx.db.query("schoolRequests").collect();
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return {
      total: rows.length,
      byStatus: counts,
      pending: (counts["submitted"] ?? 0) + (counts["under_review"] ?? 0),
      onboarding: counts["onboarding"] ?? 0,
      active: counts["active"] ?? 0,
    };
  },
});

void STATUS_FLOW;
