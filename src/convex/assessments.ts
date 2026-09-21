import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { roleHasPermission, type Permission } from "./schema";
import { ASSESSMENT_STATUSES, MARK_STATUSES } from "./schema";
import { validDate } from "./attendance";

type MutationCtxLike = MutationCtx;

/** Teacher authorization: must hold an active allocation for class+subject+year. */
export async function assertTeacherAuthorized(
  ctx: MutationCtxLike,
  schoolId: Id<"schools">,
  userId: Id<"users">,
  academicYearId: Id<"academicYears">,
  classSectionId: Id<"classSections">,
  subjectId: Id<"subjects">,
): Promise<Id<"staff">> {
  const staff = await ctx.db
    .query("staff")
    .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
    .collect();
  const mine = staff.find((s) => s.userId === userId && s.employmentStatus === "active");
  if (!mine) throw new ConvexError("Your staff record is not linked to your account.");
  const allocs = await ctx.db
    .query("teacherAllocations")
    .withIndex("by_staff", (q) => q.eq("staffId", mine._id))
    .collect();
  const ok = allocs.some(
    (a) =>
      a.status === "active" &&
      a.academicYearId === academicYearId &&
      a.classSectionId === classSectionId &&
      a.subjectId === subjectId,
  );
  if (!ok) {
    throw new ConvexError("You are not allocated to this class for this subject.");
  }
  return mine._id;
}

/* ------------------------------------------------------------------ */
/* Assessment types                                                    */
/* ------------------------------------------------------------------ */

export const listTypes = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "assessments.view");
    const rows = await ctx.db
      .query("assessmentTypes")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return rows.filter((t) => t.status === "active").sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createType = mutation({
  args: {
    name: v.string(),
    shortName: v.optional(v.string()),
    description: v.optional(v.string()),
    defaultWeight: v.optional(v.number()),
  },
  handler: async (ctx, { name, shortName, description, defaultWeight }) => {
    const session = await requirePermission(ctx, "assessments.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!name.trim()) throw new ConvexError("Assessment type name is required.");
    if (defaultWeight !== undefined && (defaultWeight < 0 || defaultWeight > 100)) {
      throw new ConvexError("Default weight must be between 0 and 100.");
    }
    const dup = await ctx.db
      .query("assessmentTypes")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (dup.some((t) => t.status === "active" && t.name.toLowerCase() === name.trim().toLowerCase())) {
      throw new ConvexError("An assessment type with this name already exists.");
    }
    const id = await ctx.db.insert("assessmentTypes", {
      schoolId,
      name: name.trim(),
      shortName,
      description,
      defaultWeight,
      status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "assessment_type.created",
      entityType: "assessmentTypes",
      entityId: id,
      description: `Assessment type "${name}" created`,
    });
    return id;
  },
});

export const archiveType = mutation({
  args: { typeId: v.id("assessmentTypes") },
  handler: async (ctx, { typeId }) => {
    const session = await requirePermission(ctx, "assessments.manage");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "assessmentTypes", typeId);
    const inUse = await ctx.db
      .query("assessments")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (inUse.some((a) => a.assessmentTypeId === typeId && a.status !== "archived")) {
      throw new ConvexError("This type is used by existing assessments and cannot be archived.");
    }
    await ctx.db.patch(typeId, { status: "archived" });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "assessment_type.archived",
      entityType: "assessmentTypes",
      entityId: typeId,
    });
  },
});

/* ------------------------------------------------------------------ */
/* Assessments                                                         */
/* ------------------------------------------------------------------ */

const createArgs = {
  academicYearId: v.id("academicYears"),
  termId: v.id("terms"),
  classSectionId: v.id("classSections"),
  subjectId: v.id("subjects"),
  assessmentTypeId: v.id("assessmentTypes"),
  title: v.string(),
  assessmentDate: v.string(),
  maxMarks: v.number(),
  weight: v.number(),
  countsTowardFinal: v.boolean(),
  teacherAllocationId: v.optional(v.id("teacherAllocations")),
};

export const create = mutation({
  args: { ...createArgs },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "assessments.create");
    const schoolId = session.schoolId as Id<"schools">;
    if (!args.title.trim()) throw new ConvexError("Give the assessment a title.");
    if (!validDate(args.assessmentDate)) throw new ConvexError("Invalid assessment date.");
    if (args.maxMarks <= 0) throw new ConvexError("Maximum marks must be positive.");
    if (args.weight < 0 || args.weight > 100) throw new ConvexError("Weight must be between 0 and 100.");

    // Cross-school + relational integrity (§74).
    const section = await getSchoolRecord(ctx, schoolId, "classSections", args.classSectionId);
    if (section.academicYearId !== args.academicYearId) {
      throw new ConvexError("This class does not belong to the selected academic year.");
    }
    const term = await getSchoolRecord(ctx, schoolId, "terms", args.termId);
    if (term.academicYearId !== args.academicYearId) {
      throw new ConvexError("This term does not belong to the selected academic year.");
    }
    await getSchoolRecord(ctx, schoolId, "subjects", args.subjectId);
    await getSchoolRecord(ctx, schoolId, "assessmentTypes", args.assessmentTypeId);
    const year = await ctx.db.get(args.academicYearId);
    if (year && (args.assessmentDate < year.startDate || args.assessmentDate > year.endDate)) {
      throw new ConvexError("Assessment date falls outside the academic year.");
    }

    let staffId: Id<"staff"> | undefined;
    if (session.role.role === "teacher") {
      staffId = await assertTeacherAuthorized(
        ctx, schoolId, session.userId, args.academicYearId, args.classSectionId, args.subjectId,
      );
    } else {
      const allocs = await ctx.db
        .query("teacherAllocations")
        .withIndex("by_class_subject_year", (q) =>
          q
            .eq("classSectionId", args.classSectionId)
            .eq("subjectId", args.subjectId)
            .eq("academicYearId", args.academicYearId),
        )
        .collect();
      const active = allocs.filter((a) => a.status === "active");
      staffId = active[0]?.staffId;
    }

    // Duplicate accidental assessment (§31): same class+subject+type+title in term.
    const existing = await ctx.db
      .query("assessments")
      .withIndex("by_class_subject_term", (q) =>
        q
          .eq("classSectionId", args.classSectionId)
          .eq("subjectId", args.subjectId)
          .eq("termId", args.termId),
      )
      .collect();
    if (
      existing.some(
        (a) =>
          a.assessmentTypeId === args.assessmentTypeId &&
          a.title.trim().toLowerCase() === args.title.trim().toLowerCase(),
      )
    ) {
      throw new ConvexError("An assessment with this type and title already exists for this class and subject.");
    }

    const id = await ctx.db.insert("assessments", {
      schoolId,
      academicYearId: args.academicYearId,
      termId: args.termId,
      classSectionId: args.classSectionId,
      subjectId: args.subjectId,
      teacherAllocationId: args.teacherAllocationId,
      staffId,
      assessmentTypeId: args.assessmentTypeId,
      title: args.title.trim(),
      assessmentDate: args.assessmentDate,
      maxMarks: args.maxMarks,
      weight: args.weight,
      countsTowardFinal: args.countsTowardFinal,
      status: "draft",
      createdBy: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "assessment.created",
      entityType: "assessments",
      entityId: id,
      description: `Assessment "${args.title}" created (draft)`,
    });
    return id;
  },
});

/** Status transitions with role rules (§30, §42). */
const TRANSITIONS: Record<string, { to: string[]; permission: string }> = {
  draft: { to: ["open", "marking"], permission: "assessments.update" },
  open: { to: ["marking", "draft"], permission: "assessments.update" },
  marking: { to: ["open", "submitted"], permission: "assessments.update" },
  submitted: { to: ["approved"], permission: "results.approve" },
  approved: { to: ["published", "reopened"], permission: "results.approve" },
  published: { to: ["locked", "reopened"], permission: "results.publish" },
  locked: { to: ["reopened"], permission: "results.approve" },
  reopened: { to: ["marking", "submitted"], permission: "assessments.update" },
};

export const setStatus = mutation({
  args: { assessmentId: v.id("assessments"), status: v.string(), reopenReason: v.optional(v.string()) },
  handler: async (ctx, { assessmentId, status, reopenReason }) => {
    const session = await requirePermission(ctx, "assessments.update");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assessments", assessmentId);
    const rule = TRANSITIONS[a.status];
    if (!rule || !rule.to.includes(status)) {
      throw new ConvexError(`Cannot move this assessment from "${a.status}" to "${status}".`);
    }
    if (rule.permission === "results.approve" && !hasPerm(session, "results.approve")) {
      throw new ConvexError("Only a principal or administrator can approve results.");
    }
    if (rule.permission === "results.publish" && !hasPerm(session, "results.publish")) {
      throw new ConvexError("Only a principal or administrator can publish results.");
    }
    // Teachers may drive their own assessments through the marking lifecycle,
    // but never approve/publish — those gates are checked above by real perms.
    if (status === "reopened" && !reopenReason?.trim()) {
      throw new ConvexError("A reason is required when reopening results.");
    }
    if (status === "submitted") {
      await ctx.db.patch(assessmentId, { submittedAt: Date.now(), submittedById: session.userId });
    }
    await ctx.db.patch(assessmentId, { status, updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: `assessment.${status === "reopened" ? "reopened" : `status_${status}`}`,
      entityType: "assessments",
      entityId: assessmentId,
      description: reopenReason ? `${a.title}: reopened — ${reopenReason}` : `${a.title}: ${a.status} → ${status}`,
    });
  },
});

function hasPerm(
  session: Awaited<ReturnType<typeof import("./session").requirePermission>>,
  perm: Permission,
): boolean {
  if (session.role.kind === "platform") return true;
  return roleHasPermission(session.role.role, perm);
}

export const list = query({
  args: {
    termId: v.optional(v.id("terms")),
    classSectionId: v.optional(v.id("classSections")),
    subjectId: v.optional(v.id("subjects")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { termId, classSectionId, subjectId, status }) => {
    const session = await requirePermission(ctx, "assessments.view");
    const schoolId = session.schoolId as Id<"schools">;
    let effectiveTermId = termId;
    if (!effectiveTermId) {
      const t = await ctx.db
        .query("terms")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      effectiveTermId = t?._id;
    }
    if (!effectiveTermId) return [];
    let rows = await ctx.db
      .query("assessments")
      .withIndex("by_school_term", (q) => q.eq("schoolId", schoolId).eq("termId", effectiveTermId as Id<"terms">))
      .collect();
    if (classSectionId) rows = rows.filter((r) => r.classSectionId === classSectionId);
    if (subjectId) rows = rows.filter((r) => r.subjectId === subjectId);
    if (status && status !== "all") rows = rows.filter((r) => r.status === status);
    if (session.role.role === "teacher") {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = staff.find((s) => s.userId === session.userId);
      rows = rows.filter((r) => r.staffId === mine?._id);
    }
    const enriched = await Promise.all(
      rows.map(async (a) => {
        const section = await ctx.db.get(a.classSectionId);
        const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
        const subject = await ctx.db.get(a.subjectId);
        const type = await ctx.db.get(a.assessmentTypeId);
        const scores = await ctx.db
          .query("assessmentScores")
          .withIndex("by_assessment", (q) => q.eq("assessmentId", a._id))
          .collect();
        const enrolls = await ctx.db
          .query("enrollments")
          .withIndex("by_class_section", (q) => q.eq("classSectionId", a.classSectionId))
          .collect();
        const activeCount = enrolls.filter((e) => e.status === "active").length;
        return {
          _id: a._id,
          title: a.title,
          status: a.status,
          assessmentDate: a.assessmentDate,
          maxMarks: a.maxMarks,
          weight: a.weight,
          countsTowardFinal: a.countsTowardFinal,
          typeName: type?.name ?? "—",
          classSectionId: a.classSectionId,
          classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
          subjectId: a.subjectId,
          subjectName: subject?.name ?? "—",
          marksEntered: scores.filter((s) => s.status === "entered").length,
          absent: scores.filter((s) => s.status === "absent").length,
          exempt: scores.filter((s) => s.status === "exempt").length,
          enrolledCount: activeCount,
        };
      }),
    );
    return enriched.sort((a, b) => b.assessmentDate.localeCompare(a.assessmentDate));
  },
});

export const get = query({
  args: { assessmentId: v.id("assessments") },
  handler: async (ctx, { assessmentId }) => {
    const session = await requirePermission(ctx, "assessments.view");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assessments", assessmentId);
    if (session.role.role === "teacher") {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = staff.find((s) => s.userId === session.userId);
      if (a.staffId !== mine?._id) throw new ConvexError("You can only view your own assessments.");
    }
    const subject = await ctx.db.get(a.subjectId);
    const section = await ctx.db.get(a.classSectionId);
    const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
    const type = await ctx.db.get(a.assessmentTypeId);
    return {
      ...a,
      subjectName: subject?.name ?? "—",
      classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
      typeName: type?.name ?? "—",
    };
  },
});
