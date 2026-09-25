/**
 * Phase 7 — admissions: application → review → assessment → decision →
 * conversion (Student + Guardian + Enrollment + Invoice) with NO data
 * re-entry: conversion reuses the application's stored fields.
 *
 * Application numbers are sequential per school (APP-YYYY-00001).
 * Conversion is idempotent — a converted application cannot convert again.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePermission, getSchoolRecord } from "../session";
import { recordAudit } from "../audit";
import { APPLICATION_STATUSES } from "../schema";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normPhone = (p: string) => p.replace(/[\s-()]/g, "");

type NumberCtx = import("../_generated/server").QueryCtx | import("../_generated/server").MutationCtx;

async function nextApplicationNumber(ctx: NumberCtx, schoolId: Id<"schools">): Promise<string> {
  const rows = await ctx.db.query("applications").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  const year = new Date().getFullYear();
  const max = rows.reduce((m, r) => {
    const n = Number(r.applicationNumber.split("-").pop());
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `APP-${year}-${String(max + 1).padStart(5, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Create / list / detail                                              */
/* ------------------------------------------------------------------ */

export const submitApplication = mutation({
  args: {
    firstName: v.string(),
    middleName: v.optional(v.string()),
    lastName: v.string(),
    dateOfBirth: v.optional(v.string()),
    gender: v.optional(v.string()),
    previousSchool: v.optional(v.string()),
    notes: v.optional(v.string()),
    guardianName: v.string(),
    guardianPhone: v.string(),
    guardianEmail: v.optional(v.string()),
    guardianRelationship: v.optional(v.string()),
    appliedGradeLevelId: v.optional(v.id("gradeLevels")),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "admissions.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!args.firstName.trim() || !args.lastName.trim()) throw new ConvexError("Student names are required.");
    if (!args.guardianName.trim()) throw new ConvexError("Guardian name is required.");
    const gPhone = normPhone(args.guardianPhone.trim());
    if (!gPhone) throw new ConvexError("Guardian phone is required.");
    if (args.guardianEmail?.trim() && !EMAIL_RE.test(args.guardianEmail.trim())) {
      throw new ConvexError("Enter a valid guardian email.");
    }
    if (args.appliedGradeLevelId) {
      await getSchoolRecord(ctx, schoolId, "gradeLevels", args.appliedGradeLevelId);
    }
    const applicationNumber = await nextApplicationNumber(ctx, schoolId);
    const id = await ctx.db.insert("applications", {
      schoolId,
      applicationNumber,
      firstName: args.firstName.trim(),
      middleName: args.middleName?.trim() || undefined,
      lastName: args.lastName.trim(),
      dateOfBirth: args.dateOfBirth?.trim() || undefined,
      gender: args.gender?.trim().toLowerCase() || undefined,
      previousSchool: args.previousSchool?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      guardianName: args.guardianName.trim(),
      guardianPhone: gPhone,
      guardianEmail: args.guardianEmail?.trim().toLowerCase() || undefined,
      guardianRelationship: args.guardianRelationship?.trim() || undefined,
      appliedGradeLevelId: args.appliedGradeLevelId,
      status: "submitted",
      submittedById: session.userId,
      submittedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "admissions.application_submitted",
      entityType: "applications", entityId: id,
      description: `Application ${applicationNumber} submitted for ${args.firstName} ${args.lastName}`,
    });
    return { applicationId: id, applicationNumber };
  },
});

/** Admissions dashboard: counts + list in one query. */
export const listApplications = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const session = await requirePermission(ctx, "admissions.view");
    const schoolId = session.schoolId as Id<"schools">;
    const rows = await ctx.db
      .query("applications")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const gradeNames = new Map<Id<"gradeLevels">, string>();
    const out = [];
    for (const r of rows.sort((a, b) => b.submittedAt - a.submittedAt)) {
      if (r.appliedGradeLevelId && !gradeNames.has(r.appliedGradeLevelId)) {
        gradeNames.set(r.appliedGradeLevelId, (await ctx.db.get(r.appliedGradeLevelId))?.name ?? "—");
      }
      if (status && status !== "all" && r.status !== status) continue;
      out.push({
        _id: r._id,
        applicationNumber: r.applicationNumber,
        studentName: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
        gender: r.gender ?? null,
        guardianName: r.guardianName,
        guardianPhone: r.guardianPhone,
        appliedGrade: r.appliedGradeLevelId ? gradeNames.get(r.appliedGradeLevelId) ?? "—" : null,
        status: r.status,
        assessmentScore: r.assessmentScore ?? null,
        submittedAt: r.submittedAt,
        convertedStudentId: r.studentId ?? null,
      });
    }
    const counts = {
      total: rows.length,
      submitted: rows.filter((r) => r.status === "submitted").length,
      underReview: rows.filter((r) => r.status === "under_review").length,
      assessment: rows.filter((r) => r.status === "assessment").length,
      accepted: rows.filter((r) => r.status === "accepted").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
      enrolled: rows.filter((r) => r.status === "enrolled").length,
    };
    return { applications: out, counts, statuses: APPLICATION_STATUSES };
  },
});

export const applicationDetail = query({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, { applicationId }) => {
    const session = await requirePermission(ctx, "admissions.view");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "applications", applicationId);
    const docs = await ctx.db
      .query("applicationDocuments")
      .withIndex("by_application", (q) => q.eq("applicationId", applicationId))
      .collect();
    const grade = a.appliedGradeLevelId ? await ctx.db.get(a.appliedGradeLevelId) : null;
    return {
      application: { ...a },
      appliedGrade: grade?.name ?? null,
      documents: docs.map((d) => ({ _id: d._id, kind: d.kind, fileId: d.fileId })),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Review, assessment, decision                                        */
/* ------------------------------------------------------------------ */

export const moveToReview = mutation({
  args: { applicationId: v.id("applications") },
  handler: async (ctx, { applicationId }) => {
    const session = await requirePermission(ctx, "admissions.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "applications", applicationId);
    if (a.status !== "submitted") throw new ConvexError("Only submitted applications can move to review.");
    await ctx.db.patch(applicationId, { status: "under_review", updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "admissions.review_started",
      entityType: "applications", entityId: applicationId,
      description: `Application ${a.applicationNumber} moved to review`,
    });
    return { ok: true as const };
  },
});

export const recordAssessment = mutation({
  args: { applicationId: v.id("applications"), score: v.optional(v.number()), notes: v.string() },
  handler: async (ctx, { applicationId, score, notes }) => {
    const session = await requirePermission(ctx, "admissions.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "applications", applicationId);
    if (!["under_review", "assessment"].includes(a.status)) {
      throw new ConvexError("Assessment can only be recorded while under review.");
    }
    if (score !== undefined && (score < 0 || score > 100)) throw new ConvexError("Score must be 0-100.");
    await ctx.db.patch(applicationId, {
      status: "assessment",
      assessmentScore: score ?? a.assessmentScore,
      assessmentNotes: notes.trim(),
      assessedById: session.userId,
      assessedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "admissions.assessment_recorded",
      entityType: "applications", entityId: applicationId,
      description: `Assessment recorded for ${a.applicationNumber}${score !== undefined ? ` (score ${score})` : ""}`,
    });
    return { ok: true as const };
  },
});

export const decideApplication = mutation({
  args: {
    applicationId: v.id("applications"),
    decision: v.union(v.literal("accepted"), v.literal("rejected"), v.literal("waitlisted")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { applicationId, decision, notes }) => {
    const session = await requirePermission(ctx, "admissions.decide");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "applications", applicationId);
    if (["accepted", "rejected", "enrolled", "withdrawn"].includes(a.status)) {
      throw new ConvexError(`This application is already ${a.status}.`);
    }
    await ctx.db.patch(applicationId, {
      status: decision, decisionNotes: notes?.trim() || undefined,
      decidedById: session.userId, decidedAt: Date.now(), updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: `admissions.${decision}`,
      entityType: "applications", entityId: applicationId,
      description: `Application ${a.applicationNumber}: ${decision}`,
    });
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------------ */
/* Conversion → Student + Guardian + Enrollment + Invoice              */
/* ------------------------------------------------------------------ */

export const convertApplication = mutation({
  args: {
    applicationId: v.id("applications"),
    classSectionId: v.id("classSections"),
    academicYearId: v.id("academicYears"),
    termId: v.id("terms"),
    /** Optional billing on enrollment (fee description + amount). */
    invoiceDescription: v.optional(v.string()),
    invoiceAmount: v.optional(v.number()),
    invoiceDueDate: v.optional(v.string()),
  },
  handler: async (ctx, { applicationId, classSectionId, academicYearId, termId, invoiceDescription, invoiceAmount, invoiceDueDate }) => {
    const session = await requirePermission(ctx, "admissions.decide");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "applications", applicationId);
    if (a.status !== "accepted") throw new ConvexError("Only accepted applications can be converted.");
    if (a.studentId) throw new ConvexError("This application has already been converted.");
    const section = await getSchoolRecord(ctx, schoolId, "classSections", classSectionId);
    const year = await getSchoolRecord(ctx, schoolId, "academicYears", academicYearId);
    const term = await getSchoolRecord(ctx, schoolId, "terms", termId);
    if (term.academicYearId !== year._id) throw new ConvexError("The term must belong to the academic year.");
    const today = new Date().toISOString().slice(0, 10);

    // Student (reuse application data — no re-entry).
    const studentId = await ctx.db.insert("students", {
      schoolId,
      admissionNumber: a.applicationNumber.replace("APP", "ADM"),
      firstName: a.firstName,
      middleName: a.middleName,
      lastName: a.lastName,
      gender: a.gender ?? "other",
      dateOfBirth: a.dateOfBirth,
      previousSchool: a.previousSchool,
      admissionDate: today,
      studentStatus: "active",
      updatedAt: Date.now(),
    });

    // Guardian dedupe by normalized phone within the school.
    let guardianId: Id<"guardians"> | undefined;
    const guardians = await ctx.db.query("guardians").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const existingGuardian = guardians.find((g) => g.phone && normPhone(g.phone) === a.guardianPhone);
    if (existingGuardian) {
      guardianId = existingGuardian._id;
    } else {
      const parts = a.guardianName.split(/\s+/);
      guardianId = await ctx.db.insert("guardians", {
        schoolId,
        firstName: parts[0] || a.guardianName,
        lastName: parts.slice(1).join(" ") || parts[0] || "Guardian",
        relationship: a.guardianRelationship ?? "guardian",
        phone: a.guardianPhone,
        email: a.guardianEmail,
        status: "active",
        updatedAt: Date.now(),
      });
    }
    await ctx.db.insert("guardianStudents", {
      schoolId, guardianId, studentId, relationship: a.guardianRelationship ?? "guardian", isPrimary: true,
    });

    // Enrollment.
    const enrollmentId = await ctx.db.insert("enrollments", {
      schoolId, studentId, academicYearId: year._id, classSectionId: section._id,
      enrollmentDate: today, status: "active",
    });

    // Optional invoice (entry fee / term 1 fees).
    let invoiceId: Id<"invoices"> | undefined;
    if (invoiceAmount && invoiceAmount > 0) {
      const { ensureStudentAccount, nextNumber, postLedgerTransaction, ACC } = await import("../finance");
      const accountId = await ensureStudentAccount(ctx, schoolId, studentId);
      const invoiceNumber = await nextNumber(ctx, schoolId, "INV");
      invoiceId = await ctx.db.insert("invoices", {
        schoolId, invoiceNumber, studentId, accountId,
        academicYearId: year._id, termId: term._id,
        issueDate: today, dueDate: invoiceDueDate ?? today,
        totalAmount: invoiceAmount, status: "issued",
        notes: `Admission invoice for ${a.applicationNumber}`,
        createdById: session.userId, issuedAt: Date.now(),
      });
      await ctx.db.insert("invoiceItems", {
        schoolId, invoiceId,
        description: invoiceDescription?.trim() || "Admission fees",
        category: "Other", quantity: 1, amount: invoiceAmount,
      });
      await postLedgerTransaction(ctx, schoolId, session.userId, {
        transactionType: "invoice", date: today, amount: invoiceAmount,
        description: `Invoice ${invoiceNumber} — admission ${a.applicationNumber}`,
        studentId, accountId, invoiceId,
        lines: [
          { code: ACC.RECEIVABLE, direction: "debit", amount: invoiceAmount },
          { code: ACC.REVENUE, direction: "credit", amount: invoiceAmount },
        ],
      });
    }

    await ctx.db.patch(applicationId, {
      status: "enrolled", studentId, guardianId, enrollmentId, invoiceId,
      convertedAt: Date.now(), updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "admissions.converted",
      entityType: "applications", entityId: applicationId,
      description: `Application ${a.applicationNumber} converted to student (enrollment ${enrollmentId})`,
    });
    return { studentId, guardianId, enrollmentId, invoiceId: invoiceId ?? null };
  },
});

void internalMutation;
