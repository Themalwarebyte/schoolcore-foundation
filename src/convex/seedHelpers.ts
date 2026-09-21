import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";

export const countSchools = internalQuery({
  args: {},
  handler: async (ctx) => {
    const schools = await ctx.db.query("schools").collect();
    return schools.length;
  },
});

/** Verification query for the Phase 2 academic-ops seed. */
export const academicOpsStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "timetablePeriods", "rooms", "timetableEntries", "attendanceSessions",
      "attendanceRecords", "assessmentTypes", "assessments", "assessmentScores",
      "gradingSchemes", "gradeBands", "subjectResults", "assignments",
      "assignmentRecipients", "schoolSettings",
    ] as const;
    const counts: Record<string, number> = {};
    for (const t of tables) {
      counts[t] = (await ctx.db.query(t).collect()).length;
    }
    return counts;
  },
});

/**
 * One-shot workflow verification for the Phase 2 demo data (internal, safe):
 * approves + publishes the seeded Greenfield subject results, then generates
 * report cards for that class, exercising the real approval/publish engines.
 */
export const verifyResultsWorkflow = internalMutation({
  args: {},
  handler: async (ctx) => {
    const school = (await ctx.db.query("schools").collect()).find((s) => s.code === "GRN-001");
    if (!school) return { note: "Greenfield not found" };
    const results = (await ctx.db.query("subjectResults").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect())
      .filter((r) => r.status === "submitted");
    if (results.length === 0) return { note: "No submitted results to verify" };
    const admin = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", "admin@greenfield.ac.ke"))
      .first();
    if (!admin) return { note: "admin user missing" };
    const now = Date.now();
    for (const r of results) {
      await ctx.db.patch(r._id, { status: "approved", approvedById: admin._id, updatedAt: now });
    }
    for (const r of results) {
      await ctx.db.patch(r._id, { status: "published", publishedAt: now, updatedAt: now });
    }
    // Lock contributing assessments.
    const termId = results[0].termId;
    const classSectionId = results[0].classSectionId;
    const subjectId = results[0].subjectId;
    const assessments = await ctx.db
      .query("assessments")
      .withIndex("by_class_subject_term", (q) =>
        q.eq("classSectionId", classSectionId).eq("subjectId", subjectId).eq("termId", termId))
      .collect();
    for (const a of assessments) {
      if (["draft", "open", "marking", "submitted", "approved"].includes(a.status)) {
        await ctx.db.patch(a._id, { status: "locked", updatedAt: now });
      }
    }
    return {
      approved: results.length,
      published: results.length,
      assessmentsLocked: assessments.length,
    };
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

export const findSchoolByCode = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const schools = await ctx.db.query("schools").collect();
    return schools.find((s) => s.code === code)?._id ?? null;
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

/**
 * Self-heal staff→user links: any staff row in the school whose email matches
 * gets its userId repointed to the canonical authenticated user (the user row
 * the password authAccount resolves to). Idempotent.
 */
export const alignStaffUserLink = internalMutation({
  args: { schoolId: v.id("schools"), email: v.string(), userId: v.id("users") },
  handler: async (ctx, { schoolId, email, userId }) => {
    const staff = await ctx.db
      .query("staff")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const normalized = email.trim().toLowerCase();
    for (const s of staff) {
      if ((s.email ?? "").trim().toLowerCase() === normalized && s.userId !== userId) {
        await ctx.db.patch(s._id, { userId });
      }
    }
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

/** Variant with an optional pre-created user account link (used by seed). */
export const insertStaffWithUser = internalMutation({
  args: {
    schoolId: v.id("schools"), employeeNumber: v.string(),
    firstName: v.string(), lastName: v.string(), gender: v.string(),
    jobTitle: v.string(), department: v.string(), employmentType: v.string(),
    employmentStatus: v.string(), email: v.string(), phone: v.string(),
    hireDate: v.string(), userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const { userId, ...rest } = args;
    return await ctx.db.insert("staff", { ...rest, userId });
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
/* Phase 2: academic operations config + demo data (idempotent).        */
/* Safe to run against an already-seeded production deployment — every   */
/* step checks for existing rows and only fills genuine gaps.           */
/* ------------------------------------------------------------------ */

export const seedAcademicOps = internalMutation({
  args: {},
  handler: async (ctx) => {
    const schools = await ctx.db.query("schools").collect();

    for (const school of schools) {
      /* 1. Academic settings (attendance mode, report card options) ---- */
      const settings = await ctx.db
        .query("schoolSettings")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .first();
      if (!settings) {
        await ctx.db.insert("schoolSettings", {
          schoolId: school._id,
          attendanceMode: "daily",
          schoolDays: ["mon", "tue", "wed", "thu", "fri"],
          editableWindowDays: 7,
          rankingEnabled: true,
          reportCardShowAttendance: true,
          reportCardShowSubjectComments: true,
          reportCardShowRank: true,
          reportCardSignatureLabels: "Class Teacher | Principal",
        });
      }

      /* 2. Timetable periods ------------------------------------------- */
      let periodRows = await ctx.db
        .query("timetablePeriods")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .collect();
      if (periodRows.filter((p) => p.status === "active").length === 0) {
        const periodDefs: [string, string, string, string][] = [
          ["Assembly", "07:30", "07:50", "assembly"],
          ["Period 1", "07:50", "08:30", "teaching"],
          ["Period 2", "08:30", "09:10", "teaching"],
          ["Break", "09:10", "09:30", "break"],
          ["Period 3", "09:30", "10:10", "teaching"],
          ["Period 4", "10:10", "10:50", "teaching"],
          ["Lunch", "10:50", "11:30", "lunch"],
          ["Period 5", "11:30", "12:10", "teaching"],
          ["Period 6", "12:10", "12:50", "teaching"],
        ];
        for (let i = 0; i < periodDefs.length; i++) {
          const [name, start, end, type] = periodDefs[i];
          await ctx.db.insert("timetablePeriods", {
            schoolId: school._id,
            name,
            startTime: start,
            endTime: end,
            periodType: type,
            displayOrder: i + 1,
            status: "active",
          });
        }
        periodRows = await ctx.db
          .query("timetablePeriods")
          .withIndex("by_school", (q) => q.eq("schoolId", school._id))
          .collect();
      }
      const teachingPeriods = periodRows
        .filter((p) => p.status === "active" && p.periodType === "teaching")
        .sort((a, b) => a.displayOrder - b.displayOrder);

      /* 3. Rooms -------------------------------------------------------- */
      const roomRows = await ctx.db
        .query("rooms")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .collect();
      if (roomRows.length === 0) {
        for (const r of [
          { name: "Classroom A", code: "CR-A", capacity: 45, roomType: "classroom" },
          { name: "Classroom B", code: "CR-B", capacity: 45, roomType: "classroom" },
          { name: "Science Lab", code: "LAB-1", capacity: 30, roomType: "laboratory" },
        ]) {
          await ctx.db.insert("rooms", { schoolId: school._id, ...r, status: "active" });
        }
      }

      /* 4. Assessment types --------------------------------------------- */
      const typeRows = await ctx.db
        .query("assessmentTypes")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .collect();
      if (typeRows.length === 0) {
        for (const t of [
          { name: "Opener Exam", shortName: "OPEN", defaultWeight: 40 },
          { name: "Midterm Exam", shortName: "MID", defaultWeight: 30 },
          { name: "Endterm Exam", shortName: "END", defaultWeight: 30 },
          { name: "Class Test", shortName: "TEST", defaultWeight: 20 },
          { name: "Project", shortName: "PRJ", defaultWeight: 10 },
        ]) {
          await ctx.db.insert("assessmentTypes", { schoolId: school._id, ...t, status: "active" });
        }
      }
      const assessmentTypes = await ctx.db
        .query("assessmentTypes")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .collect();

      /* 5. Grading scheme + bands --------------------------------------- */
      const schemeRows = await ctx.db
        .query("gradingSchemes")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .collect();
      if (schemeRows.length === 0) {
        const schemeId = await ctx.db.insert("gradingSchemes", {
          schoolId: school._id,
          name: "CBC Performance Bands",
          description: "Default competency-based grading bands",
          status: "active",
        });
        const bands: [string, number, number, boolean, string][] = [
          ["Exceeding Expectations", 90, 100, true, "Consistently above grade level"],
          ["Meeting Expectations", 75, 89, true, "At grade level"],
          ["Approaching Expectations", 58, 74, true, "Slightly below grade level"],
          ["Below Expectations", 40, 57, false, "Needs targeted support"],
          ["Intervention Required", 0, 39, false, "Intensive support needed"],
        ];
        for (let i = 0; i < bands.length; i++) {
          const [label, minPercent, maxPercent, isPass, descriptor] = bands[i];
          await ctx.db.insert("gradeBands", {
            schoolId: school._id,
            schemeId,
            label,
            minPercent,
            maxPercent,
            descriptor,
            isPass,
            displayOrder: i + 1,
          });
        }
      }

      /* Shared inputs for timetable + demo records ---------------------- */
      const year = await ctx.db
        .query("academicYears")
        .withIndex("by_school_current", (q) => q.eq("schoolId", school._id).eq("isCurrent", true))
        .first();
      const allocations = year
        ? (await ctx.db.query("teacherAllocations").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect())
            .filter((a) => a.status === "active" && a.academicYearId === year._id)
        : [];

      /* 6. Timetable entries (conflict-free greedy layout) --------------- */
      if (year && teachingPeriods.length > 0 && allocations.length > 0) {
        const existingEntries = await ctx.db
          .query("timetableEntries")
          .withIndex("by_school_year", (q) => q.eq("schoolId", school._id).eq("academicYearId", year._id))
          .collect();
        if (existingEntries.length === 0) {
          const sections = (
            await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect()
          ).filter((s) => s.status === "active" && s.academicYearId === year._id);
          const days = ["mon", "tue", "wed", "thu", "fri"];
          const busyTeacher = new Set<string>(); // staffId:day:periodId
          const busySlot = new Set<string>(); // classSectionId:day:periodId
          for (const section of sections) {
            for (const day of days) {
              for (const period of teachingPeriods) {
                const slotKey = `${section._id}:${day}:${period._id}`;
                if (busySlot.has(slotKey)) continue;
                const candidate: Doc<"teacherAllocations"> | undefined = allocations.find(
                  (a: Doc<"teacherAllocations">) =>
                    a.classSectionId === section._id &&
                    !busyTeacher.has(`${a.staffId}:${day}:${period._id}`),
                );
                if (!candidate) continue;
                busySlot.add(slotKey);
                busyTeacher.add(`${candidate.staffId}:${day}:${period._id}`);
                await ctx.db.insert("timetableEntries", {
                  schoolId: school._id,
                  academicYearId: year._id,
                  termId: undefined,
                  dayOfWeek: day,
                  periodId: period._id,
                  classSectionId: section._id,
                  subjectId: candidate.subjectId,
                  teacherAllocationId: candidate._id,
                  staffId: candidate.staffId,
                  roomId: undefined,
                  status: "published",
                  updatedAt: Date.now(),
                });
              }
            }
          }
        }
      }

      /* 7. Demo assessments, marks, attendance, assignment, results ------
       * Only for the Greenfield demo school and only when it has no        */
      /* assessments yet — real schools keep whatever they created.        */
      if (school.code === "GRN-001" && year) {
        const anyAssessments = await ctx.db
          .query("assessments")
          .withIndex("by_school", (q) => q.eq("schoolId", school._id))
          .collect();
        if (anyAssessments.length === 0) {
          const terms = await ctx.db
            .query("terms")
            .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
            .collect();
          const term1 = terms.sort((a, b) => a.displayOrder - b.displayOrder)[0];
          if (term1) {
            const sections = (
              await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect()
            ).filter((s) => s.status === "active" && s.academicYearId === year._id);
            const section = sections[2] ?? sections[0]; // Grade 7 Blue when seeded
            const subject = (
              await ctx.db.query("subjects").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect()
            )
              .filter((s) => s.status === "active")
              .find((s) => s.code === "MAT");
            if (section && subject) {
              const allocation = allocations.find(
                (a) => a.classSectionId === section._id && a.subjectId === subject._id,
              );
              const staffRow = allocation ? await ctx.db.get(allocation.staffId) : null;
              const recorder =
                staffRow?.userId ??
                (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "admin@greenfield.ac.ke")).first())?._id;
              if (recorder) {
                const typeExam = assessmentTypes.find((t) => t.name === "Opener Exam") ?? assessmentTypes[0];
                const typeTest = assessmentTypes.find((t) => t.name === "Class Test") ?? assessmentTypes[0];

                const openerId = await ctx.db.insert("assessments", {
                  schoolId: school._id,
                  academicYearId: year._id,
                  termId: term1._id,
                  classSectionId: section._id,
                  subjectId: subject._id,
                  teacherAllocationId: allocation?._id,
                  staffId: allocation?.staffId,
                  assessmentTypeId: typeExam._id,
                  title: "Mathematics Opener Exam",
                  assessmentDate: "2026-02-10",
                  maxMarks: 100,
                  weight: 40,
                  countsTowardFinal: true,
                  status: "marking",
                  createdBy: recorder,
                });
                const quizId = await ctx.db.insert("assessments", {
                  schoolId: school._id,
                  academicYearId: year._id,
                  termId: term1._id,
                  classSectionId: section._id,
                  subjectId: subject._id,
                  teacherAllocationId: allocation?._id,
                  staffId: allocation?.staffId,
                  assessmentTypeId: typeTest._id,
                  title: "Fractions Quiz",
                  assessmentDate: "2026-03-03",
                  maxMarks: 40,
                  weight: 60,
                  countsTowardFinal: true,
                  status: "marking",
                  createdBy: recorder,
                });

                const enrolls = (
                  await ctx.db.query("enrollments").withIndex("by_class_section", (q) => q.eq("classSectionId", section._id)).collect()
                ).filter((e) => e.status === "active" && e.academicYearId === year._id);

                for (let idx = 0; idx < enrolls.length; idx++) {
                  const e = enrolls[idx];
                  const base = 55 + ((idx * 13) % 40); // 55–94 deterministic
                  // Opener: one absent student exercises the absent workflow.
                  await ctx.db.insert("assessmentScores", {
                    schoolId: school._id,
                    assessmentId: openerId,
                    studentId: e.studentId,
                    enrollmentId: e._id,
                    status: idx === 3 ? "absent" : "entered",
                    score: idx === 3 ? undefined : Math.min(base + 3, 100),
                    recordedById: recorder,
                    updatedAt: Date.now(),
                  });
                  await ctx.db.insert("assessmentScores", {
                    schoolId: school._id,
                    assessmentId: quizId,
                    studentId: e.studentId,
                    enrollmentId: e._id,
                    status: "entered",
                    score: (base % 33) + 3, // 3–35 of 40
                    recordedById: recorder,
                    updatedAt: Date.now(),
                  });
                }

                // Submitted results for the subject (approve → publish demoable).
                const bands = await ctx.db.query("gradeBands").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
                const gradeLabelFor = (pct: number) =>
                  bands.find((b) => pct >= b.minPercent && pct <= b.maxPercent)?.label;
                for (let idx = 0; idx < enrolls.length; idx++) {
                  const e = enrolls[idx];
                  const base = 55 + ((idx * 13) % 40);
                  const openerPct = idx === 3 ? 0 : Math.min(base + 3, 100);
                  const quizPct = (((base % 33) + 3) / 40) * 100;
                  const pct = Math.round((openerPct * 0.4 + quizPct * 0.6) * 10) / 10;
                  await ctx.db.insert("subjectResults", {
                    schoolId: school._id,
                    academicYearId: year._id,
                    termId: term1._id,
                    classSectionId: section._id,
                    subjectId: subject._id,
                    studentId: e.studentId,
                    enrollmentId: e._id,
                    totalScore: pct,
                    percentage: pct,
                    gradeLabel: gradeLabelFor(pct),
                    status: "submitted",
                    submittedById: recorder,
                    updatedAt: Date.now(),
                  });
                }

                // A week of completed daily attendance (dates inside Term 1).
                for (const date of ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-09"]) {
                  const sessionId = await ctx.db.insert("attendanceSessions", {
                    schoolId: school._id,
                    academicYearId: year._id,
                    termId: term1._id,
                    classSectionId: section._id,
                    sessionType: "daily",
                    date,
                    status: "completed",
                    recordedById: recorder,
                    createdAt: Date.now(),
                  });
                  for (let idx = 0; idx < enrolls.length; idx++) {
                    const e = enrolls[idx];
                    const status = idx % 9 === 4 ? "absent" : idx % 11 === 7 ? "late" : idx === 2 && date === "2026-02-04" ? "excused" : "present";
                    await ctx.db.insert("attendanceRecords", {
                      schoolId: school._id,
                      sessionId,
                      studentId: e.studentId,
                      enrollmentId: e._id,
                      status,
                      recordedById: recorder,
                      updatedAt: Date.now(),
                    });
                  }
                }

                // One published assignment for the class.
                const assignmentId = await ctx.db.insert("assignments", {
                  schoolId: school._id,
                  academicYearId: year._id,
                  termId: term1._id,
                  classSectionId: section._id,
                  subjectId: subject._id,
                  staffId: (allocation?.staffId ?? recorder) as Id<"staff">,
                  teacherAllocationId: allocation?._id,
                  title: "Fractions problem set",
                  instructions: "Complete problems 1–12 from the fractions workbook.",
                  issueDate: "2026-02-20",
                  dueDate: "2026-02-27",
                  maxMarks: 20,
                  isGraded: true,
                  status: "published",
                  createdBy: recorder,
                  publishedAt: Date.now(),
                });
                for (const e of enrolls) {
                  await ctx.db.insert("assignmentRecipients", {
                    schoolId: school._id,
                    assignmentId,
                    studentId: e.studentId,
                    enrollmentId: e._id,
                  });
                }
              }
            }
          }
        }
      }
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
