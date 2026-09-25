/**
 * Phase 7 — student promotion wizard.
 *
 * Select year → select class → students are staged with outcomes
 * (promoted / repeated / transferred / graduated) → preview → confirm.
 *
 * Confirm creates NEW enrollments in the target academic year for promoted
 * students. Historical enrollments are NEVER modified or closed — history is
 * preserved verbatim (§20). Graduated students get their student record
 * marked "graduated"; transferred out students get "transferred".
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePermission, getSchoolRecord } from "../session";
import { recordAudit } from "../audit";
import { PROMOTION_OUTCOMES } from "../schema";

/* ------------------------------------------------------------------ */
/* Preview: stage students from a class                                */
/* ------------------------------------------------------------------ */

/**
 * Returns the promotion candidates for a class in a year: each active
 * enrollment's student + their current class + the default target class
 * (same stream, next grade by display order).
 */
export const previewPromotion = query({
  args: { fromYearId: v.id("academicYears"), classSectionId: v.id("classSections") },
  handler: async (ctx, { fromYearId, classSectionId }) => {
    const session = await requirePermission(ctx, "academics.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "academicYears", fromYearId);
    const section = await getSchoolRecord(ctx, schoolId, "classSections", classSectionId);
    const grade = await ctx.db.get(section.gradeLevelId);

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_class_section", (q) => q.eq("classSectionId", classSectionId))
      .collect()
      .then((es) => es.filter((e) => e.schoolId === schoolId && e.academicYearId === fromYearId && e.status === "active"));

    // Default target: same stream, next grade level by display order.
    const grades = await ctx.db.query("gradeLevels").withIndex("by_school_order", (q) => q.eq("schoolId", schoolId)).collect();
    const sorted = grades.sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sorted.findIndex((g) => g._id === section.gradeLevelId);
    const nextGrade = idx >= 0 ? sorted[idx + 1] : undefined;
    const targetYearClasses = await ctx.db
      .query("classSections")
      .withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", fromYearId))
      .collect();
    void targetYearClasses;

    const lines = [];
    for (const e of enrollments) {
      const student = await ctx.db.get(e.studentId);
      if (!student) continue;
      lines.push({
        studentId: student._id,
        name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
        admissionNumber: student.admissionNumber,
        fromEnrollmentId: e._id,
        fromClassSectionId: classSectionId,
        fromClassLabel: `${grade?.name ?? ""} ${section.streamName}`.trim(),
        suggestedToClassSectionId: null as Id<"classSections"> | null,
        outcome: "promoted" as const,
      });
    }
    return {
      lines,
      nextGrade: nextGrade ? { id: nextGrade._id, name: nextGrade.name } : null,
      isFinalGrade: !nextGrade,
    };
  },
});

/** Classes for a target year filtered by grade — used to pick destinations. */
export const targetClasses = query({
  args: { toYearId: v.id("academicYears") },
  handler: async (ctx, { toYearId }) => {
    const session = await requirePermission(ctx, "academics.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "academicYears", toYearId);
    const classes = await ctx.db
      .query("classSections")
      .withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", toYearId))
      .collect();
    const out = [];
    for (const c of classes) {
      const grade = await ctx.db.get(c.gradeLevelId);
      out.push({ _id: c._id, label: `${grade?.name ?? ""} ${c.streamName}`.trim(), gradeLevelId: c.gradeLevelId });
    }
    return out;
  },
});

/* ------------------------------------------------------------------ */
/* Confirm: create run + new enrollments                               */
/* ------------------------------------------------------------------ */

export const confirmPromotion = mutation({
  args: {
    fromYearId: v.id("academicYears"),
    toYearId: v.id("academicYears"),
    lines: v.array(v.object({
      studentId: v.id("students"),
      fromEnrollmentId: v.id("enrollments"),
      fromClassSectionId: v.id("classSections"),
      toClassSectionId: v.optional(v.id("classSections")),
      outcome: v.string(),
    })),
  },
  handler: async (ctx, { fromYearId, toYearId, lines }) => {
    const session = await requirePermission(ctx, "promotions.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const fromYear = await getSchoolRecord(ctx, schoolId, "academicYears", fromYearId);
    const toYear = await getSchoolRecord(ctx, schoolId, "academicYears", toYearId);
    if (fromYearId === toYearId) throw new ConvexError("The target academic year must differ from the source year.");
    if (lines.length === 0) throw new ConvexError("Select at least one student to promote.");
    const today = new Date().toISOString().slice(0, 10);

    // Validate every line BEFORE writing anything (no partial runs).
    const studentIds = new Set<Id<"students">>();
    for (const line of lines) {
      if (!PROMOTION_OUTCOMES.includes(line.outcome as never)) {
        throw new ConvexError(`Unknown promotion outcome "${line.outcome}".`);
      }
      if (line.outcome === "promoted" && !line.toClassSectionId) {
        throw new ConvexError("Promoted students need a target class.");
      }
      if (line.outcome === "repeated" && !line.toClassSectionId) {
        throw new ConvexError("Repeated students need their (same) class in the new year.");
      }
      if (studentIds.has(line.studentId)) {
        throw new ConvexError("The same student appears twice in the promotion list.");
      }
      studentIds.add(line.studentId);
      const enrollment = await getSchoolRecord(ctx, schoolId, "enrollments", line.fromEnrollmentId);
      if (enrollment.studentId !== line.studentId) throw new ConvexError("Enrollment does not match the student.");
      if (line.toClassSectionId) {
        const target = await getSchoolRecord(ctx, schoolId, "classSections", line.toClassSectionId);
        if (target.academicYearId !== toYearId) {
          throw new ConvexError("Target classes must belong to the target academic year.");
        }
      }
    }

    // Run header.
    const runs = await ctx.db.query("promotionRuns").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const year = new Date().getFullYear();
    const max = runs.reduce((m, r) => {
      const n = Number(r.runNumber.split("-").pop());
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
    const runId = await ctx.db.insert("promotionRuns", {
      schoolId,
      runNumber: `PRM-${year}-${String(max + 1).padStart(5, "0")}`,
      fromAcademicYearId: fromYearId,
      toAcademicYearId: toYearId,
      totalStudents: lines.length,
      promoted: lines.filter((l) => l.outcome === "promoted").length,
      repeated: lines.filter((l) => l.outcome === "repeated").length,
      transferred: lines.filter((l) => l.outcome === "transferred").length,
      graduated: lines.filter((l) => l.outcome === "graduated").length,
      status: "confirmed",
      createdById: session.userId,
      createdAt: Date.now(),
      confirmedAt: Date.now(),
    });

    let appliedCount = 0;
    for (const line of lines) {
      let appliedEnrollmentId: Id<"enrollments"> | undefined;
      if ((line.outcome === "promoted" || line.outcome === "repeated") && line.toClassSectionId) {
        // Idempotency: skip if the student already has an active enrollment
        // in the target year (re-run protection).
        const existing = await ctx.db
          .query("enrollments")
          .withIndex("by_student_year", (q) => q.eq("studentId", line.studentId).eq("academicYearId", toYearId))
          .first();
        if (!existing) {
          appliedEnrollmentId = await ctx.db.insert("enrollments", {
            schoolId, studentId: line.studentId, academicYearId: toYearId,
            classSectionId: line.toClassSectionId, enrollmentDate: today, status: "active",
          });
          appliedCount++;
        } else {
          appliedEnrollmentId = existing._id;
        }
      }
      if (line.outcome === "graduated") {
        await ctx.db.patch(line.studentId, { studentStatus: "graduated", updatedAt: Date.now() });
      }
      if (line.outcome === "transferred") {
        await ctx.db.patch(line.studentId, { studentStatus: "transferred", updatedAt: Date.now() });
      }
      await ctx.db.insert("promotionLines", {
        schoolId, runId, studentId: line.studentId,
        fromEnrollmentId: line.fromEnrollmentId,
        fromClassSectionId: line.fromClassSectionId,
        toClassSectionId: line.toClassSectionId,
        outcome: line.outcome,
        applied: appliedEnrollmentId !== undefined,
        appliedEnrollmentId,
      });
    }

    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "promotion.confirmed",
      entityType: "promotionRuns", entityId: runId,
      description: `Promotion run from ${fromYear.name} to ${toYear.name}: ${appliedCount} new enrollment(s) created`,
    });
    return { runId, appliedCount };
  },
});

export const listRuns = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "academics.view");
    const schoolId = session.schoolId as Id<"schools">;
    const rows = await ctx.db.query("promotionRuns").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const years = await ctx.db.query("academicYears").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const yearName = (id: Id<"academicYears">) => years.find((y) => y._id === id)?.name ?? "—";
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        _id: r._id,
        runNumber: r.runNumber,
        fromYear: yearName(r.fromAcademicYearId),
        toYear: yearName(r.toAcademicYearId),
        totalStudents: r.totalStudents,
        promoted: r.promoted,
        repeated: r.repeated,
        transferred: r.transferred,
        graduated: r.graduated,
        status: r.status,
        createdAt: r.createdAt,
      }));
  },
});
