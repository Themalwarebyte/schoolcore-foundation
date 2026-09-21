import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

/* ------------------------------------------------------------------ */
/* Roles & Permissions                                                 */
/* ------------------------------------------------------------------ */

export const ROLES = [
  "super_admin",
  "school_admin",
  "principal",
  "teacher",
  "accountant",
  "parent",
  "student",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  school_admin: "School Admin",
  principal: "Principal",
  teacher: "Teacher",
  accountant: "Accountant",
  parent: "Parent",
  student: "Student",
};

/** Every permission key in the system. Roles map to sets of these. */
export const PERMISSIONS = [
  // school-scoped
  "dashboard.view",
  "school.view",
  "school.update",
  "users.view",
  "users.create",
  "users.update",
  "users.disable",
  "roles.manage",
  "students.view",
  "students.create",
  "students.update",
  "students.archive",
  "guardians.view",
  "guardians.create",
  "guardians.update",
  "staff.view",
  "staff.create",
  "staff.update",
  "staff.archive",
  "academics.view",
  "academics.manage",
  "subjects.view",
  "subjects.manage",
  "teacher_allocations.view",
  "teacher_allocations.manage",
  "audit_logs.view",
  "settings.view",
  "settings.manage",
  // phase 2 — attendance
  "attendance.view",
  "attendance.take",
  "attendance.edit",
  "attendance.manage",
  // phase 2 — timetable
  "timetable.view",
  "timetable.manage",
  "timetable.publish",
  // phase 2 — assignments
  "assignments.view",
  "assignments.create",
  "assignments.update",
  "assignments.publish",
  // phase 2 — assessments & marks
  "assessments.view",
  "assessments.create",
  "assessments.update",
  "assessments.manage",
  "marks.view",
  "marks.enter",
  "marks.update",
  "marks.submit",
  // phase 2 — grading, results, reports, analytics
  "grading.view",
  "grading.manage",
  "results.view",
  "results.review",
  "results.approve",
  "results.publish",
  "report_cards.view",
  "report_cards.generate",
  "report_cards.publish",
  "academic_analytics.view",
  // platform-scoped (super admin only)
  "platform.dashboard.view",
  "platform.schools.view",
  "platform.schools.manage",
  "platform.users.view",
  "platform.users.manage",
  "platform.audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: [...PERMISSIONS],
  school_admin: [
    "dashboard.view",
    "school.view",
    "school.update",
    "users.view",
    "users.create",
    "users.update",
    "users.disable",
    "roles.manage",
    "students.view",
    "students.create",
    "students.update",
    "students.archive",
    "guardians.view",
    "guardians.create",
    "guardians.update",
    "staff.view",
    "staff.create",
    "staff.update",
    "staff.archive",
    "academics.view",
    "academics.manage",
    "subjects.view",
    "subjects.manage",
    "teacher_allocations.view",
    "teacher_allocations.manage",
    "audit_logs.view",
    "settings.view",
    "settings.manage",
    "attendance.view", "attendance.take", "attendance.edit", "attendance.manage",
    "timetable.view", "timetable.manage", "timetable.publish",
    "assignments.view", "assignments.create", "assignments.update", "assignments.publish",
    "assessments.view", "assessments.create", "assessments.update", "assessments.manage",
    "marks.view", "marks.enter", "marks.update", "marks.submit",
    "grading.view", "grading.manage",
    "results.view", "results.review", "results.approve", "results.publish",
    "report_cards.view", "report_cards.generate", "report_cards.publish",
    "academic_analytics.view",
  ],
  principal: [
    "dashboard.view",
    "school.view",
    "school.update",
    "students.view",
    "students.create",
    "students.update",
    "students.archive",
    "guardians.view",
    "guardians.create",
    "guardians.update",
    "staff.view",
    "staff.create",
    "staff.update",
    "staff.archive",
    "academics.view",
    "academics.manage",
    "subjects.view",
    "subjects.manage",
    "teacher_allocations.view",
    "teacher_allocations.manage",
    "audit_logs.view",
    "settings.view",
    "attendance.view", "attendance.take", "attendance.edit", "attendance.manage",
    "timetable.view", "timetable.manage", "timetable.publish",
    "assignments.view", "assignments.create", "assignments.update", "assignments.publish",
    "assessments.view", "assessments.create", "assessments.update", "assessments.manage",
    "marks.view", "marks.enter", "marks.update", "marks.submit",
    "grading.view", "grading.manage",
    "results.view", "results.review", "results.approve", "results.publish",
    "report_cards.view", "report_cards.generate", "report_cards.publish",
    "academic_analytics.view",
  ],
  teacher: [
    "dashboard.view",
    "school.view",
    "students.view",
    "guardians.view",
    "academics.view",
    "subjects.view",
    "teacher_allocations.view",
    "settings.view",
    "attendance.view", "attendance.take", "attendance.edit",
    "timetable.view",
    "assignments.view", "assignments.create", "assignments.update", "assignments.publish",
    "assessments.view", "assessments.create", "assessments.update",
    "marks.view", "marks.enter", "marks.update", "marks.submit",
    "grading.view",
    "results.view",
    "report_cards.view",
    "academic_analytics.view",
  ],
  accountant: [
    "dashboard.view",
    "school.view",
    "students.view",
    "guardians.view",
    "staff.view",
    "academics.view",
    "settings.view",
  ],
  parent: ["dashboard.view", "school.view"],
  student: ["dashboard.view", "school.view"],
};

export function rolePermissions(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions(role).includes(permission);
}

/* ------------------------------------------------------------------ */
/* Enum values used across the schema                                  */
/* ------------------------------------------------------------------ */

export const GENDERS = ["male", "female", "other"] as const;
export const STUDENT_STATUSES = [
  "active",
  "inactive",
  "graduated",
  "transferred",
  "withdrawn",
  "archived",
] as const;
export const EMPLOYMENT_STATUSES = [
  "active",
  "on_leave",
  "suspended",
  "terminated",
  "retired",
  "archived",
] as const;
export const EMPLOYMENT_TYPES = ["permanent", "contract", "part_time", "temporary"] as const;
export const RELATIONSHIPS = [
  "mother",
  "father",
  "guardian",
  "sibling",
  "grandparent",
  "aunt_uncle",
  "other",
] as const;
export const ENTITY_STATUS = ["active", "inactive", "archived"] as const;

/* Phase 2 enums */
export const PERIOD_TYPES = ["teaching", "break", "lunch", "assembly", "other"] as const;
export const DAYS_OF_WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const TIMETABLE_ENTRY_STATUS = ["draft", "published"] as const;
export const ATTENDANCE_SESSION_TYPES = ["daily", "lesson"] as const;
export const ATTENDANCE_SESSION_STATUS = ["open", "completed"] as const;
export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;
export const ASSIGNMENT_STATUS = ["draft", "published", "closed", "archived"] as const;
export const ASSESSMENT_STATUSES = [
  "draft", "open", "marking", "submitted", "approved", "published", "locked",
] as const;
export const MARK_STATUSES = ["entered", "absent", "exempt"] as const;
export const RESULT_SUBMISSION_STATUS = [
  "draft", "submitted", "approved", "published", "locked", "reopened",
] as const;
export const REPORT_CARD_STATUS = ["draft", "generated", "published"] as const;

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const schema = defineSchema(
  {
    ...authTables,

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(v.string()), // default role for the template; kept for compatibility
      isActive: v.optional(v.boolean()),
    })
      .index("email", ["email"])
      .index("by_isActive", ["isActive"]),

    /* ---------------- Multi-school tenancy ---------------- */

    schools: defineTable({
      name: v.string(),
      code: v.string(),
      slug: v.string(),
      logo: v.optional(v.id("files")),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      website: v.optional(v.string()),
      postalAddress: v.optional(v.string()),
      physicalAddress: v.optional(v.string()),
      county: v.optional(v.string()),
      country: v.optional(v.string()),
      timezone: v.optional(v.string()),
      dateFormat: v.optional(v.string()),
      language: v.optional(v.string()),
      currency: v.optional(v.string()),
      curriculum: v.optional(v.string()),
      status: v.union(v.literal("active"), v.literal("inactive")),
      settings: v.optional(
        v.object({
          gradingPreference: v.optional(v.string()),
        }),
      ),
      createdBy: v.optional(v.id("users")),
    })
      .index("by_slug", ["slug"])
      .index("by_code", ["code"])
      .index("by_status", ["status"]),

    schoolMemberships: defineTable({
      userId: v.id("users"),
      /** Undefined for the platform super admin (no school scope). */
      schoolId: v.optional(v.id("schools")),
      role: v.string(), // Role
      status: v.union(v.literal("active"), v.literal("inactive")),
      createdById: v.optional(v.id("users")),
      updatedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_school", ["schoolId"])
      .index("by_user_school", ["userId", "schoolId"]),

    /* ---------------- People ---------------- */

    students: defineTable({
      schoolId: v.id("schools"),
      admissionNumber: v.string(),
      firstName: v.string(),
      middleName: v.optional(v.string()),
      lastName: v.string(),
      preferredName: v.optional(v.string()),
      gender: v.optional(v.string()),
      dateOfBirth: v.optional(v.string()), // YYYY-MM-DD
      nationality: v.optional(v.string()),
      admissionDate: v.optional(v.string()), // YYYY-MM-DD
      studentStatus: v.string(), // STUDENT_STATUSES
      boardingStatus: v.optional(v.union(v.literal("day"), v.literal("boarding"))),
      profilePhotoId: v.optional(v.id("files")),
      previousSchool: v.optional(v.string()),
      notes: v.optional(v.string()),
      archivedAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      updatedById: v.optional(v.id("users")),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_admission", ["schoolId", "admissionNumber"])
      .index("by_school_status", ["schoolId", "studentStatus"]),

    guardians: defineTable({
      schoolId: v.id("schools"),
      firstName: v.string(),
      middleName: v.optional(v.string()),
      lastName: v.string(),
      relationship: v.optional(v.string()),
      phone: v.optional(v.string()),
      altPhone: v.optional(v.string()),
      email: v.optional(v.string()),
      occupation: v.optional(v.string()),
      address: v.optional(v.string()),
      nationalId: v.optional(v.string()),
      status: v.string(), // ENTITY_STATUS
      updatedAt: v.optional(v.number()),
      updatedById: v.optional(v.id("users")),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_phone", ["schoolId", "phone"])
      .index("by_school_email", ["schoolId", "email"]),

    guardianStudents: defineTable({
      schoolId: v.id("schools"),
      guardianId: v.id("guardians"),
      studentId: v.id("students"),
      relationship: v.optional(v.string()),
      isPrimary: v.optional(v.boolean()),
      isEmergencyContact: v.optional(v.boolean()),
      receivesAcademicCommunication: v.optional(v.boolean()),
      receivesFinancialCommunication: v.optional(v.boolean()),
      pickupAuthorized: v.optional(v.boolean()),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"])
      .index("by_guardian", ["guardianId"])
      .index("by_guardian_student", ["guardianId", "studentId"]),

    staff: defineTable({
      schoolId: v.id("schools"),
      employeeNumber: v.string(),
      userId: v.optional(v.id("users")),
      firstName: v.string(),
      middleName: v.optional(v.string()),
      lastName: v.string(),
      gender: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      jobTitle: v.optional(v.string()),
      department: v.optional(v.string()),
      employmentType: v.optional(v.string()), // EMPLOYMENT_TYPES
      employmentStatus: v.string(), // EMPLOYMENT_STATUSES
      hireDate: v.optional(v.string()),
      profilePhotoId: v.optional(v.id("files")),
      notes: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
      updatedById: v.optional(v.id("users")),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_employee", ["schoolId", "employeeNumber"])
      .index("by_user", ["userId"])
      .index("by_school_status", ["schoolId", "employmentStatus"]),

    /* ---------------- Academics ---------------- */

    academicYears: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      status: v.string(), // ENTITY_STATUS
      isCurrent: v.optional(v.boolean()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_current", ["schoolId", "isCurrent"]),

    terms: defineTable({
      schoolId: v.id("schools"),
      academicYearId: v.id("academicYears"),
      name: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      status: v.string(), // ENTITY_STATUS
      isCurrent: v.optional(v.boolean()),
      displayOrder: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_academic_year", ["academicYearId"])
      .index("by_academic_year_current", ["academicYearId", "isCurrent"])
      .index("by_school_current", ["schoolId", "isCurrent"]),

    gradeLevels: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      shortName: v.optional(v.string()),
      displayOrder: v.number(),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_school_order", ["schoolId", "displayOrder"]),

    classSections: defineTable({
      schoolId: v.id("schools"),
      academicYearId: v.id("academicYears"),
      gradeLevelId: v.id("gradeLevels"),
      streamName: v.string(),
      classTeacherStaffId: v.optional(v.id("staff")),
      capacity: v.optional(v.number()),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_academic_year", ["academicYearId"])
      .index("by_grade_level", ["gradeLevelId"])
      .index("by_school_year", ["schoolId", "academicYearId"]),

    subjects: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      code: v.string(),
      shortName: v.optional(v.string()),
      subjectType: v.optional(v.string()),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_school_code", ["schoolId", "code"]),

    teacherAllocations: defineTable({
      schoolId: v.id("schools"),
      staffId: v.id("staff"),
      academicYearId: v.id("academicYears"),
      classSectionId: v.id("classSections"),
      subjectId: v.id("subjects"),
      termId: v.optional(v.id("terms")),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_staff", ["staffId"])
      .index("by_class_section", ["classSectionId"])
      .index("by_subject", ["subjectId"])
      .index("by_class_subject_year", ["classSectionId", "subjectId", "academicYearId"]),

    enrollments: defineTable({
      schoolId: v.id("schools"),
      studentId: v.id("students"),
      academicYearId: v.id("academicYears"),
      classSectionId: v.id("classSections"),
      enrollmentDate: v.string(),
      status: v.string(), // ENTITY_STATUS
      exitDate: v.optional(v.string()),
      notes: v.optional(v.string()),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"])
      .index("by_student_year", ["studentId", "academicYearId"])
      .index("by_class_section", ["classSectionId"])
      .index("by_class_year", ["classSectionId", "academicYearId"])
      .index("by_year", ["academicYearId"]),

    /* ---------------- Phase 2: Timetable ---------------- */

    timetablePeriods: defineTable({
      schoolId: v.id("schools"),
      name: v.string(), // "Period 1"
      startTime: v.string(), // "08:00"
      endTime: v.string(), // "08:40"
      periodType: v.string(), // PERIOD_TYPES
      displayOrder: v.number(),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_school_order", ["schoolId", "displayOrder"]),

    rooms: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      code: v.string(),
      capacity: v.optional(v.number()),
      roomType: v.optional(v.string()),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_school_code", ["schoolId", "code"]),

    timetableEntries: defineTable({
      schoolId: v.id("schools"),
      academicYearId: v.id("academicYears"),
      termId: v.optional(v.id("terms")),
      dayOfWeek: v.string(), // DAYS_OF_WEEK
      periodId: v.id("timetablePeriods"),
      classSectionId: v.id("classSections"),
      subjectId: v.id("subjects"),
      teacherAllocationId: v.optional(v.id("teacherAllocations")),
      staffId: v.optional(v.id("staff")),
      roomId: v.optional(v.id("rooms")),
      status: v.string(), // TIMETABLE_ENTRY_STATUS (draft | published)
      createdBy: v.optional(v.id("users")),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_year", ["schoolId", "academicYearId"])
      .index("by_class_period", ["classSectionId", "periodId"])
      .index("by_staff", ["staffId"])
      .index("by_period", ["periodId"]),

    /* ---------------- Phase 2: Attendance ---------------- */

    attendanceSessions: defineTable({
      schoolId: v.id("schools"),
      academicYearId: v.id("academicYears"),
      termId: v.id("terms"),
      classSectionId: v.id("classSections"),
      sessionType: v.string(), // ATTENDANCE_SESSION_TYPES
      subjectId: v.optional(v.id("subjects")),
      timetableEntryId: v.optional(v.id("timetableEntries")),
      staffId: v.optional(v.id("staff")),
      date: v.string(), // YYYY-MM-DD in school timezone
      status: v.string(), // ATTENDANCE_SESSION_STATUS
      recordedById: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_date", ["schoolId", "date"])
      .index("by_class_date", ["classSectionId", "date"])
      .index("by_school_term", ["schoolId", "termId"]),

    attendanceRecords: defineTable({
      schoolId: v.id("schools"),
      sessionId: v.id("attendanceSessions"),
      studentId: v.id("students"),
      enrollmentId: v.id("enrollments"),
      status: v.string(), // ATTENDANCE_STATUSES
      reason: v.optional(v.string()),
      note: v.optional(v.string()),
      recordedById: v.id("users"),
      updatedAt: v.optional(v.number()),
    })
      .index("by_session", ["sessionId"])
      .index("by_student", ["studentId"])
      .index("by_school", ["schoolId"]),

    /* ---------------- Phase 2: Assignments ---------------- */

    assignments: defineTable({
      schoolId: v.id("schools"),
      academicYearId: v.id("academicYears"),
      termId: v.id("terms"),
      classSectionId: v.id("classSections"),
      subjectId: v.id("subjects"),
      staffId: v.id("staff"),
      teacherAllocationId: v.optional(v.id("teacherAllocations")),
      assessmentId: v.optional(v.id("assessments")),
      title: v.string(),
      instructions: v.optional(v.string()),
      issueDate: v.string(),
      dueDate: v.string(),
      maxMarks: v.optional(v.number()),
      isGraded: v.optional(v.boolean()),
      status: v.string(), // ASSIGNMENT_STATUS
      attachmentId: v.optional(v.id("files")),
      createdBy: v.id("users"),
      publishedAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_term", ["schoolId", "termId"])
      .index("by_class_term", ["classSectionId", "termId"])
      .index("by_staff", ["staffId"]),

    assignmentRecipients: defineTable({
      schoolId: v.id("schools"),
      assignmentId: v.id("assignments"),
      studentId: v.id("students"),
      enrollmentId: v.id("enrollments"),
    })
      .index("by_assignment", ["assignmentId"])
      .index("by_student", ["studentId"])
      .index("by_school", ["schoolId"]),

    /* ---------------- Phase 2: Assessments & marks ---------------- */

    assessmentTypes: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      shortName: v.optional(v.string()),
      description: v.optional(v.string()),
      defaultWeight: v.optional(v.number()), // percentage 0-100
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"]),

    assessments: defineTable({
      schoolId: v.id("schools"),
      academicYearId: v.id("academicYears"),
      termId: v.id("terms"),
      classSectionId: v.id("classSections"),
      subjectId: v.id("subjects"),
      teacherAllocationId: v.optional(v.id("teacherAllocations")),
      staffId: v.optional(v.id("staff")),
      assessmentTypeId: v.id("assessmentTypes"),
      title: v.string(),
      assessmentDate: v.string(),
      maxMarks: v.number(),
      weight: v.number(), // percentage 0-100
      countsTowardFinal: v.boolean(),
      status: v.string(), // ASSESSMENT_STATUSES
      createdBy: v.id("users"),
      submittedAt: v.optional(v.number()),
      submittedById: v.optional(v.id("users")),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_term", ["schoolId", "termId"])
      .index("by_class_subject_term", ["classSectionId", "subjectId", "termId"])
      .index("by_staff", ["staffId"]),

    assessmentScores: defineTable({
      schoolId: v.id("schools"),
      assessmentId: v.id("assessments"),
      studentId: v.id("students"),
      enrollmentId: v.id("enrollments"),
      status: v.string(), // MARK_STATUSES (entered | absent | exempt)
      score: v.optional(v.number()), // present only when status === "entered"
      comment: v.optional(v.string()),
      recordedById: v.id("users"),
      updatedAt: v.optional(v.number()),
    })
      .index("by_assessment", ["assessmentId"])
      .index("by_student", ["studentId"])
      .index("by_school", ["schoolId"]),

    /* ---------------- Phase 2: Grading ---------------- */

    gradingSchemes: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      description: v.optional(v.string()),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"]),

    gradeBands: defineTable({
      schoolId: v.id("schools"),
      schemeId: v.id("gradingSchemes"),
      label: v.string(), // "A", "Exceeding Expectations"
      minPercent: v.number(),
      maxPercent: v.number(),
      descriptor: v.optional(v.string()),
      points: v.optional(v.number()),
      isPass: v.optional(v.boolean()),
      displayOrder: v.number(),
    })
      .index("by_scheme", ["schemeId"])
      .index("by_school", ["schoolId"]),

    /* ---------------- Phase 2: Results & report cards ---------------- */

    subjectResults: defineTable({
      schoolId: v.id("schools"),
      academicYearId: v.id("academicYears"),
      termId: v.id("terms"),
      classSectionId: v.id("classSections"),
      subjectId: v.id("subjects"),
      studentId: v.id("students"),
      enrollmentId: v.id("enrollments"),
      totalScore: v.number(), // raw weighted points out of 100
      percentage: v.number(),
      gradeLabel: v.optional(v.string()),
      status: v.string(), // RESULT_SUBMISSION_STATUS
      submittedById: v.optional(v.id("users")),
      approvedById: v.optional(v.id("users")),
      publishedAt: v.optional(v.number()),
      reopenedById: v.optional(v.id("users")),
      reopenReason: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    })
      .index("by_term_class", ["termId", "classSectionId"])
      .index("by_student_term", ["studentId", "termId"])
      .index("by_school", ["schoolId"]),

    reportCards: defineTable({
      schoolId: v.id("schools"),
      academicYearId: v.id("academicYears"),
      termId: v.id("terms"),
      studentId: v.id("students"),
      enrollmentId: v.id("enrollments"),
      classSectionId: v.id("classSections"),
      status: v.string(), // REPORT_CARD_STATUS
      attendance: v.optional(
        v.object({
          present: v.number(),
          absent: v.number(),
          late: v.number(),
          excused: v.number(),
          percentage: v.number(),
        }),
      ),
      overallAverage: v.optional(v.number()),
      overallGrade: v.optional(v.string()),
      rank: v.optional(v.number()),
      classSize: v.optional(v.number()),
      subjects: v.array(
        v.object({
          subjectId: v.id("subjects"),
          subjectName: v.string(),
          totalScore: v.number(),
          percentage: v.number(),
          gradeLabel: v.optional(v.string()),
          teacherComment: v.optional(v.string()),
          components: v.array(
            v.object({
              title: v.string(),
              score: v.optional(v.number()),
              maxMarks: v.number(),
              weight: v.number(),
              status: v.string(),
            }),
          ),
        }),
      ),
      classTeacherComment: v.optional(v.string()),
      principalComment: v.optional(v.string()),
      generatedById: v.optional(v.id("users")),
      generatedAt: v.optional(v.number()),
      publishedAt: v.optional(v.number()),
      snapshotVersion: v.number(),
      updatedAt: v.optional(v.number()),
    })
      .index("by_term_student", ["termId", "studentId"])
      .index("by_term_class", ["termId", "classSectionId"])
      .index("by_student", ["studentId"])
      .index("by_school", ["schoolId"]),

    /* ---------------- Phase 2: Settings & notifications ---------------- */

    schoolSettings: defineTable({
      schoolId: v.id("schools"),
      attendanceMode: v.string(), // daily | lesson | both
      schoolDays: v.array(v.string()), // DAYS_OF_WEEK subset
      editableWindowDays: v.number(), // how many past days attendance stays editable
      rankingEnabled: v.boolean(),
      reportCardShowAttendance: v.boolean(),
      reportCardShowSubjectComments: v.boolean(),
      reportCardShowRank: v.boolean(),
      reportCardSignatureLabels: v.optional(v.string()),
      reportCardFooterText: v.optional(v.string()),
      nextTermOpeningDate: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
      updatedById: v.optional(v.id("users")),
    })
      .index("by_school", ["schoolId"]),

    appNotifications: defineTable({
      schoolId: v.id("schools"),
      userId: v.id("users"),
      type: v.string(),
      title: v.string(),
      body: v.optional(v.string()),
      link: v.optional(v.string()),
      readAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_school", ["schoolId"]),

    /* ---------------- Platform / governance ---------------- */

    auditLogs: defineTable({
      schoolId: v.optional(v.id("schools")),
      userId: v.id("users"),
      action: v.string(),
      entityType: v.string(),
      entityId: v.optional(v.string()),
      description: v.optional(v.string()),
      metadata: v.optional(v.record(v.string(), v.string())),
    })
      .index("by_school", ["schoolId"])
      .index("by_user", ["userId"]),

    files: defineTable({
      schoolId: v.optional(v.id("schools")),
      uploadedById: v.optional(v.id("users")),
      filename: v.string(),
      mimeType: v.string(),
      bytes: v.optional(v.bytes()),
    }).index("by_school", ["schoolId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
