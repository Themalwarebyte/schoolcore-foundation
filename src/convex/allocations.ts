import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import type { MutationCtx } from "./_generated/server";

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const list = query({
  args: { academicYearId: v.optional(v.id("academicYears")), staffId: v.optional(v.id("staff")) },
  handler: async (ctx, { academicYearId, staffId }) => {
    const session = await requirePermission(ctx, "teacher_allocations.view");
    const schoolId = session.schoolId as Id<"schools">;
    let yearId = academicYearId;
    if (!yearId) {
      const current = await ctx.db
        .query("academicYears")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      yearId = current?._id;
    }
    if (!yearId) return [];
    const rows = await ctx.db
      .query("teacherAllocations")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const filtered = rows.filter(
      (a) => a.academicYearId === yearId && (!staffId || a.staffId === staffId),
    );
    const enriched = await Promise.all(
      filtered.map(async (a) => {
        const staff = await ctx.db.get(a.staffId);
        const subject = await ctx.db.get(a.subjectId);
        const section = await ctx.db.get(a.classSectionId);
        let classLabel: string | null = null;
        if (section) {
          const grade = await ctx.db.get(section.gradeLevelId);
          classLabel = grade ? `${grade.name} ${section.streamName}` : section.streamName;
        }
        return {
          _id: a._id,
          staffId: a.staffId,
          staffName: staff ? `${staff.firstName} ${staff.lastName}` : "—",
          employeeNumber: staff?.employeeNumber ?? "",
          subjectName: subject?.name ?? "—",
          subjectCode: subject?.code ?? "",
          classSectionId: a.classSectionId,
          classLabel: classLabel ?? "—",
          status: a.status,
        };
      }),
    );
    return enriched.sort(
      (a, b) => a.staffName.localeCompare(b.staffName) || a.classLabel.localeCompare(b.classLabel),
    );
  },
});

/** Allocation options for the create dialog. */
export const options = query({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    const session = await requirePermission(ctx, "teacher_allocations.view");
    const schoolId = session.schoolId as Id<"schools">;
    let yearId = academicYearId;
    if (!yearId) {
      const current = await ctx.db
        .query("academicYears")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      yearId = current?._id;
    }
    const [staff, subjects, sections] = await Promise.all([
      ctx.db.query("staff").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("subjects").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      yearId
        ? ctx.db
            .query("classSections")
            .withIndex("by_academic_year", (q) => q.eq("academicYearId", yearId))
            .collect()
        : Promise.resolve([]),
    ]);
    return {
      staff: staff
        .filter((s) => s.employmentStatus === "active")
        .map((s) => ({ _id: s._id, name: `${s.firstName} ${s.lastName}`, employeeNumber: s.employeeNumber }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      subjects: subjects
        .filter((s) => s.status === "active")
        .map((s) => ({ _id: s._id, name: s.name, code: s.code }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      classSections: sections.map((c) => ({ _id: c._id, gradeLevelId: c.gradeLevelId })),
      academicYearId: yearId ?? null,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    staffId: v.id("staff"),
    subjectId: v.id("subjects"),
    classSectionId: v.id("classSections"),
    academicYearId: v.id("academicYears"),
    termId: v.optional(v.id("terms")),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "teacher_allocations.manage");
    const schoolId = session.schoolId as Id<"schools">;
    // Cross-tenant integrity: every referenced record must belong to the caller's school.
    const staff = await getSchoolRecord(ctx, schoolId, "staff", args.staffId);
    const subject = await getSchoolRecord(ctx, schoolId, "subjects", args.subjectId);
    const section = await getSchoolRecord(ctx, schoolId, "classSections", args.classSectionId);
    const year = await getSchoolRecord(ctx, schoolId, "academicYears", args.academicYearId);
    if (section.academicYearId !== year._id) {
      throw new ConvexError("The class section must belong to the selected academic year.");
    }
    if (args.termId) {
      const term = await getSchoolRecord(ctx, schoolId, "terms", args.termId);
      if (term.academicYearId !== year._id) {
        throw new ConvexError("The term must belong to the selected academic year.");
      }
    }
    if (staff.employmentStatus !== "active") {
      throw new ConvexError("This staff member is not active.");
    }
    // Prevent duplicate allocations for the same subject/class/year (excluding archived).
    const existing = await ctx.db
      .query("teacherAllocations")
      .withIndex("by_class_subject_year", (q) =>
        q
          .eq("classSectionId", section._id)
          .eq("subjectId", subject._id)
          .eq("academicYearId", year._id),
      )
      .collect();
    if (existing.some((a) => a.status !== "archived" && a.staffId !== staff._id)) {
      throw new ConvexError("Another teacher already teaches this subject in this class for this year.");
    }
    if (existing.some((a) => a.status !== "archived" && a.staffId === staff._id)) {
      throw new ConvexError("This allocation already exists.");
    }
    const id = await ctx.db.insert("teacherAllocations", {
      schoolId,
      staffId: staff._id,
      academicYearId: year._id,
      classSectionId: section._id,
      subjectId: subject._id,
      termId: args.termId,
      status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "teacher_allocation.created",
      entityType: "teacherAllocations",
      entityId: id,
      description: await allocationLabel(ctx, staff, subject, section, year),
    });
    return id;
  },
});

async function allocationLabel(
  ctx: MutationCtx,
  staff: { firstName: string; lastName: string },
  subject: { name: string },
  section: { gradeLevelId: Id<"gradeLevels">; streamName: string },
  year: { name: string },
): Promise<string> {
  const grade = await ctx.db.get(section.gradeLevelId);
  const classLabel = grade ? `${grade.name} ${section.streamName}` : section.streamName;
  return `${staff.firstName} ${staff.lastName} → ${subject.name} in ${classLabel} (${year.name})`;
}

export const end = mutation({
  args: { allocationId: v.id("teacherAllocations") },
  handler: async (ctx, { allocationId }) => {
    const session = await requirePermission(ctx, "teacher_allocations.manage");
    const allocation = await getSchoolRecord(
      ctx,
      session.schoolId as Id<"schools">,
      "teacherAllocations",
      allocationId,
    );
    const staff = await ctx.db.get(allocation.staffId);
    await ctx.db.patch(allocationId, { status: "archived" });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: allocation.schoolId,
      action: "teacher_allocation.ended",
      entityType: "teacherAllocations",
      entityId: allocationId,
      description: `Ended allocation for ${staff ? `${staff.firstName} ${staff.lastName}` : "teacher"}`,
    });
    return null;
  },
});
