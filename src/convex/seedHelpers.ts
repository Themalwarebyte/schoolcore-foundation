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
          attendanceMode: "both", // demo schools exercise daily + lesson attendance
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
/* Phase 3: finance demo data (idempotent). Adds fee structures,        */
/* invoices, payments, receipts, discounts, scholarships and expenses   */
/* through the REAL finance engines (ledger postings included) so the   */
/* dashboards and reports show genuine, reconciled figures.             */
/* ------------------------------------------------------------------ */

const FINANCE_ACCOUNTS: Array<{ code: string; name: string; accountType: string }> = [
  { code: "1000", name: "Cash on Hand", accountType: "asset" },
  { code: "1015", name: "Mobile Money", accountType: "asset" },
  { code: "1020", name: "Bank Account", accountType: "asset" },
  { code: "1200", name: "Accounts Receivable — Fees", accountType: "asset" },
  { code: "4000", name: "Tuition & Fee Revenue", accountType: "revenue" },
  { code: "4800", name: "Discounts & Waivers", accountType: "expense" },
  { code: "5000", name: "Operating Expenses", accountType: "expense" },
];

export const seedFinance = internalMutation({
  args: {},
  handler: async (ctx) => {
    const schools = await ctx.db.query("schools").collect();
    const round2 = (n: number) => Math.round(n * 100) / 100;

    for (const school of schools) {
      /* 1. Chart of accounts ------------------------------------------ */
      const existingAccounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .collect();
      for (const a of FINANCE_ACCOUNTS) {
        if (!existingAccounts.some((e) => e.code === a.code)) {
          await ctx.db.insert("ledgerAccounts", { schoolId: school._id, ...a, status: "active" });
        }
      }

      /* 2. Fee categories + payment methods --------------------------- */
      const categories = await ctx.db.query("feeCategories").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      if (categories.length === 0) {
        for (const c of ["Tuition", "Transport", "Meals", "Activity", "Examination"]) {
          await ctx.db.insert("feeCategories", { schoolId: school._id, name: c, status: "active" });
        }
      }
      const methods = await ctx.db.query("paymentMethods").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      if (methods.length === 0) {
        for (const m of [
          { name: "Cash", integrationKey: "cash" },
          { name: "Bank Transfer", integrationKey: "bank_transfer" },
          { name: "Mobile Money", integrationKey: "mobile_money" },
          { name: "Card", integrationKey: "card" },
          { name: "Cheque", integrationKey: "cheque" },
        ]) {
          await ctx.db.insert("paymentMethods", { schoolId: school._id, ...m, status: "active" });
        }
      }

      /* 3. Academic context ------------------------------------------- */
      const year = await ctx.db
        .query("academicYears")
        .withIndex("by_school_current", (q) => q.eq("schoolId", school._id).eq("isCurrent", true))
        .first();
      if (!year) continue;
      const terms = (await ctx.db.query("terms").withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id)).collect())
        .sort((a, b) => a.displayOrder - b.displayOrder);
      const term1 = terms[0];
      if (!term1) continue;

      const staff = await ctx.db.query("staff").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      const bursar = staff.find((s) => s.jobTitle === "Bursar");
      const actorRow = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", school.code === "GRN-001" ? "accounts@greenfield.ac.ke" : "admin@riverside.ac.ke"))
        .first();
      const approverRow = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", school.code === "GRN-001" ? "admin@greenfield.ac.ke" : "admin@riverside.ac.ke"))
        .first();
      if (!actorRow || !approverRow) continue;
      const actor = actorRow._id;
      const approver = approverRow._id;

      /* 4. Fee structure for Term 1 (all classes) --------------------- */
      let structure = (await ctx.db.query("feeStructures").withIndex("by_term", (q) => q.eq("termId", term1._id)).collect())
        .find((f) => f.schoolId === school._id);
      if (!structure) {
        const structureId = await ctx.db.insert("feeStructures", {
          schoolId: school._id,
          academicYearId: year._id,
          termId: term1._id,
          name: "Term 1 Standard Fees",
          applicableGradeLevelIds: [],
          status: "active",
          createdBy: approver,
        });
        const boarding = school.code === "GRN-001" ? 5000 : 6000;
        for (const item of [
          { name: "Tuition", category: "Tuition", amount: 40000, mandatory: true },
          { name: "Transport", category: "Transport", amount: 5000, mandatory: false },
          { name: "Meals", category: "Meals", amount: 8000, mandatory: true },
          { name: "Activity", category: "Activity", amount: 2000, mandatory: true },
          { name: "Boarding Supplement", category: "Boarding", amount: boarding, mandatory: false },
        ]) {
          await ctx.db.insert("feeItems", { schoolId: school._id, feeStructureId: structureId, ...item, status: "active" });
        }
        structure = (await ctx.db.get(structureId)) ?? undefined;
      }
      if (!structure) continue;
      const structureItems = (await ctx.db.query("feeItems").withIndex("by_structure", (q) => q.eq("feeStructureId", structure._id)).collect())
        .filter((i) => i.status === "active");

      /* 5. Bill every active enrolled student (ledger-posted) --------- */
      const enrollments = (
        await ctx.db.query("enrollments").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect()
      ).filter((e) => e.status === "active" && e.academicYearId === year._id);
      const existingInvoices = (await ctx.db.query("invoices").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect())
        .filter((i) => i.termId === term1._id);
      const billedStudents = new Set(existingInvoices.map((i) => i.studentId));

      const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      const studentById = new Map(students.map((s) => [s._id, s]));
      const receiptsBySchool = (await ctx.db.query("receipts").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect()).length;

      // Numbering continuity: derive the current maxima once per school.
      const numberMax = (rows: string[]) =>
        rows.reduce((m, num) => {
          const n = Number(num.split("-").pop());
          return Number.isFinite(n) ? Math.max(m, n) : m;
        }, 0);
      const invoicesAll = await ctx.db.query("invoices").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      const paymentsAll = await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      const txnsAll = await ctx.db.query("ledgerTransactions").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      let invSeq = numberMax(invoicesAll.map((i) => i.invoiceNumber));
      let paySeq = numberMax(paymentsAll.map((p) => p.paymentNumber));
      let recSeq = numberMax(receiptsBySchool === 0 ? [] : (await ctx.db.query("receipts").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect()).map((r) => r.receiptNumber));
      let txnSeq = numberMax(txnsAll.map((t) => t.transactionNumber));
      const yearLabel = year.name;
      const pad = (n: number) => String(n).padStart(5, "0");
      const nextDoc = (prefix: string, seq: number) => `${prefix}-${yearLabel}-${pad(seq)}`;

      const receivable = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_school_code", (q) => q.eq("schoolId", school._id).eq("code", "1200"))
        .first();
      const revenue = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_school_code", (q) => q.eq("schoolId", school._id).eq("code", "4000"))
        .first();
      const cashAcc = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_school_code", (q) => q.eq("schoolId", school._id).eq("code", "1000"))
        .first();
      const bankAcc = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_school_code", (q) => q.eq("schoolId", school._id).eq("code", "1020"))
        .first();
      const mmAcc = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_school_code", (q) => q.eq("schoolId", school._id).eq("code", "1015"))
        .first();
      const discAcc = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_school_code", (q) => q.eq("schoolId", school._id).eq("code", "4800"))
        .first();
      const expAcc = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_school_code", (q) => q.eq("schoolId", school._id).eq("code", "5000"))
        .first();
      if (!receivable || !revenue || !cashAcc || !bankAcc || !mmAcc || !discAcc || !expAcc) continue;

      const invoiceIds: Array<{ invoiceId: Id<"invoices">; studentId: Id<"students">; total: number; accountId: Id<"studentAccounts"> }> = [];
      for (const e of enrollments) {
        if (billedStudents.has(e.studentId)) continue;
        const student = studentById.get(e.studentId);
        if (!student) continue;
        let account = await ctx.db
          .query("studentAccounts")
          .withIndex("by_school_student", (q) => q.eq("schoolId", school._id).eq("studentId", student._id))
          .first();
        if (!account) {
          const accountId = await ctx.db.insert("studentAccounts", { schoolId: school._id, studentId: student._id, openingBalance: 0, status: "active" });
          account = await ctx.db.get(accountId);
        }
        if (!account) continue;
        // Tuition + Meals + Activity for everyone; Transport/Boarding for some.
        const chosen = structureItems.filter((it) =>
          it.mandatory || (student.boardingStatus === "boarding" && it.category === "Boarding") || (e.studentId.length % 3 === 0 && it.category === "Transport"),
        );
        const items = chosen.length > 0 ? chosen : structureItems;
        const total = round2(items.reduce((s, i) => s + i.amount, 0));
        invSeq += 1;
        const invoiceNumber = nextDoc("INV", invSeq);
        const invoiceId = await ctx.db.insert("invoices", {
          schoolId: school._id,
          invoiceNumber,
          studentId: student._id,
          accountId: account._id,
          academicYearId: year._id,
          termId: term1._id,
          issueDate: "2026-01-10",
          dueDate: "2026-02-10",
          totalAmount: total,
          status: "issued",
          notes: "Seeded term invoice",
          createdById: actor,
          issuedAt: Date.now(),
        });
        for (const it of items) {
          await ctx.db.insert("invoiceItems", {
            schoolId: school._id, invoiceId, description: it.name,
            category: it.category, quantity: 1, amount: it.amount, sourceFeeItemId: it._id,
          });
        }
        txnSeq += 1;
        const txnId = await ctx.db.insert("ledgerTransactions", {
          schoolId: school._id,
          transactionType: "invoice",
          transactionNumber: nextDoc("TXN", txnSeq),
          date: "2026-01-10",
          amount: total,
          description: `Invoice ${invoiceNumber} — ${student.firstName} ${student.lastName}`,
          studentId: student._id,
          accountId: account._id,
          invoiceId,
          createdById: actor,
          createdAt: Date.now(),
        });
        await ctx.db.insert("ledgerEntries", {
          schoolId: school._id, transactionId: txnId, accountId: receivable._id, direction: "debit", amount: total,
        });
        await ctx.db.insert("ledgerEntries", {
          schoolId: school._id, transactionId: txnId, accountId: revenue._id, direction: "credit", amount: total,
        });
        invoiceIds.push({ invoiceId, studentId: student._id, total, accountId: account._id });
      }

      /* 6. Payments + receipts with realistic spread ------------------ */
      const payMethods = await ctx.db.query("paymentMethods").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      const methodFor = (i: number) => payMethods[i % Math.max(payMethods.length, 1)] ?? { name: "Cash", integrationKey: "cash" as string | undefined };
      const cashCodeFor = (key?: string) => (key === "mobile_money" ? mmAcc._id : key === "bank_transfer" ? bankAcc._id : cashAcc._id);
      let seededPayments = 0;
      for (let idx = 0; idx < invoiceIds.length; idx++) {
        const { invoiceId, studentId, total, accountId } = invoiceIds[idx];
        const student = studentById.get(studentId as Id<"students">);
        if (!student) continue;
        // Distribution: ~55% fully paid, ~25% half paid, ~20% unpaid.
        const bucket = idx % 20;
        const fraction = bucket < 11 ? 1 : bucket < 16 ? 0.5 : 0;
        if (fraction === 0) continue;
        const method = methodFor(idx);
        const amount = round2(total * fraction);
        paySeq += 1;
        const paymentNumber = nextDoc("PAY", paySeq);
        const paymentDate = bucket % 3 === 0 ? "2026-01-28" : bucket % 3 === 1 ? "2026-02-05" : "2026-02-09";
        const paymentId = await ctx.db.insert("payments", {
          schoolId: school._id,
          paymentNumber,
          studentId: studentId as Id<"students">,
          accountId,
          invoiceId,
          amount,
          paymentDate,
          method: method.name,
          referenceNumber: `SEED-${paymentNumber}`,
          receivedById: actor,
          status: "confirmed",
          confirmedAt: Date.now(),
        });
        txnSeq += 1;
        const txnId = await ctx.db.insert("ledgerTransactions", {
          schoolId: school._id,
          transactionType: "payment",
          transactionNumber: nextDoc("TXN", txnSeq),
          date: paymentDate,
          amount,
          description: `Payment ${paymentNumber} — ${student.firstName} ${student.lastName}`,
          studentId: studentId as Id<"students">,
          accountId,
          invoiceId,
          paymentId,
          createdById: actor,
          createdAt: Date.now(),
        });
        const cashAccountId = cashCodeFor(method.integrationKey);
        await ctx.db.insert("ledgerEntries", {
          schoolId: school._id, transactionId: txnId, accountId: cashAccountId, direction: "debit", amount,
        });
        await ctx.db.insert("ledgerEntries", {
          schoolId: school._id, transactionId: txnId, accountId: receivable._id, direction: "credit", amount,
        });
        recSeq += 1;
        const receiptNumber = nextDoc("REC", recSeq);
        await ctx.db.insert("receipts", {
          schoolId: school._id, receiptNumber, paymentId, studentId: studentId as Id<"students">,
          accountId, amount, balanceAfter: round2(total - amount), method: method.name,
          paymentDate, issuedById: actor, issuedAt: Date.now(),
        });
        seededPayments++;
      }

      /* 7. Refresh invoice statuses from the ledger ------------------- */
      for (const { invoiceId } of invoiceIds) {
        const inv = await ctx.db.get(invoiceId as Id<"invoices">);
        if (!inv || inv.status === "cancelled") continue;
        const txns = (await ctx.db.query("ledgerTransactions").withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId as Id<"invoices">)).collect())
          .filter((t) => t.transactionType === "payment" || t.transactionType === "discount");
        const settled = round2(txns.reduce((s, t) => s + t.amount, 0));
        let status = inv.status;
        if (settled >= inv.totalAmount - 0.001) status = "paid";
        else if (settled > 0) status = "partially_paid";
        else if (inv.dueDate < "2026-09-22") status = "overdue";
        if (status !== inv.status) await ctx.db.patch(inv._id, { status });
      }

      /* 8. Discounts (pending + applied), scholarships, expenses ------ */
      const discAll = await ctx.db.query("discounts").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      if (discAll.length === 0 && invoiceIds.length > 0) {
        const discTargets = invoiceIds.slice(0, Math.min(8, invoiceIds.length));
        let discSeq = 0;
        for (let i = 0; i < discTargets.length; i++) {
          const { invoiceId, studentId, accountId, total } = discTargets[i];
          const student = studentById.get(studentId as Id<"students">);
          if (!student) continue;
          discSeq += 1;
          const discountNumber = nextDoc("DISC", discSeq);
          const isBursary = i % 2 === 0;
          const pct = isBursary ? 25 : 10;
          const computedAmount = round2((total * pct) / 100);
          const status = i < 5 ? "applied" : "pending";
          let appliedTransactionId: Id<"ledgerTransactions"> | undefined;
          if (status === "applied") {
            txnSeq += 1;
            const txnId = await ctx.db.insert("ledgerTransactions", {
              schoolId: school._id,
              transactionType: "discount",
              transactionNumber: nextDoc("TXN", txnSeq),
              date: "2026-02-07",
              amount: computedAmount,
              description: `Discount ${discountNumber} (${isBursary ? "Bursary" : "Sibling discount"})`,
              studentId: studentId as Id<"students">,
              accountId,
              invoiceId,
              createdById: approver,
              createdAt: Date.now(),
            });
            await ctx.db.insert("ledgerEntries", {
              schoolId: school._id, transactionId: txnId, accountId: discAcc._id, direction: "debit", amount: computedAmount,
            });
            await ctx.db.insert("ledgerEntries", {
              schoolId: school._id, transactionId: txnId, accountId: receivable._id, direction: "credit", amount: computedAmount,
            });
            appliedTransactionId = txnId;
          }
          await ctx.db.insert("discounts", {
            schoolId: school._id,
            discountNumber,
            studentId: studentId as Id<"students">,
            accountId,
            invoiceId,
            name: isBursary ? "Bursary (need-based)" : "Sibling discount",
            discountType: "percentage",
            value: pct,
            computedAmount: status === "applied" ? computedAmount : 0,
            reason: isBursary ? "Verified financial hardship" : "Second sibling enrolled",
            status,
            requestedById: actor,
            approvedById: status === "applied" ? approver : undefined,
            approvedAt: status === "applied" ? Date.now() : undefined,
            appliedTransactionId,
          });
        }
      }

      const schAll = await ctx.db.query("scholarships").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      if (schAll.length === 0 && invoiceIds.length > 2) {
        for (let i = 0; i < 3; i++) {
          const t = invoiceIds[i];
          const student = studentById.get(t.studentId as Id<"students">);
          if (!student) continue;
          await ctx.db.insert("scholarships", {
            schoolId: school._id,
            studentId: t.studentId as Id<"students">,
            accountId: t.accountId,
            name: i === 0 ? "Merit Scholarship 50%" : "Full Bursary",
            scholarshipType: i === 0 ? "percentage" : "amount",
            value: i === 0 ? 50 : 15000,
            reason: i === 0 ? "Top of class 2025" : "Governor's bursary fund",
            academicYearId: year._id,
            termId: term1._id,
            status: "active",
            approvedById: approver,
            approvedAt: Date.now(),
            createdAt: Date.now(),
          });
        }
      }

      const expAll = await ctx.db.query("expenses").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect();
      if (expAll.length === 0) {
        const expenseDefs = [
          { category: "Utilities", payee: "Kenya Power", amount: 42000, expenseDate: "2026-01-20", status: "paid" as const },
          { category: "Supplies", payee: "Textbook Centre Ltd", amount: 36500, expenseDate: "2026-01-25", status: "paid" as const },
          { category: "Food", payee: "Freshmart Suppliers", amount: 58000, expenseDate: "2026-02-02", status: "approved" as const },
          { category: "Maintenance", payee: "FixIt Services", amount: 12500, expenseDate: "2026-02-08", status: "submitted" as const },
          { category: "Transport", payee: "Rapid Fuel Station", amount: 21000, expenseDate: "2026-02-10", status: "draft" as const },
        ];
        let expSeq = 0;
        for (const def of expenseDefs) {
          expSeq += 1;
          const expenseNumber = nextDoc("EXP", expSeq);
          const expenseId = await ctx.db.insert("expenses", {
            schoolId: school._id,
            expenseNumber,
            category: def.category,
            payee: def.payee,
            amount: def.amount,
            expenseDate: def.expenseDate,
            description: `Seeded ${def.category.toLowerCase()} expense`,
            status: def.status,
            createdById: actor,
            submittedAt: def.status !== "draft" ? Date.now() : undefined,
            approvedById: def.status === "paid" || def.status === "approved" ? approver : undefined,
            approvedAt: def.status === "paid" || def.status === "approved" ? Date.now() : undefined,
          });
          if (def.status === "paid") {
            txnSeq += 1;
            const txnId = await ctx.db.insert("ledgerTransactions", {
              schoolId: school._id,
              transactionType: "expense",
              transactionNumber: nextDoc("TXN", txnSeq),
              date: def.expenseDate,
              amount: def.amount,
              description: `Expense ${expenseNumber} — ${def.payee}`,
              expenseId,
              createdById: approver,
              createdAt: Date.now(),
            });
            await ctx.db.insert("ledgerEntries", {
              schoolId: school._id, transactionId: txnId, accountId: expAcc._id, direction: "debit", amount: def.amount,
            });
            await ctx.db.insert("ledgerEntries", {
              schoolId: school._id, transactionId: txnId, accountId: cashAcc._id, direction: "credit", amount: def.amount,
            });
            await ctx.db.patch(expenseId, { paidTransactionId: txnId });
          }
        }
      }

      void bursar;
      void seededPayments;
    }
  },
});

/* ------------------------------------------------------------------ */
/* Dev-only purge: deletes ALL rows from every table (guarded).        */
/* ------------------------------------------------------------------ */

const PURGE_TABLES = [
  // Phase 5 (children first: loans→copies→books, payslips→runs, etc.)
  "clinicVisits", "medicalProfiles",
  "purchaseRequestItems", "purchaseOrders", "purchaseRequests", "suppliers",
  "stockMovements", "inventoryItems", "assets",
  "boardingAllocations", "beds", "hostelRooms", "hostels",
  "transportAssignments", "routeStops", "transportRoutes", "drivers", "vehicles",
  "bookLoans", "bookCopies", "books", "libraryCategories",
  "payslips", "payrollRuns", "salaryComponents", "salaryStructures",
  "leaveRequests", "leaveTypes", "staffDocuments", "contracts", "employees", "departments",
  // Phases 1–4
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

export const listActiveStudents = internalQuery({
  args: { schoolId: v.id("schools"), limit: v.number() },
  handler: async (ctx, { schoolId, limit }) => {
    const students = await ctx.db
      .query("students")
      .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("studentStatus", "active"))
      .collect();
    return students.slice(0, limit).map((s) => ({ _id: s._id, firstName: s.firstName, lastName: s.lastName }));
  },
});

/* ================================================================== */
/* Phase 4: portal demo-data seeding (idempotent)                       */
/* ================================================================== */

export const seedPortalDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const school = (await ctx.db.query("schools").collect()).find((s) => s.code === "GRN-001");
    if (!school) return { links: 0, announcements: 0 };
    const schoolId = school._id;
    let links = 0;

    // 1. One-child parent: link guardian of the first active student.
    const students = await ctx.db
      .query("students")
      .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("studentStatus", "active"))
      .collect();
    const first = students[0];
    const second = students[1];
    if (first) {
      const existingLinks = await ctx.db
        .query("guardianStudents")
        .withIndex("by_student", (q) => q.eq("studentId", first._id))
        .collect();
      if (existingLinks.length > 0) {
        const guardianId = existingLinks[0].guardianId;
        const hasPortal = await ctx.db
          .query("guardianPortalLinks")
          .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
          .collect()
          .then((ls) => ls.some((l) => l.status === "active"));
        if (!hasPortal) {
          const userId = await ctx.db
            .query("users")
            .withIndex("email", (q) => q.eq("email", "parent.wanjiku@greenfield.ac.ke"))
            .first();
          if (userId) {
            await ctx.db.insert("guardianPortalLinks", {
              schoolId,
              guardianId,
              userId: userId._id,
              invitedById: userId._id,
              invitedAt: Date.now(),
              status: "active",
            });
            links++;
          }
        }
      }
    }

    // 2. Multi-child parent: reuse a guardian linked to two sibling students.
    if (second) {
      const firstLinks = first
        ? await ctx.db
            .query("guardianStudents")
            .withIndex("by_student", (q) => q.eq("studentId", first._id))
            .collect()
        : [];
      if (firstLinks.length > 0) {
        const guardianId = firstLinks[0].guardianId;
        const secondLinks = await ctx.db
          .query("guardianStudents")
          .withIndex("by_guardian_student", (q) => q.eq("guardianId", guardianId).eq("studentId", second._id))
          .collect();
        if (secondLinks.length === 0) {
          await ctx.db.insert("guardianStudents", {
            schoolId,
            guardianId,
            studentId: second._id,
            relationship: "guardian",
            isPrimary: false,
            isEmergencyContact: true,
            receivesAcademicCommunication: true,
            receivesFinancialCommunication: true,
          });
          links++;
        }
      }
    }

    // 3. Student portal account for the first student.
    if (first) {
      const hasStudentPortal = await ctx.db
        .query("studentPortalLinks")
        .withIndex("by_student", (q) => q.eq("studentId", first._id))
        .collect()
        .then((ls) => ls.some((l) => l.status === "active"));
      if (!hasStudentPortal) {
        const userId = await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", "student.demo@greenfield.ac.ke"))
          .first();
        if (userId) {
          await ctx.db.insert("studentPortalLinks", {
            schoolId,
            studentId: first._id,
            userId: userId._id,
            invitedById: userId._id,
            invitedAt: Date.now(),
            status: "active",
          });
          links++;
        }
      }
    }

    // 4. Announcements (idempotent by title).
    const admin = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", "admin@greenfield.ac.ke"))
      .first();
    if (!admin) return { links, announcements: 0 };
    let announcements = 0;
    const drafts = [
      {
        title: "Term 2 Fee Payment Reminder",
        message:
          "Dear parents, Term 2 fees are due by 15th of next month. Payments can be made via bank transfer or mobile money. Kindly reference the student admission number.",
        audience: "parents",
      },
      {
        title: "Sports Day — Friday",
        message:
          "Our annual Sports Day takes place this Friday from 8:00 AM. All students should come in full sports uniform. Parents are welcome to attend.",
        audience: "all",
      },
      {
        title: "Staff Meeting — Monday 4 PM",
        message: "All teaching staff are required to attend the end-of-month staff meeting in the staff room.",
        audience: "teachers",
      },
      {
        title: "Grade 7 Science Trip",
        message:
          "Grade 7 students will visit the National Museum on Thursday. Permission slips were sent home and should be returned by Wednesday.",
        audience: "grade",
        gradeName: "Grade 7",
      },
    ];
    const grade7 = (await ctx.db.query("gradeLevels").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .find((g) => g.name === "Grade 7");
    for (const d of drafts) {
      const existing = await ctx.db
        .query("announcements")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect()
        .then((as) => as.find((a) => a.title === d.title));
      if (existing) continue;
      await ctx.db.insert("announcements", {
        schoolId,
        title: d.title,
        message: d.message,
        audience: d.audience,
        gradeLevelId: "gradeName" in d && d.gradeName === "Grade 7" && grade7 ? grade7._id : undefined,
        status: "published",
        publishDate: new Date().toISOString().slice(0, 10),
        createdById: admin._id,
        publishedAt: Date.now(),
        updatedAt: Date.now(),
      });
      announcements++;
    }
    return { links, announcements };
  },
});
