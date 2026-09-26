import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord, requireSchoolSession } from "./session";
import { recordAudit } from "./audit";


/* ------------------------------------------------------------------ */
/* Academic Years                                                      */
/* ------------------------------------------------------------------ */

export const listYears = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "academics.view");
    const years = await ctx.db
      .query("academicYears")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return years.sort((a, b) => b.name.localeCompare(a.name));
  },
});

export const createYear = mutation({
  args: { name: v.string(), startDate: v.string(), endDate: v.string(), isCurrent: v.optional(v.boolean()) },
  handler: async (ctx, { name, startDate, endDate, isCurrent }) => {
    const session = await requirePermission(ctx, "academics.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!/^\d{4}(\/\d{2,4})?$/.test(name.trim()) && name.trim().length < 3) {
      throw new ConvexError("Give the year a clear name, e.g. 2026 or 2026-2027.");
    }
    if (endDate <= startDate) throw new ConvexError("End date must be after the start date.");
    const dup = await ctx.db
      .query("academicYears")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (dup.some((y) => y.name === name.trim())) {
      throw new ConvexError("An academic year with this name already exists.");
    }
    const yearId = await ctx.db.insert("academicYears", {
      schoolId,
      name: name.trim(),
      startDate,
      endDate,
      status: "active",
      isCurrent: !!isCurrent,
    });
    if (isCurrent) {
      for (const y of dup) {
        if (y.isCurrent) await ctx.db.patch(y._id, { isCurrent: false });
      }
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "academic_year.created",
      entityType: "academicYears",
      entityId: yearId,
      description: `Created academic year ${name}`,
    });
    return yearId;
  },
});

export const setCurrentYear = mutation({
  args: { yearId: v.id("academicYears") },
  handler: async (ctx, { yearId }) => {
    const session = await requirePermission(ctx, "academics.manage");
    const year = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "academicYears", yearId);
    const others = await ctx.db
      .query("academicYears")
      .withIndex("by_school", (q) => q.eq("schoolId", year.schoolId))
      .collect();
    for (const y of others) {
      if (y._id !== yearId && y.isCurrent) await ctx.db.patch(y._id, { isCurrent: false });
    }
    await ctx.db.patch(yearId, { isCurrent: true });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: year.schoolId,
      action: "academic_year.set_current",
      entityType: "academicYears",
      entityId: yearId,
      description: `Set ${year.name} as the current academic year`,
    });
    return null;
  },
});

export const archiveYear = mutation({
  args: { yearId: v.id("academicYears") },
  handler: async (ctx, { yearId }) => {
    const session = await requirePermission(ctx, "academics.manage");
    const year = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "academicYears", yearId);
    if (year.isCurrent) {
      throw new ConvexError("Set another year as current before archiving this one.");
    }
    await ctx.db.patch(yearId, { status: "archived", isCurrent: false });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: year.schoolId,
      action: "academic_year.archived",
      entityType: "academicYears",
      entityId: yearId,
      description: `Archived academic year ${year.name}`,
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* Terms                                                               */
/* ------------------------------------------------------------------ */

export const listTerms = query({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    const session = await requirePermission(ctx, "academics.view");
    const schoolId = session.schoolId as Id<"schools">;
    if (academicYearId) {
      const year = await getSchoolRecord(ctx, schoolId, "academicYears", academicYearId);
      const terms = await ctx.db
        .query("terms")
        .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
        .collect();
      return terms.sort((a, b) => a.displayOrder - b.displayOrder);
    }
    const terms = await ctx.db
      .query("terms")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return terms.sort((a, b) => a.displayOrder - b.displayOrder);
  },
});

export const createTerm = mutation({
  args: {
    academicYearId: v.id("academicYears"),
    name: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    displayOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "academics.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const year = await getSchoolRecord(ctx, schoolId, "academicYears", args.academicYearId);
    if (args.endDate <= args.startDate) {
      throw new ConvexError("Term end date must be after the start date.");
    }
    if (args.startDate < year.startDate || args.endDate > year.endDate) {
      throw new ConvexError("Term dates must fall within the academic year.");
    }
    const siblings = await ctx.db
      .query("terms")
      .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
      .collect();
    if (siblings.some((t) => t.name === args.name.trim())) {
      throw new ConvexError("A term with this name already exists in this year.");
    }
    const overlapping = siblings.some(
      (t) => args.startDate <= t.endDate && t.startDate <= args.endDate,
    );
    if (overlapping) throw new ConvexError("Term dates overlap another term in this year.");
    const termId = await ctx.db.insert("terms", {
      schoolId,
      academicYearId: year._id,
      name: args.name.trim(),
      startDate: args.startDate,
      endDate: args.endDate,
      status: "active",
      displayOrder: args.displayOrder,
      isCurrent: false,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "term.created",
      entityType: "terms",
      entityId: termId,
      description: `Created ${args.name} (${year.name})`,
    });
    return termId;
  },
});

export const setCurrentTerm = mutation({
  args: { termId: v.id("terms") },
  handler: async (ctx, { termId }) => {
    const session = await requirePermission(ctx, "academics.manage");
    const term = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "terms", termId);
    const year = await ctx.db.get(term.academicYearId);
    if (!year?.isCurrent) {
      throw new ConvexError("Set the term's academic year as current first.");
    }
    const siblings = await ctx.db
      .query("terms")
      .withIndex("by_academic_year", (q) => q.eq("academicYearId", term.academicYearId))
      .collect();
    for (const t of siblings) {
      if (t.isCurrent) await ctx.db.patch(t._id, { isCurrent: false });
    }
    await ctx.db.patch(termId, { isCurrent: true });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: term.schoolId,
      action: "term.set_current",
      entityType: "terms",
      entityId: termId,
      description: `Set ${term.name} (${year.name}) as the current term`,
    });
    return null;
  },
});

export const archiveTerm = mutation({
  args: { termId: v.id("terms") },
  handler: async (ctx, { termId }) => {
    const session = await requirePermission(ctx, "academics.manage");
    const term = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "terms", termId);
    if (term.isCurrent) throw new ConvexError("Set another term as current before archiving.");
    await ctx.db.patch(termId, { status: "archived", isCurrent: false });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: term.schoolId,
      action: "term.archived",
      entityType: "terms",
      entityId: termId,
      description: `Archived term ${term.name}`,
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* Grade Levels                                                        */
/* ------------------------------------------------------------------ */

export const listGradeLevels = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "academics.view");
    const rows = await ctx.db
      .query("gradeLevels")
      .withIndex("by_school_order", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return rows.sort((a, b) => a.displayOrder - b.displayOrder);
  },
});

export const createGradeLevel = mutation({
  args: { name: v.string(), shortName: v.optional(v.string()), displayOrder: v.number() },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "academics.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!args.name.trim()) throw new ConvexError("Grade name is required.");
    const existing = await ctx.db
      .query("gradeLevels")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (existing.some((g) => g.name.toLowerCase() === args.name.trim().toLowerCase())) {
      throw new ConvexError("A grade level with this name already exists.");
    }
    const id = await ctx.db.insert("gradeLevels", {
      schoolId,
      name: args.name.trim(),
      shortName: args.shortName?.trim() || undefined,
      displayOrder: args.displayOrder,
      status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "grade_level.created",
      entityType: "gradeLevels",
      entityId: id,
      description: `Created grade level ${args.name}`,
    });
    return id;
  },
});

export const updateGradeLevel = mutation({
  args: {
    gradeLevelId: v.id("gradeLevels"),
    name: v.string(),
    shortName: v.optional(v.string()),
    displayOrder: v.number(),
    status: v.string(),
  },
  handler: async (ctx, { gradeLevelId, ...args }) => {
    const session = await requirePermission(ctx, "academics.manage");
    const grade = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "gradeLevels", gradeLevelId);
    await ctx.db.patch(gradeLevelId, { ...args, name: args.name.trim() });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: grade.schoolId,
      action: "grade_level.updated",
      entityType: "gradeLevels",
      entityId: gradeLevelId,
      description: `Updated grade level ${args.name}`,
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* Class Sections                                                      */
/* ------------------------------------------------------------------ */

export const listClassSections = query({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    const session = await requirePermission(ctx, "academics.view");
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
    const year = await ctx.db.get(yearId);
    const rows = await ctx.db
      .query("classSections")
      .withIndex("by_academic_year", (q) => q.eq("academicYearId", yearId as Id<"academicYears">))
      .collect();
    const enriched = await Promise.all(
      rows.map(async (c) => {
        const grade = await ctx.db.get(c.gradeLevelId);
        const teacher = c.classTeacherStaffId ? await ctx.db.get(c.classTeacherStaffId) : null;
        const enrollments = await ctx.db
          .query("enrollments")
          .withIndex("by_class_section", (q) => q.eq("classSectionId", c._id))
          .collect();
        return {
          _id: c._id,
          gradeName: grade?.name ?? "—",
          gradeShortName: grade?.shortName ?? null,
          streamName: c.streamName,
          capacity: c.capacity,
          status: c.status,
          yearName: year?.name ?? "—",
          classTeacher: teacher ? `${teacher.firstName} ${teacher.lastName}` : null,
          enrolledCount: enrollments.filter((e) => e.status === "active").length,
        };
      }),
    );
    return enriched.sort((a, b) => a.gradeName.localeCompare(b.gradeName) || a.streamName.localeCompare(b.streamName));
  },
});

export const createClassSection = mutation({
  args: {
    academicYearId: v.id("academicYears"),
    gradeLevelId: v.id("gradeLevels"),
    streamName: v.string(),
    capacity: v.optional(v.number()),
    classTeacherStaffId: v.optional(v.id("staff")),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "academics.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const year = await getSchoolRecord(ctx, schoolId, "academicYears", args.academicYearId);
    const grade = await getSchoolRecord(ctx, schoolId, "gradeLevels", args.gradeLevelId);
    if (!args.streamName.trim()) throw new ConvexError("Stream/section name is required.");
    if (args.classTeacherStaffId) {
      await getSchoolRecord(ctx, schoolId, "staff", args.classTeacherStaffId);
    }
    // Uniqueness: grade + stream within the same year.
    const siblings = await ctx.db
      .query("classSections")
      .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
      .collect();
    if (
      siblings.some(
        (c) =>
          c.gradeLevelId === grade._id &&
          c.streamName.toLowerCase() === args.streamName.trim().toLowerCase(),
      )
    ) {
      throw new ConvexError(`${grade.name} ${args.streamName} already exists for this year.`);
    }
    const id = await ctx.db.insert("classSections", {
      schoolId,
      academicYearId: year._id,
      gradeLevelId: grade._id,
      streamName: args.streamName.trim(),
      capacity: args.capacity,
      classTeacherStaffId: args.classTeacherStaffId,
      status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "class_section.created",
      entityType: "classSections",
      entityId: id,
      description: `Created ${grade.name} ${args.streamName} (${year.name})`,
    });
    return id;
  },
});

export const updateClassSection = mutation({
  args: {
    classSectionId: v.id("classSections"),
    streamName: v.string(),
    capacity: v.optional(v.number()),
    classTeacherStaffId: v.optional(v.id("staff")),
    status: v.string(),
  },
  handler: async (ctx, { classSectionId, ...args }) => {
    const session = await requirePermission(ctx, "academics.manage");
    const section = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "classSections", classSectionId);
    if (args.classTeacherStaffId) {
      await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "staff", args.classTeacherStaffId);
    }
    await ctx.db.patch(classSectionId, { ...args, streamName: args.streamName.trim() });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: section.schoolId,
      action: "class_section.updated",
      entityType: "classSections",
      entityId: classSectionId,
      description: `Updated class section ${args.streamName}`,
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

export const listSubjects = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "subjects.view");
    const rows = await ctx.db
      .query("subjects")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createSubject = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    shortName: v.optional(v.string()),
    subjectType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "subjects.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const code = args.code.trim().toUpperCase();
    if (!args.name.trim()) throw new ConvexError("Subject name is required.");
    if (!code) throw new ConvexError("Subject code is required.");
    const dup = await ctx.db
      .query("subjects")
      .withIndex("by_school_code", (q) => q.eq("schoolId", schoolId).eq("code", code))
      .unique();
    if (dup) throw new ConvexError("A subject with this code already exists.");
    const id = await ctx.db.insert("subjects", {
      schoolId,
      name: args.name.trim(),
      code,
      shortName: args.shortName?.trim() || undefined,
      subjectType: args.subjectType || undefined,
      status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "subject.created",
      entityType: "subjects",
      entityId: id,
      description: `Created subject ${args.name} (${code})`,
    });
    return id;
  },
});

export const updateSubject = mutation({
  args: {
    subjectId: v.id("subjects"),
    name: v.string(),
    code: v.string(),
    shortName: v.optional(v.string()),
    subjectType: v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, { subjectId, ...args }) => {
    const session = await requirePermission(ctx, "subjects.manage");
    const subject = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "subjects", subjectId);
    const code = args.code.trim().toUpperCase();
    const dup = await ctx.db
      .query("subjects")
      .withIndex("by_school_code", (q) => q.eq("schoolId", subject.schoolId).eq("code", code))
      .unique();
    if (dup && dup._id !== subjectId) throw new ConvexError("A subject with this code already exists.");
    await ctx.db.patch(subjectId, { ...args, code, name: args.name.trim() });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: subject.schoolId,
      action: "subject.updated",
      entityType: "subjects",
      entityId: subjectId,
      description: `Updated subject ${args.name} (${code})`,
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* Dashboard: academic context                                         */
/* ------------------------------------------------------------------ */

export const academicContext = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireSchoolSession(ctx);
    const schoolId = session.schoolId as Id<"schools">;
    const year = await ctx.db
      .query("academicYears")
      .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
      .first();
    let term: Doc<"terms"> | null = null;
    if (year) {
      term = await ctx.db
        .query("terms")
        .withIndex("by_academic_year_current", (q) =>
          q.eq("academicYearId", year._id).eq("isCurrent", true),
        )
        .first();
    }
    const years = await ctx.db
      .query("academicYears")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return {
      currentYear: year ? { _id: year._id, name: year.name, startDate: year.startDate, endDate: year.endDate } : null,
      currentTerm: term ? { _id: term._id, name: term.name, startDate: term.startDate, endDate: term.endDate } : null,
      yearsCount: years.length,
    };
  },
});

type Doc<T extends keyof import("./_generated/dataModel").DataModel> =
  import("./_generated/dataModel").Doc<T>;
