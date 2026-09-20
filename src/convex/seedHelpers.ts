import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const countSchools = internalQuery({
  args: {},
  handler: async (ctx) => {
    const schools = await ctx.db.query("schools").collect();
    return schools.length;
  },
});

export const findUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .collect();
    return users[0]?._id ?? null;
  },
});

export const getStudent = internalQuery({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    return await ctx.db.get(studentId);
  },
});

export const getGuardianLinks = internalQuery({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const links = await ctx.db
      .query("guardianStudents")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    return links.map((l) => ({ guardianId: l.guardianId }));
  },
});

/** Create (or reuse) a user record and attach a school membership. */
export const ensureUserRecord = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.string(),
    schoolId: v.optional(v.id("schools")),
  },
  handler: async (ctx, { email, name, role, schoolId }) => {
    const normalized = email.trim().toLowerCase();
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .collect();
    let userId: Id<"users">;
    if (users.length > 0) {
      userId = users[0]._id;
      // Clean up accidental duplicates from partial runs.
      for (let i = 1; i < users.length; i++) await ctx.db.delete(users[i]._id);
    } else {
      userId = await ctx.db.insert("users", { email: normalized, name, isActive: true });
    }
    if (schoolId) {
      const existing = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const match = existing.find((m) => m.schoolId === schoolId);
      if (!match) {
        await ctx.db.insert("schoolMemberships", {
          userId,
          schoolId,
          role,
          status: "active",
        });
      }
    }
    return userId;
  },
});

export const insertSchool = internalMutation({
  args: {
    name: v.string(), code: v.string(), slug: v.string(),
    email: v.optional(v.string()), phone: v.optional(v.string()),
    website: v.optional(v.string()), county: v.optional(v.string()),
    country: v.optional(v.string()), timezone: v.optional(v.string()),
    curriculum: v.optional(v.string()), currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("schools", {
      name: args.name, code: args.code, slug: args.slug,
      email: args.email, phone: args.phone, website: args.website,
      county: args.county, country: args.country, timezone: args.timezone,
      curriculum: args.curriculum, currency: args.currency,
      status: "active",
    });
  },
});

export const insertYear = internalMutation({
  args: { schoolId: v.id("schools"), name: v.string(), startDate: v.string(), endDate: v.string(), isCurrent: v.boolean() },
  handler: async (ctx, { schoolId, name, startDate, endDate, isCurrent }) => {
    if (isCurrent) {
      const existing = await ctx.db
        .query("academicYears")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      for (const y of existing) {
        if (y.isCurrent) await ctx.db.patch(y._id, { isCurrent: false });
      }
    }
    return await ctx.db.insert("academicYears", {
      schoolId, name, startDate, endDate, status: "active", isCurrent,
    });
  },
});

export const insertTerm = internalMutation({
  args: {
    schoolId: v.id("schools"), academicYearId: v.id("academicYears"),
    name: v.string(), startDate: v.string(), endDate: v.string(), displayOrder: v.number(),
  },
  handler: async (ctx, { schoolId, academicYearId, name, startDate, endDate, displayOrder }) => {
    return await ctx.db.insert("terms", {
      schoolId, academicYearId, name, startDate, endDate, displayOrder, status: "active", isCurrent: false,
    });
  },
});

export const setTermCurrent = internalMutation({
  args: { termId: v.id("terms") },
  handler: async (ctx, { termId }) => {
    const term = await ctx.db.get(termId);
    if (!term) return;
    const siblings = await ctx.db
      .query("terms")
      .withIndex("by_academic_year", (q) => q.eq("academicYearId", term.academicYearId))
      .collect();
    for (const t of siblings) {
      if (t.isCurrent) await ctx.db.patch(t._id, { isCurrent: false });
    }
    await ctx.db.patch(termId, { isCurrent: true });
  },
});

export const insertGrade = internalMutation({
  args: { schoolId: v.id("schools"), name: v.string(), shortName: v.string(), displayOrder: v.number() },
  handler: async (ctx, { schoolId, name, shortName, displayOrder }) => {
    return await ctx.db.insert("gradeLevels", { schoolId, name, shortName, displayOrder, status: "active" });
  },
});

export const insertSubject = internalMutation({
  args: { schoolId: v.id("schools"), name: v.string(), code: v.string(), subjectType: v.string() },
  handler: async (ctx, { schoolId, name, code, subjectType }) => {
    return await ctx.db.insert("subjects", { schoolId, name, code, subjectType, status: "active" });
  },
});

export const insertStaff = internalMutation({
  args: {
    schoolId: v.id("schools"), employeeNumber: v.string(),
    firstName: v.string(), lastName: v.string(), gender: v.string(),
    jobTitle: v.string(), department: v.string(), employmentType: v.string(),
    employmentStatus: v.string(), email: v.string(), phone: v.string(),
    hireDate: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("staff", {
      schoolId: args.schoolId,
      employeeNumber: args.employeeNumber,
      firstName: args.firstName, lastName: args.lastName, gender: args.gender,
      jobTitle: args.jobTitle, department: args.department,
      employmentType: args.employmentType, employmentStatus: args.employmentStatus,
      email: args.email, phone: args.phone, hireDate: args.hireDate,
    });
  },
});

export const linkStaffUser = internalMutation({
  args: { staffId: v.id("staff"), email: v.string() },
  handler: async (ctx, { staffId, email }) => {
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .collect();
    if (users[0]) await ctx.db.patch(staffId, { userId: users[0]._id });
  },
});

export const insertSection = internalMutation({
  args: {
    schoolId: v.id("schools"), academicYearId: v.id("academicYears"),
    gradeLevelId: v.id("gradeLevels"), streamName: v.string(),
    capacity: v.number(), classTeacherStaffId: v.optional(v.id("staff")),
  },
  handler: async (ctx, { schoolId, academicYearId, gradeLevelId, streamName, capacity, classTeacherStaffId }) => {
    return await ctx.db.insert("classSections", {
      schoolId, academicYearId, gradeLevelId, streamName, capacity, classTeacherStaffId, status: "active",
    });
  },
});

export const insertAllocation = internalMutation({
  args: {
    schoolId: v.id("schools"), staffId: v.id("staff"), subjectId: v.id("subjects"),
    classSectionId: v.id("classSections"), academicYearId: v.id("academicYears"),
    termId: v.optional(v.id("terms")),
  },
  handler: async (ctx, { schoolId, staffId, subjectId, classSectionId, academicYearId, termId }) => {
    const dup = await ctx.db
      .query("teacherAllocations")
      .withIndex("by_class_subject_year", (q) =>
        q.eq("classSectionId", classSectionId).eq("subjectId", subjectId).eq("academicYearId", academicYearId),
      )
      .collect();
    if (dup.some((a) => a.status !== "archived" && a.staffId === staffId)) return null;
    return await ctx.db.insert("teacherAllocations", {
      schoolId, staffId, subjectId, classSectionId, academicYearId, termId, status: "active",
    });
  },
});

export const insertStudent = internalMutation({
  args: {
    schoolId: v.id("schools"), admissionNumber: v.string(),
    firstName: v.string(), lastName: v.string(), gender: v.string(),
    dateOfBirth: v.string(), nationality: v.string(), admissionDate: v.string(),
    studentStatus: v.string(), boardingStatus: v.union(v.literal("day"), v.literal("boarding")),
    previousSchool: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("students", {
      schoolId: args.schoolId,
      admissionNumber: args.admissionNumber,
      firstName: args.firstName, lastName: args.lastName,
      gender: args.gender, dateOfBirth: args.dateOfBirth,
      nationality: args.nationality, admissionDate: args.admissionDate,
      studentStatus: args.studentStatus, boardingStatus: args.boardingStatus,
      previousSchool: args.previousSchool,
    });
  },
});

export const insertGuardian = internalMutation({
  args: {
    schoolId: v.id("schools"), firstName: v.string(), lastName: v.string(),
    relationship: v.string(), phone: v.string(), email: v.optional(v.string()),
    occupation: v.string(), address: v.optional(v.string()), nationalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("guardians", {
      schoolId: args.schoolId,
      firstName: args.firstName, lastName: args.lastName,
      relationship: args.relationship, phone: args.phone, email: args.email,
      occupation: args.occupation, address: args.address, nationalId: args.nationalId,
      status: "active",
    });
  },
});

export const linkGuardian = internalMutation({
  args: {
    schoolId: v.id("schools"), guardianId: v.id("guardians"), studentId: v.id("students"),
    isPrimary: v.boolean(), isEmergencyContact: v.boolean(), relationship: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("guardianStudents")
      .withIndex("by_guardian_student", (q) =>
        q.eq("guardianId", args.guardianId).eq("studentId", args.studentId),
      )
      .collect();
    if (existing.length > 0) return existing[0]._id;
    return await ctx.db.insert("guardianStudents", {
      schoolId: args.schoolId,
      guardianId: args.guardianId,
      studentId: args.studentId,
      relationship: args.relationship,
      isPrimary: args.isPrimary,
      isEmergencyContact: args.isEmergencyContact,
      receivesAcademicCommunication: true,
      receivesFinancialCommunication: true,
    });
  },
});

export const insertEnrollment = internalMutation({
  args: {
    schoolId: v.id("schools"), studentId: v.id("students"),
    academicYearId: v.id("academicYears"), classSectionId: v.id("classSections"),
    enrollmentDate: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("enrollments")
      .withIndex("by_student_year", (q) =>
        q.eq("studentId", args.studentId).eq("academicYearId", args.academicYearId),
      )
      .collect();
    if (existing.some((e) => e.status === "active")) return null;
    return await ctx.db.insert("enrollments", {
      schoolId: args.schoolId,
      studentId: args.studentId,
      academicYearId: args.academicYearId,
      classSectionId: args.classSectionId,
      enrollmentDate: args.enrollmentDate,
      status: "active",
    });
  },
});

export const seedAudit = internalMutation({
  args: {
    userId: v.id("users"),
    entries: v.array(
      v.object({
        action: v.string(),
        entityType: v.string(),
        entityId: v.optional(v.id("schools")),
        description: v.string(),
        schoolId: v.optional(v.id("schools")),
      }),
    ),
  },
  handler: async (ctx, { userId, entries }) => {
    for (const e of entries) {
      await ctx.db.insert("auditLogs", {
        userId,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        description: e.description,
        schoolId: e.schoolId,
      });
    }
  },
});

/* ------------------------------------------------------------------ */
/* Dev-only purge: deletes ALL rows from every table (guarded).        */
/* ------------------------------------------------------------------ */

const PURGE_TABLES = [
  "guardianStudents", "enrollments", "teacherAllocations", "classSections",
  "gradeLevels", "subjects", "terms", "academicYears", "students", "guardians",
  "staff", "schoolMemberships", "auditLogs", "files", "schools",
] as const;

export const purgeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of PURGE_TABLES) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    // Auth tables last (users, sessions, accounts, verification codes).
    const authTables = ["authSessions", "authAccounts", "authVerifiers", "authRateLimits", "users"] as const;
    for (const table of authTables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
  },
});
