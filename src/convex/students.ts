import { ConvexError, v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getSession, requirePermission, requireSchoolSession, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

type QueryCtxLike = QueryCtx;

async function getCurrentYearId(
  ctx: QueryCtxLike,
  schoolId: Id<"schools">,
): Promise<Id<"academicYears"> | null> {
  const year = await ctx.db
    .query("academicYears")
    .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
    .first();
  return year?._id ?? null;
}

/* ------------------------------------------------------------------ */
/* List + profile                                                      */
/* ------------------------------------------------------------------ */

export const list = query({
  args: {
    schoolId: v.optional(v.id("schools")),
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    gradeLevelId: v.optional(v.id("gradeLevels")),
    classSectionId: v.optional(v.id("classSections")),
    paginationOpts: v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) }),
  },
  handler: async (ctx, args) => {
    void args.gradeLevelId;
    const session = await requirePermission(ctx, "students.view", {
      schoolId: args.schoolId,
    });
    if (!session.schoolId) return { page: [], isDone: true, continueCursor: "" };
    const schoolId = session.schoolId as Id<"schools">;

    // Class/grade filter resolved via enrollments in the current year.
    let classFilteredIds: Set<string> | null = null;
    if (args.classSectionId || args.gradeLevelId) {
      classFilteredIds = new Set();
      const currentYearId = await getCurrentYearId(ctx, schoolId);
      const enrollments = currentYearId
        ? await ctx.db
            .query("enrollments")
            .withIndex("by_year", (q) => q.eq("academicYearId", currentYearId))
            .collect()
        : [];
      for (const e of enrollments) {
        if (e.status !== "active") continue;
        if (args.classSectionId && e.classSectionId !== args.classSectionId) continue;
        if (args.gradeLevelId) {
          const section = await ctx.db.get(e.classSectionId);
          if (!section || section.gradeLevelId !== args.gradeLevelId) continue;
        }
        classFilteredIds.add(e.studentId);
      }
    }

    let rows = await ctx.db
      .query("students")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .order("desc")
      .paginate(args.paginationOpts)
      .then((r) => r.page);

    if (classFilteredIds) rows = rows.filter((s) => classFilteredIds!.has(s._id));
    if (args.status && args.status !== "all") {
      rows = rows.filter((s) => s.studentStatus === args.status);
    }
    if (args.search && args.search.trim()) {
      const q = args.search.trim().toLowerCase();
      rows = rows.filter(
        (s) =>
          s.firstName.toLowerCase().includes(q) ||
          s.lastName.toLowerCase().includes(q) ||
          (s.middleName ?? "").toLowerCase().includes(q) ||
          (s.preferredName ?? "").toLowerCase().includes(q) ||
          s.admissionNumber.toLowerCase().includes(q),
      );
    }

    const currentYearId = await getCurrentYearId(ctx, schoolId);
    const enriched = await Promise.all(
      rows.map(async (student) => {
        const enrollment = currentYearId
          ? await ctx.db
              .query("enrollments")
              .withIndex("by_student_year", (q) =>
                q.eq("studentId", student._id).eq("academicYearId", currentYearId),
              )
              .first()
          : null;
        let classLabel: string | null = null;
        if (enrollment) {
          const section = await ctx.db.get(enrollment.classSectionId);
          if (section) {
            const grade = await ctx.db.get(section.gradeLevelId);
            classLabel = grade ? `${grade.name} ${section.streamName}` : section.streamName;
          }
        }
        const links = await ctx.db
          .query("guardianStudents")
          .withIndex("by_student", (q) => q.eq("studentId", student._id))
          .collect();
        let guardianName: string | null = null;
        const primary = links.find((l) => l.isPrimary) ?? links[0];
        if (primary) {
          const g = await ctx.db.get(primary.guardianId);
          guardianName = g ? `${g.firstName} ${g.lastName}` : null;
        }
        return { ...student, classLabel, guardianName };
      }),
    );

    return { page: enriched, isDone: true, continueCursor: "" };
  },
});

export const get = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await getSession(ctx);
    const student = await ctx.db.get(studentId);
    if (!student) throw new ConvexError("Student not found.");
    if (session.schoolId !== student.schoolId && !session.isPlatform) {
      throw new ConvexError("You do not have access to this student.");
    }
    return student;
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireSchoolSession(ctx);
    const students = await ctx.db
      .query("students")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return {
      total: students.length,
      active: students.filter((s) => s.studentStatus === "active").length,
      archived: students.filter((s) => s.studentStatus === "archived").length,
      male: students.filter((s) => s.gender === "male").length,
      female: students.filter((s) => s.gender === "female").length,
      other: students.filter((s) => s.gender === "other").length,
      boarding: students.filter((s) => s.boardingStatus === "boarding").length,
    };
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const session = await requireSchoolSession(ctx);
    const students = await ctx.db
      .query("students")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .order("desc")
      .take(limit ?? 5);
    return students.map((s) => ({
      _id: s._id,
      fullName: [s.firstName, s.lastName].filter(Boolean).join(" "),
      admissionNumber: s.admissionNumber,
      studentStatus: s.studentStatus,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    admissionNumber: v.string(),
    firstName: v.string(),
    middleName: v.optional(v.string()),
    lastName: v.string(),
    preferredName: v.optional(v.string()),
    gender: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    nationality: v.optional(v.string()),
    admissionDate: v.optional(v.string()),
    studentStatus: v.string(),
    boardingStatus: v.optional(v.union(v.literal("day"), v.literal("boarding"))),
    previousSchool: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "students.create");
    if (!session.schoolId) throw new ConvexError("No school context.");
    const schoolId = session.schoolId;

    const admissionNumber = args.admissionNumber.trim();
    if (!admissionNumber) throw new ConvexError("Admission number is required.");
    const dup = await ctx.db
      .query("students")
      .withIndex("by_school_admission", (q) =>
        q.eq("schoolId", schoolId).eq("admissionNumber", admissionNumber),
      )
      .unique();
    if (dup) throw new ConvexError("This admission number is already in use at your school.");
    if (!args.firstName.trim() || !args.lastName.trim()) {
      throw new ConvexError("First and last name are required.");
    }
    if (args.dateOfBirth) {
      const dob = new Date(args.dateOfBirth);
      const today = new Date();
      if (Number.isNaN(dob.getTime())) throw new ConvexError("Date of birth is invalid.");
      if (dob > today) throw new ConvexError("Date of birth cannot be in the future.");
      const age = (today.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (age > 100) throw new ConvexError("Date of birth looks incorrect.");
    }
    if (args.studentStatus === "archived") {
      throw new ConvexError("New students cannot be created as archived.");
    }

    const id = await ctx.db.insert("students", {
      schoolId,
      admissionNumber,
      firstName: args.firstName.trim(),
      middleName: args.middleName?.trim() || undefined,
      lastName: args.lastName.trim(),
      preferredName: args.preferredName?.trim() || undefined,
      gender: args.gender || undefined,
      dateOfBirth: args.dateOfBirth || undefined,
      nationality: args.nationality?.trim() || undefined,
      admissionDate: args.admissionDate || undefined,
      studentStatus: args.studentStatus,
      boardingStatus: args.boardingStatus,
      previousSchool: args.previousSchool?.trim() || undefined,
      notes: args.notes?.trim() || undefined,
      updatedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "student.created",
      entityType: "students",
      entityId: id,
      description: `Admitted ${args.firstName} ${args.lastName} (${admissionNumber})`,
    });
    return id;
  },
});

export const update = mutation({
  args: {
    studentId: v.id("students"),
    firstName: v.string(),
    middleName: v.optional(v.string()),
    lastName: v.string(),
    preferredName: v.optional(v.string()),
    gender: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    nationality: v.optional(v.string()),
    admissionDate: v.optional(v.string()),
    studentStatus: v.string(),
    boardingStatus: v.optional(v.union(v.literal("day"), v.literal("boarding"))),
    previousSchool: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { studentId, ...args }) => {
    const session = await requirePermission(ctx, "students.update");
    const student = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "students", studentId);
    if (student.studentStatus === "archived") {
      throw new ConvexError("This student is archived and cannot be edited.");
    }
    await ctx.db.patch(studentId, {
      ...args,
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      updatedAt: Date.now(),
      updatedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: student.schoolId,
      action: "student.updated",
      entityType: "students",
      entityId: studentId,
      description: `Updated ${args.firstName} ${args.lastName} (${student.admissionNumber})`,
    });
    return null;
  },
});

export const archive = mutation({
  args: {
    studentId: v.id("students"),
    status: v.union(
      v.literal("archived"),
      v.literal("withdrawn"),
      v.literal("transferred"),
      v.literal("graduated"),
    ),
  },
  handler: async (ctx, { studentId, status }) => {
    const session = await requirePermission(ctx, "students.archive");
    const student = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "students", studentId);
    await ctx.db.patch(studentId, {
      studentStatus: status,
      archivedAt: status === "archived" ? Date.now() : undefined,
      updatedAt: Date.now(),
      updatedById: session.userId,
    });
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    for (const e of enrollments) {
      if (e.status === "active") {
        await ctx.db.patch(e._id, {
          status: "inactive",
          exitDate: new Date().toISOString().slice(0, 10),
        });
      }
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: student.schoolId,
      action: "student.archived",
      entityType: "students",
      entityId: studentId,
      description: `${student.firstName} ${student.lastName} (${student.admissionNumber}) → ${status}`,
    });
    return null;
  },
});
