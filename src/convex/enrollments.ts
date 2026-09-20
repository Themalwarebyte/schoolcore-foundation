import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/** Current enrollment for the given student (or all students, keyed). */
export const forStudent = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "students.view");
    const student = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "students", studentId);
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect();
    const enriched = await Promise.all(
      enrollments.map(async (e) => {
        const section = await ctx.db.get(e.classSectionId);
        const year = await ctx.db.get(e.academicYearId);
        let gradeName: string | null = null;
        if (section) {
          const grade = await ctx.db.get(section.gradeLevelId);
          gradeName = grade?.name ?? null;
        }
        return {
          _id: e._id,
          yearName: year?.name ?? "—",
          yearId: e.academicYearId,
          classLabel: section ? `${gradeName ?? ""} ${section.streamName}`.trim() : "—",
          classSectionId: e.classSectionId,
          enrollmentDate: e.enrollmentDate,
          status: e.status,
          exitDate: e.exitDate,
          notes: e.notes,
        };
      }),
    );
    return enriched.sort((a, b) => a.yearName.localeCompare(b.yearName));
  },
});

/** Options for the enroll dialog: students, years and sections. */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "students.view");
    const schoolId = session.schoolId as Id<"schools">;
    const years = await ctx.db
      .query("academicYears")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const sections = await ctx.db
      .query("classSections")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const grades = await ctx.db
      .query("gradeLevels")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const gradeName = new Map(grades.map((g) => [g._id, g.name]));
    return {
      years: years
        .filter((y) => y.status !== "archived")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((y) => ({ _id: y._id, name: y.name, isCurrent: !!y.isCurrent })),
      sections: sections
        .filter((c) => c.status === "active")
        .map((c) => ({
          _id: c._id,
          academicYearId: c.academicYearId,
          label: `${gradeName.get(c.gradeLevelId) ?? "?"} ${c.streamName}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export const enroll = mutation({
  args: {
    studentId: v.id("students"),
    academicYearId: v.id("academicYears"),
    classSectionId: v.id("classSections"),
    enrollmentDate: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "students.update");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", args.studentId);
    const year = await getSchoolRecord(ctx, schoolId, "academicYears", args.academicYearId);
    const section = await getSchoolRecord(ctx, schoolId, "classSections", args.classSectionId);
    if (section.academicYearId !== year._id) {
      throw new ConvexError("The class section must belong to the selected academic year.");
    }
    if (student.studentStatus !== "active") {
      throw new ConvexError("Only active students can be enrolled.");
    }
    // Capacity check.
    if (section.capacity) {
      const current = await ctx.db
        .query("enrollments")
        .withIndex("by_class_section", (q) => q.eq("classSectionId", section._id))
        .collect();
      const active = current.filter((e) => e.status === "active").length;
      if (active >= section.capacity) {
        throw new ConvexError(`${section.streamName} is at full capacity.`);
      }
    }
    // One active enrollment per student per academic year.
    const existing = await ctx.db
      .query("enrollments")
      .withIndex("by_student_year", (q) =>
        q.eq("studentId", student._id).eq("academicYearId", year._id),
      )
      .collect();
    const activeExisting = existing.find((e) => e.status === "active");
    if (activeExisting) {
      if (activeExisting.classSectionId === args.classSectionId) {
        throw new ConvexError("The student is already enrolled in this class for this year.");
      }
      // Move: close old, open new (transfers within the year keep history).
      await ctx.db.patch(activeExisting._id, {
        status: "inactive",
        exitDate: new Date().toISOString().slice(0, 10),
        notes: "Transferred to another class",
      });
    }
    const id = await ctx.db.insert("enrollments", {
      schoolId,
      studentId: student._id,
      academicYearId: year._id,
      classSectionId: section._id,
      enrollmentDate: args.enrollmentDate,
      status: "active",
      notes: args.notes,
    });
    const grade = await ctx.db.get(section.gradeLevelId);
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "enrollment.created",
      entityType: "enrollments",
      entityId: id,
      description: `${student.firstName} ${student.lastName} → ${grade?.name ?? ""} ${section.streamName} (${year.name})`.trim(),
    });
    return id;
  },
});

/** Undo an enrollment mistake before it matters (same-day correction). */
export const remove = mutation({
  args: { enrollmentId: v.id("enrollments") },
  handler: async (ctx, { enrollmentId }) => {
    const session = await requirePermission(ctx, "students.update");
    const enrollment = await getSchoolRecord(
      ctx,
      session.schoolId as Id<"schools">,
      "enrollments",
      enrollmentId,
    );
    await ctx.db.delete(enrollmentId);
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: enrollment.schoolId,
      action: "enrollment.removed",
      entityType: "enrollments",
      entityId: enrollmentId,
      description: "Removed an enrollment record",
    });
    return null;
  },
});
