/**
 * Phase 7 — meal management: plans, eligibility (enrollments), consumption
 * tracking and QR meal-card integration.
 *
 * The meal card REUSES the Phase 6 QR identity system (qrTokens) — no second
 * identity system. recordConsumptionByQr takes the opaque token server-side
 * and resolves it to the student's ACTIVE meal enrollment; no sensitive data
 * ever lives in the QR payload. One consumption record per student per
 * mealType per day (duplicate scans are rejected).
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePermission, getSchoolRecord } from "../session";
import { recordAudit } from "../audit";
import { MEAL_PLAN_TYPES, MEAL_CONSUMPTION_TYPES } from "../schema";

/* ------------------------------------------------------------------ */
/* Meal plans                                                          */
/* ------------------------------------------------------------------ */

export const listPlans = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "meals.view");
    const schoolId = session.schoolId as Id<"schools">;
    return ctx.db.query("mealPlans").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  },
});

export const upsertPlan = mutation({
  args: {
    name: v.string(),
    planType: v.string(),
    description: v.optional(v.string()),
    dailyCost: v.number(),
  },
  handler: async (ctx, { name, planType, description, dailyCost }) => {
    const session = await requirePermission(ctx, "meals.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Plan name is required.");
    if (!MEAL_PLAN_TYPES.includes(planType as never)) throw new ConvexError("Unknown meal plan type.");
    if (!(dailyCost >= 0)) throw new ConvexError("Daily cost must be zero or positive.");
    const existing = await ctx.db
      .query("mealPlans")
      .withIndex("by_school_name", (q) => q.eq("schoolId", schoolId).eq("name", trimmed))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { planType, description: description?.trim() || undefined, dailyCost });
      return existing._id;
    }
    const id = await ctx.db.insert("mealPlans", {
      schoolId, name: trimmed, planType, description: description?.trim() || undefined,
      dailyCost, status: "active", createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "meals.plan_added",
      entityType: "mealPlans", entityId: id,
      description: `Meal plan "${trimmed}" (${planType}) created at ${dailyCost}/day`,
    });
    return id;
  },
});

/* ------------------------------------------------------------------ */
/* Eligibility (meal enrollments)                                      */
/* ------------------------------------------------------------------ */

export const enrollStudent = mutation({
  args: {
    planId: v.id("mealPlans"),
    studentId: v.id("students"),
    academicYearId: v.id("academicYears"),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    subsidyPercent: v.optional(v.number()),
  },
  handler: async (ctx, { planId, studentId, academicYearId, startDate, endDate, subsidyPercent }) => {
    const session = await requirePermission(ctx, "meals.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const plan = await getSchoolRecord(ctx, schoolId, "mealPlans", planId);
    await getSchoolRecord(ctx, schoolId, "students", studentId);
    await getSchoolRecord(ctx, schoolId, "academicYears", academicYearId);
    if (subsidyPercent !== undefined && (subsidyPercent < 0 || subsidyPercent > 100)) {
      throw new ConvexError("Subsidy must be 0-100%.");
    }
    if (endDate && endDate < startDate) throw new ConvexError("The end date must be after the start date.");
    // One active eligibility per student per plan per year.
    const existing = await ctx.db
      .query("mealEnrollments")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect()
      .then((rows) =>
        rows.find((r) => r.planId === planId && r.academicYearId === academicYearId && r.status === "active"),
      );
    if (existing) throw new ConvexError(`This student is already enrolled on "${plan.name}" for this year.`);
    const id = await ctx.db.insert("mealEnrollments", {
      schoolId, planId, studentId, academicYearId,
      startDate, endDate, subsidyPercent,
      status: "active", createdById: session.userId, createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "meals.student_enrolled",
      entityType: "mealEnrollments", entityId: id,
      description: `Student enrolled on meal plan "${plan.name}"`,
    });
    return id;
  },
});

export const endMealEnrollment = mutation({
  args: { mealEnrollmentId: v.id("mealEnrollments"), status: v.union(v.literal("suspended"), v.literal("ended")) },
  handler: async (ctx, { mealEnrollmentId, status }) => {
    const session = await requirePermission(ctx, "meals.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const row = await getSchoolRecord(ctx, schoolId, "mealEnrollments", mealEnrollmentId);
    await ctx.db.patch(mealEnrollmentId, { status, endDate: status === "ended" ? new Date().toISOString().slice(0, 10) : row.endDate });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "meals.enrollment_" + status,
      entityType: "mealEnrollments", entityId: mealEnrollmentId,
      description: `Meal enrollment ${status}`,
    });
    return { ok: true as const };
  },
});

export const listMealEnrollments = query({
  args: { planId: v.optional(v.id("mealPlans")), studentId: v.optional(v.id("students")) },
  handler: async (ctx, { planId, studentId }) => {
    const session = await requirePermission(ctx, "meals.view");
    const schoolId = session.schoolId as Id<"schools">;
    let rows = await ctx.db.query("mealEnrollments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    if (planId) rows = rows.filter((r) => r.planId === planId);
    if (studentId) rows = rows.filter((r) => r.studentId === studentId);
    const plans = await ctx.db.query("mealPlans").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const planName = new Map(plans.map((p) => [p._id, p.name]));
    const studentName = new Map(students.map((s) => [s._id, `${s.firstName} ${s.lastName}`]));
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500)
      .map((r) => ({
        _id: r._id,
        planName: planName.get(r.planId) ?? "—",
        studentName: studentName.get(r.studentId) ?? "—",
        studentId: r.studentId,
        startDate: r.startDate,
        endDate: r.endDate ?? null,
        subsidyPercent: r.subsidyPercent ?? null,
        status: r.status,
      }));
  },
});

/* ------------------------------------------------------------------ */
/* Consumption                                                         */
/* ------------------------------------------------------------------ */

export const recordConsumption = mutation({
  args: {
    studentId: v.id("students"),
    mealType: v.string(),
    consumptionDate: v.optional(v.string()),
    viaQr: v.optional(v.boolean()),
  },
  handler: async (ctx, { studentId, mealType, consumptionDate, viaQr }) => {
    const session = await requirePermission(ctx, "meals.consume");
    const schoolId = session.schoolId as Id<"schools">;
    return recordConsumptionCore(ctx, {
      schoolId, studentId, mealType,
      consumptionDate: consumptionDate ?? new Date().toISOString().slice(0, 10),
      viaQr: viaQr ?? false, recordedById: session.userId,
    });
  },
});

/** Core consumption writer shared by manual entry + QR scans. */
async function recordConsumptionCore(
  ctx: import("../_generated/server").MutationCtx,
  args: {
    schoolId: Id<"schools">;
    studentId: Id<"students">;
    mealType: string;
    consumptionDate: string;
    viaQr: boolean;
    recordedById: Id<"users">;
  },
) {
  const { schoolId, studentId, mealType, consumptionDate, viaQr, recordedById } = args;
  if (!MEAL_CONSUMPTION_TYPES.includes(mealType as never)) throw new ConvexError("Unknown meal type.");
  const activeEnrollment = await ctx.db
    .query("mealEnrollments")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect()
    .then((rows) =>
      rows.find(
        (r) =>
          r.schoolId === schoolId && r.status === "active" &&
          r.startDate <= consumptionDate && (!r.endDate || r.endDate >= consumptionDate),
      ),
    );
  if (!activeEnrollment) {
    throw new ConvexError("This student has no active meal plan for today — consumption not recorded.");
  }
  const dup = await ctx.db
    .query("mealConsumption")
    .withIndex("by_student_date", (q) => q.eq("studentId", studentId).eq("consumptionDate", consumptionDate))
    .collect()
    .then((rows) => rows.find((r) => r.mealType === mealType));
  if (dup) {
    throw new ConvexError(`A ${mealType} record for this student already exists on ${consumptionDate}.`);
  }
  const id = await ctx.db.insert("mealConsumption", {
    schoolId, mealEnrollmentId: activeEnrollment._id, studentId,
    consumptionDate, mealType, recordedViaQr: viaQr,
    recordedById, recordedAt: Date.now(),
  });
  return { consumptionId: id, mealEnrollmentId: activeEnrollment._id };
}

/** QR meal card: record consumption by scanning the student's QR ID card. */
export const recordConsumptionByQr = mutation({
  args: { token: v.string(), mealType: v.string(), consumptionDate: v.optional(v.string()) },
  handler: async (ctx, { token, mealType, consumptionDate }) => {
    const session = await requirePermission(ctx, "meals.consume");
    const schoolId = session.schoolId as Id<"schools">;
    // Resolve the OPAQUE Phase 6 QR token server-side (no data in the QR).
    const qr = await ctx.db
      .query("qrTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!qr || !qr.active || qr.schoolId !== schoolId || qr.subjectKind !== "student") {
      throw new ConvexError("Invalid or revoked QR code.");
    }
    const student = await ctx.db.get(qr.subjectId);
    if (!student || student.schoolId !== schoolId) throw new ConvexError("Invalid QR code.");
    return recordConsumptionCore(ctx, {
      schoolId, studentId: student._id, mealType,
      consumptionDate: consumptionDate ?? new Date().toISOString().slice(0, 10),
      viaQr: true, recordedById: session.userId,
    });
  },
});

export const consumptionForDate = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const session = await requirePermission(ctx, "meals.view");
    const schoolId = session.schoolId as Id<"schools">;
    const day = date ?? new Date().toISOString().slice(0, 10);
    const rows = await ctx.db
      .query("mealConsumption")
      .withIndex("by_school_date", (q) => q.eq("schoolId", schoolId).eq("consumptionDate", day))
      .collect();
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const studentName = new Map(students.map((s) => [s._id, `${s.firstName} ${s.lastName}`]));
    return rows
      .sort((a, b) => b.recordedAt - a.recordedAt)
      .map((r) => ({
        _id: r._id,
        studentName: studentName.get(r.studentId) ?? "—",
        mealType: r.mealType,
        viaQr: r.recordedViaQr ?? false,
        recordedAt: r.recordedAt,
      }));
  },
});

/** Daily summary counts per meal type (dashboard tiles). */
export const consumptionSummary = query({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const session = await requirePermission(ctx, "meals.view");
    const schoolId = session.schoolId as Id<"schools">;
    const day = date ?? new Date().toISOString().slice(0, 10);
    const rows = await ctx.db
      .query("mealConsumption")
      .withIndex("by_school_date", (q) => q.eq("schoolId", schoolId).eq("consumptionDate", day))
      .collect();
    const enrollments = await ctx.db
      .query("mealEnrollments")
      .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "active"))
      .collect();
    return {
      date: day,
      eligible: enrollments.length,
      lunch: rows.filter((r) => r.mealType === "lunch").length,
      milk: rows.filter((r) => r.mealType === "milk").length,
      snack: rows.filter((r) => r.mealType === "snack").length,
    };
  },
});

/**
 * Parent view: meal plan + consumption for their OWN children only
 * (identity resolved from the guardian portal link server-side).
 */
export const myChildrenMeals = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "meals.view");
    if (session.role.role !== "parent") {
      throw new ConvexError("Only parents can view this.");
    }
    const schoolId = session.schoolId as Id<"schools">;
    const link = await ctx.db
      .query("guardianPortalLinks")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!link) return [];
    const children = await ctx.db
      .query("guardianStudents")
      .withIndex("by_guardian", (q) => q.eq("guardianId", link.guardianId))
      .collect();
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const studentName = new Map(students.map((s) => [s._id, `${s.firstName} ${s.lastName}`]));
    const plans = await ctx.db.query("mealPlans").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const planName = new Map(plans.map((p) => [p._id, p.name]));
    const today = new Date().toISOString().slice(0, 10);
    const out = [];
    for (const child of children) {
      const enrollments = await ctx.db
        .query("mealEnrollments")
        .withIndex("by_student", (q) => q.eq("studentId", child.studentId))
        .collect()
        .then((rows) => rows.filter((r) => r.status === "active"));
      const todayConsumption = await ctx.db
        .query("mealConsumption")
        .withIndex("by_student_date", (q) => q.eq("studentId", child.studentId).eq("consumptionDate", today))
        .collect();
      out.push({
        studentId: child.studentId,
        studentName: studentName.get(child.studentId) ?? "—",
        plans: enrollments.map((e) => ({
          planName: planName.get(e.planId) ?? "—",
          subsidyPercent: e.subsidyPercent ?? null,
          startDate: e.startDate,
        })),
        todayMeals: todayConsumption.map((c) => c.mealType),
      });
    }
    return out;
  },
});
