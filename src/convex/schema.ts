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
  // phase 3 — finance
  "finance.view",
  "finance.manage",
  "fees.manage",
  "billing.view",
  "billing.create",
  "payments.create",
  "payments.approve",
  "receipts.view",
  "receipts.print",
  "discounts.manage",
  "scholarships.manage",
  "expenses.create",
  "expenses.approve",
  "financial_reports.view",
  // phase 4 — portals & communication
  "portal.parent",
  "portal.student",
  "announcements.view",
  "announcements.create",
  "announcements.publish",
  "announcements.manage",
  "notifications.view",
  "profile.view",
  "profile.update",
  // phase 5 — HR & payroll
  "hr.view",
  "hr.manage",
  "employees.create",
  "employees.update",
  "contracts.manage",
  "leave.view",
  "leave.manage",
  "leave.approve",
  "payroll.view",
  "payroll.manage",
  // phase 5 — operations
  "library.view",
  "library.manage",
  "transport.view",
  "transport.manage",
  "boarding.view",
  "boarding.manage",
  "inventory.view",
  "inventory.manage",
  "procurement.view",
  "procurement.manage",
  // phase 5 — medical (sensitive)
  "medical.view",
  "medical.manage",
  // phase 6 — integrations, automation, platform
  "integrations.view",
  "integrations.manage",
  "payments_external.view",
  "payments_external.manage",
  "payments_external.reconcile",
  "communications.view",
  "communications.manage",
  "automations.view",
  "automations.manage",
  "qr.view",
  "qr.manage",
  "biometrics.view",
  "biometrics.manage",
  "gps.view",
  "gps.manage",
  "ai.view",
  "data.import",
  "data.export",
  // phase 7 — onboarding, admissions, billing depth, meals, access
  "onboarding.view",
  "onboarding.manage",
  "admissions.view",
  "admissions.manage",
  "admissions.decide",
  "promotions.manage",
  "billing.voteheads.manage",
  "payments.allocate",
  "payments.reconcile",
  "bank_imports.view",
  "bank_imports.manage",
  "meals.view",
  "meals.manage",
  "meals.consume",
  "platform.subscriptions.view",
  "platform.subscriptions.manage",
  "platform.health.view",
  "platform.impersonate",
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
    // Phase 3: finance (school admin manages the finance module)
    "finance.view", "finance.manage", "fees.manage",
    "billing.view", "billing.create",
    "payments.create", "payments.approve",
    "receipts.view", "receipts.print",
    "discounts.manage", "scholarships.manage",
    "expenses.create", "expenses.approve",
    "financial_reports.view",
    // Phase 4: portals & communication (admin provisions portal accounts)
    "announcements.view", "announcements.create", "announcements.publish", "announcements.manage",
    "notifications.view", "profile.view", "profile.update",
    // Phase 5: operations ERP — school admin manages every operational module
    "hr.view", "hr.manage",
    "employees.create", "employees.update", "contracts.manage",
    "leave.view", "leave.manage", "leave.approve",
    "payroll.view", "payroll.manage",
    "library.view", "library.manage",
    "transport.view", "transport.manage",
    "boarding.view", "boarding.manage",
    "inventory.view", "inventory.manage",
    "procurement.view", "procurement.manage",
    "medical.view", "medical.manage",
    // Phase 6: integrations, automation, comms, ids, data ops
    "integrations.view", "integrations.manage",
    "payments_external.view", "payments_external.manage", "payments_external.reconcile",
    "communications.view", "communications.manage",
    "automations.view", "automations.manage",
    "qr.view", "qr.manage",
    "biometrics.view", "biometrics.manage",
    "gps.view", "gps.manage",
    "ai.view",
    "data.import", "data.export",
    // Phase 7: school admin runs onboarding, admissions, billing depth
    "onboarding.view", "onboarding.manage",
    "admissions.view", "admissions.manage", "admissions.decide",
    "promotions.manage",
    "billing.voteheads.manage",
    "payments.allocate", "payments.reconcile",
    "bank_imports.view", "bank_imports.manage",
    "meals.view", "meals.manage",
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
    // Phase 3: finance summaries + approval authorities (no billing/cashiering)
    "finance.view", "billing.view", "receipts.view", "financial_reports.view",
    "discounts.manage", "scholarships.manage", "expenses.approve",
    // Phase 4: communication
    "announcements.view", "announcements.create", "announcements.publish",
    "notifications.view", "profile.view",
    // Phase 5: oversight of operations (no payroll figures, no medical detail)
    "hr.view", "leave.view", "leave.approve",
    "library.view", "transport.view", "boarding.view", "inventory.view", "procurement.view",
    // Phase 6: principal oversight
    "integrations.view", "communications.view", "automations.view", "ai.view", "payments_external.view",
    // Phase 7: principal reviews admissions (recommends), views onboarding/meals
    "admissions.view", "admissions.decide",
    "onboarding.view",
    "meals.view", "meals.manage",
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
    // Phase 4: teacher communication — teachers may post announcements to
    // the classes they are allocated to (enforced in the create handler).
    "announcements.view", "announcements.create",
    // Phase 5: teachers can browse the library catalogue only.
    // Deliberately NO hr/payroll/medical access (sensitive).
    "library.view",
    // Phase 6: teacher-scoped AI insights (phase6/ai.teacherInsights). The
    // school-wide AI view is role-gated inside the query — teachers only ever
    // see their own allocations' aggregates, never payroll/medical data.
    "ai.view",
  ],
  accountant: [
    "dashboard.view",
    "school.view",
    "students.view",
    "guardians.view",
    "staff.view",
    "academics.view",
    "settings.view",
    // Phase 3: finance — the accountant/bursar is the primary finance user
    "finance.view", "fees.manage",
    "billing.view", "billing.create",
    "payments.create", "payments.approve",
    "receipts.view", "receipts.print",
    "discounts.manage", "scholarships.manage",
    "expenses.create",
    "financial_reports.view",
    // Phase 5: payroll is run by the bursar's office; procurement & stock too
    "payroll.view", "payroll.manage",
    "procurement.view", "procurement.manage",
    "inventory.view", "inventory.manage",
    // Phase 6: bursar runs external payments reconciliation
    "payments_external.view", "payments_external.manage", "payments_external.reconcile",
    "communications.view",
    // Phase 7: bursar owns votehead billing, allocation & reconciliation
    "billing.voteheads.manage",
    "payments.allocate", "payments.reconcile",
    "bank_imports.view", "bank_imports.manage",
    "data.export",
  ],
  parent: [
    "dashboard.view", "school.view",
    // Phase 4: parent portal — access ONLY via portal.* scoped queries that
    // verify the child link server-side. Deliberately NO generic
    // attendance/results/finance permissions: those endpoints are
    // school-wide and would leak other students' data within the school.
    "portal.parent", "notifications.view", "profile.view", "profile.update",
    "announcements.view",
    // Phase 6: GPS transport view — the query itself resolves ONLY the
    // vehicles serving the caller's own children (identity.parentTransportView).
    "gps.view",
    // Phase 7: parents see their own children's meal plan eligibility only.
    "meals.view",
  ],
  student: [
    "dashboard.view", "school.view",
    // Phase 4: student portal — own records only, via portal.* queries.
    "portal.student", "notifications.view", "profile.view",
    "announcements.view",
  ],
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

/* Phase 3 enums — finance */
export const FEE_CATEGORIES = [
  "Tuition", "Boarding", "Transport", "Meals", "Activity", "Examination", "Uniform", "Other",
] as const;
export const INVOICE_STATUSES = [
  "draft", "issued", "partially_paid", "paid", "overdue", "cancelled",
] as const;
export const LEDGER_ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export const LEDGER_ENTRY_DIRECTIONS = ["debit", "credit"] as const;
export const LEDGER_TRANSACTION_TYPES = [
  "invoice", "payment", "discount", "refund", "expense", "adjustment",
] as const;
export const PAYMENT_METHODS = [
  "cash", "bank_transfer", "mobile_money", "card", "cheque",
] as const;
export const PAYMENT_STATUSES = ["pending", "confirmed", "reversed"] as const;
export const DISCOUNT_TYPES = ["percentage", "amount"] as const;
export const DISCOUNT_STATUSES = ["pending", "approved", "rejected", "applied", "cancelled"] as const;
export const SCHOLARSHIP_TYPES = ["percentage", "amount"] as const;
export const SCHOLARSHIP_STATUSES = ["active", "ended", "cancelled"] as const;
export const REFUND_STATUSES = ["requested", "approved", "paid", "rejected", "cancelled"] as const;
export const EXPENSE_STATUSES = ["draft", "submitted", "approved", "rejected", "paid"] as const;

/* Phase 4: portals & communication */
export const ANNOUNCEMENT_AUDIENCES = ["all", "parents", "students", "teachers", "class", "grade"] as const;
export const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"] as const;
export const PORTAL_LINK_STATUSES = ["active", "revoked"] as const;
export const STATEMENT_ENTRY_TYPES = [
  "invoice", "payment", "discount", "refund", "adjustment",
] as const;

/* Phase 5 enums — HR */
export const CONTRACT_TYPES = ["probation", "fixed_term", "permanent", "internship", "casual"] as const;
export const CONTRACT_STATUSES = ["draft", "active", "expired", "terminated"] as const;
export const STAFF_DOCUMENT_TYPES = ["certificate", "identification", "contract", "qualification", "other"] as const;
export const LEAVE_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

/* Phase 5 enums — payroll */
export const PAYROLL_COMPONENT_TYPES = ["earning", "deduction"] as const;
export const PAYROLL_COMPONENT_CALC = ["fixed_amount", "percentage_of_basic"] as const;
export const PAYROLL_RUN_STATUSES = ["draft", "review", "approved", "paid"] as const;

/* Phase 5 enums — library */
export const LOAN_STATUSES = ["issued", "returned", "overdue", "lost"] as const;
export const COPY_STATUSES = ["available", "issued", "lost", "retired"] as const;

/* Phase 5 enums — transport */
export const VEHICLE_STATUSES = ["active", "maintenance", "retired"] as const;
export const DRIVER_STATUSES = ["active", "inactive"] as const;
export const TRANSPORT_DIRECTIONS = ["pickup", "dropoff", "both"] as const;
export const TRANSPORT_ASSIGNMENT_STATUSES = ["active", "ended"] as const;

/* Phase 5 enums — boarding */
export const BED_STATUSES = ["free", "occupied", "maintenance"] as const;
export const BOARDING_ALLOCATION_STATUSES = ["active", "ended"] as const;

/* Phase 5 enums — inventory */
export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "retired"] as const;
export const STOCK_MOVEMENT_TYPES = ["received", "issued", "adjustment", "return"] as const;

/* Phase 5 enums — procurement */
export const PURCHASE_REQUEST_STATUSES = ["draft", "submitted", "approved", "rejected", "ordered", "received", "cancelled"] as const;
export const PURCHASE_ORDER_STATUSES = ["draft", "submitted", "approved", "received", "cancelled"] as const;

/* Phase 5 enums — medical */
export const VISIT_DISPOSITIONS = ["sent_home", "sent_to_hospital", "returned_to_class", "referred", "other"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"] as const;

/* Phase 7 enums — onboarding, admissions, billing depth, meals */
export const SCHOOL_REQUEST_STATUSES = [
  "submitted", "under_review", "approved", "rejected", "onboarding", "active",
] as const;
export const SCHOOL_REQUEST_DECISIONS = [
  "approve", "reject", "more_info",
] as const;
export const ONBOARDING_STEPS = [
  "profile", "academics", "users", "import", "activate",
] as const;
export const APPLICATION_STATUSES = [
  "submitted", "under_review", "assessment", "accepted", "rejected", "waitlisted", "enrolled", "withdrawn",
] as const;
export const PROMOTION_OUTCOMES = [
  "promoted", "repeated", "transferred", "graduated",
] as const;
export const ALLOCATION_STRATEGIES = [
  "votehead_priority", "oldest_first", "manual",
] as const;
export const ALLOCATION_STATUSES = ["allocated", "partially_allocated", "unallocated"] as const;
export const BANK_IMPORT_STATUSES = ["draft", "matched", "posted", "discarded"] as const;
export const MEAL_PLAN_TYPES = ["lunch", "milk", "snack", "full_board"] as const;
export const MEAL_CONSUMPTION_TYPES = ["lunch", "milk", "snack"] as const;
export const MEAL_ELIGIBILITY_STATUSES = ["active", "suspended", "ended"] as const;
export const INVITATION_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;
export const ACTIVATION_TOKEN_KINDS = ["invitation", "activation", "password_reset"] as const;
export const ACTIVATION_TOKEN_STATUSES = ["pending", "used", "expired", "revoked"] as const;

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

    /* ---------------- Phase 4: Portals & communication ---------------- */

    /**
     * School announcements. Audience is one of ANNOUNCEMENT_AUDIENCES;
     * class/grade audiences store the target id. Portals and staff filter
     * by audience — records themselves are never duplicated per recipient.
     */
    announcements: defineTable({
      schoolId: v.id("schools"),
      title: v.string(),
      message: v.string(),
      audience: v.string(), // ANNOUNCEMENT_AUDIENCES
      classSectionId: v.optional(v.id("classSections")),
      gradeLevelId: v.optional(v.id("gradeLevels")),
      status: v.string(), // ANNOUNCEMENT_STATUSES
      publishDate: v.optional(v.string()),
      expiryDate: v.optional(v.string()),
      createdById: v.id("users"),
      publishedAt: v.optional(v.number()),
      archivedAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_status", ["schoolId", "status"])
      .index("by_class", ["classSectionId"])
      .index("by_grade", ["gradeLevelId"]),

    /** Controlled link: guardian record ↔ user account (parent role). */
    guardianPortalLinks: defineTable({
      schoolId: v.id("schools"),
      guardianId: v.id("guardians"),
      userId: v.id("users"),
      invitedById: v.id("users"),
      invitedAt: v.number(),
      status: v.string(), // PORTAL_LINK_STATUSES
    })
      .index("by_guardian", ["guardianId"])
      .index("by_user", ["userId"])
      .index("by_school", ["schoolId"]),

    /** Controlled link: student record ↔ user account (student role). */
    studentPortalLinks: defineTable({
      schoolId: v.id("schools"),
      studentId: v.id("students"),
      userId: v.id("users"),
      invitedById: v.id("users"),
      invitedAt: v.number(),
      status: v.string(), // PORTAL_LINK_STATUSES
    })
      .index("by_student", ["studentId"])
      .index("by_user", ["userId"])
      .index("by_school", ["schoolId"]),

    /* ---------------- Phase 3: Finance foundation ---------------- */

    /** School-configurable fee categories (no hardcoded categories). */
    feeCategories: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_school_name", ["schoolId", "name"]),

    /** Configurable payment methods — future gateways attach here by key. */
    paymentMethods: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      /** Stable key for future integrations (mpesa, stripe, bank_api, …). */
      integrationKey: v.optional(v.string()),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_school_name", ["schoolId", "name"]),

    /** Chart of accounts foundation. */
    ledgerAccounts: defineTable({
      schoolId: v.id("schools"),
      code: v.string(),
      name: v.string(),
      accountType: v.string(), // LEDGER_ACCOUNT_TYPES
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_school_code", ["schoolId", "code"]),

    /**
     * Fee structure: a named group of fee items for a term scoped by class.
     * `applicableGradeLevelIds` empty = all classes.
     */
    feeStructures: defineTable({
      schoolId: v.id("schools"),
      academicYearId: v.id("academicYears"),
      termId: v.id("terms"),
      name: v.string(),
      applicableGradeLevelIds: v.array(v.id("gradeLevels")),
      status: v.string(), // ENTITY_STATUS
      createdBy: v.optional(v.id("users")),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_term", ["termId"])
      .index("by_school_year", ["schoolId", "academicYearId"]),

    feeItems: defineTable({
      schoolId: v.id("schools"),
      feeStructureId: v.id("feeStructures"),
      name: v.string(),
      category: v.string(), // free-form; seeded defaults, school-editable
      amount: v.number(), // major units (whole currency)
      mandatory: v.boolean(),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_structure", ["feeStructureId"])
      .index("by_school", ["schoolId"]),

    /** One per student per school. Balance is always derived from the ledger. */
    studentAccounts: defineTable({
      schoolId: v.id("schools"),
      studentId: v.id("students"),
      /** Manual snapshot ONLY for reporting/sorting convenience — never authoritative. */
      openingBalance: v.number(),
      status: v.string(), // ENTITY_STATUS
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"])
      .index("by_school_student", ["schoolId", "studentId"]),

    invoices: defineTable({
      schoolId: v.id("schools"),
      invoiceNumber: v.string(),
      studentId: v.id("students"),
      accountId: v.id("studentAccounts"),
      academicYearId: v.id("academicYears"),
      termId: v.id("terms"),
      issueDate: v.string(),
      dueDate: v.string(),
      totalAmount: v.number(),
      status: v.string(), // INVOICE_STATUSES
      notes: v.optional(v.string()),
      createdById: v.id("users"),
      issuedAt: v.optional(v.number()),
      cancelledAt: v.optional(v.number()),
      cancelReason: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_number", ["schoolId", "invoiceNumber"])
      .index("by_student", ["studentId"])
      .index("by_term", ["termId"])
      .index("by_school_status", ["schoolId", "status"]),

    invoiceItems: defineTable({
      schoolId: v.id("schools"),
      invoiceId: v.id("invoices"),
      description: v.string(),
      category: v.string(),
      quantity: v.number(),
      amount: v.number(), // unit amount
      /** Immutable snapshot of the fee item name at billing time (§28). */
      sourceFeeItemId: v.optional(v.id("feeItems")),
    })
      .index("by_invoice", ["invoiceId"])
      .index("by_school", ["schoolId"]),

    /**
     * Double-entry-inspired ledger: every financial event posts balanced
     * debit/credit entries to accounts (student receivable, revenue, cash…).
     * Entries are immutable — corrections post new reversing entries.
     */
    ledgerTransactions: defineTable({
      schoolId: v.id("schools"),
      transactionType: v.string(), // LEDGER_TRANSACTION_TYPES
      transactionNumber: v.string(), // human reference e.g. PAY-2026-00012
      date: v.string(), // YYYY-MM-DD
      amount: v.number(), // total transaction value (positive)
      description: v.optional(v.string()),
      studentId: v.optional(v.id("students")),
      accountId: v.optional(v.id("studentAccounts")),
      invoiceId: v.optional(v.id("invoices")),
      paymentId: v.optional(v.id("payments")),
      discountId: v.optional(v.id("discounts")),
      refundId: v.optional(v.id("refunds")),
      expenseId: v.optional(v.id("expenses")),
      createdById: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"])
      .index("by_account", ["accountId"])
      .index("by_school_date", ["schoolId", "date"])
      .index("by_invoice", ["invoiceId"]),

    ledgerEntries: defineTable({
      schoolId: v.id("schools"),
      transactionId: v.id("ledgerTransactions"),
      accountId: v.id("ledgerAccounts"),
      direction: v.string(), // LEDGER_ENTRY_DIRECTIONS
      amount: v.number(),
    })
      .index("by_transaction", ["transactionId"])
      .index("by_account", ["accountId"])
      .index("by_school", ["schoolId"]),

    payments: defineTable({
      schoolId: v.id("schools"),
      paymentNumber: v.string(),
      studentId: v.id("students"),
      accountId: v.id("studentAccounts"),
      invoiceId: v.optional(v.id("invoices")),
      amount: v.number(),
      paymentDate: v.string(),
      method: v.string(), // PAYMENT_METHODS (name of configured method row)
      referenceNumber: v.optional(v.string()),
      notes: v.optional(v.string()),
      receivedById: v.id("users"),
      status: v.string(), // PAYMENT_STATUSES
      confirmedAt: v.optional(v.number()),
      reversedAt: v.optional(v.number()),
      reversedById: v.optional(v.id("users")),
      reverseReason: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_number", ["schoolId", "paymentNumber"])
      .index("by_student", ["studentId"])
      .index("by_invoice", ["invoiceId"])
      .index("by_school_date", ["schoolId", "paymentDate"]),

    receipts: defineTable({
      schoolId: v.id("schools"),
      receiptNumber: v.string(),
      paymentId: v.id("payments"),
      studentId: v.id("students"),
      accountId: v.id("studentAccounts"),
      amount: v.number(),
      balanceAfter: v.number(),
      method: v.string(),
      paymentDate: v.string(),
      issuedById: v.id("users"),
      issuedAt: v.number(),
      voidedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_number", ["schoolId", "receiptNumber"])
      .index("by_payment", ["paymentId"])
      .index("by_student", ["studentId"]),

    discounts: defineTable({
      schoolId: v.id("schools"),
      discountNumber: v.string(),
      studentId: v.id("students"),
      accountId: v.id("studentAccounts"),
      invoiceId: v.optional(v.id("invoices")),
      name: v.string(), // "Sibling discount", "Staff child", custom…
      discountType: v.string(), // DISCOUNT_TYPES
      value: v.number(), // percent (0-100) or amount
      computedAmount: v.number(), // resolved currency amount at approval time
      reason: v.optional(v.string()),
      status: v.string(), // DISCOUNT_STATUSES
      requestedById: v.id("users"),
      approvedById: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      appliedTransactionId: v.optional(v.id("ledgerTransactions")),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"])
      .index("by_invoice", ["invoiceId"]),

    scholarships: defineTable({
      schoolId: v.id("schools"),
      studentId: v.id("students"),
      accountId: v.id("studentAccounts"),
      name: v.string(),
      scholarshipType: v.string(), // SCHOLARSHIP_TYPES
      value: v.number(),
      reason: v.optional(v.string()),
      academicYearId: v.id("academicYears"),
      termId: v.optional(v.id("terms")),
      status: v.string(), // SCHOLARSHIP_STATUSES
      approvedById: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"]),

    refunds: defineTable({
      schoolId: v.id("schools"),
      refundNumber: v.string(),
      studentId: v.id("students"),
      accountId: v.id("studentAccounts"),
      paymentId: v.optional(v.id("payments")),
      amount: v.number(),
      reason: v.optional(v.string()),
      status: v.string(), // REFUND_STATUSES
      requestedById: v.id("users"),
      approvedById: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      paidTransactionId: v.optional(v.id("ledgerTransactions")),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"]),

    expenses: defineTable({
      schoolId: v.id("schools"),
      expenseNumber: v.string(),
      category: v.string(),
      payee: v.string(),
      amount: v.number(),
      expenseDate: v.string(),
      description: v.optional(v.string()),
      attachmentId: v.optional(v.id("files")),
      status: v.string(), // EXPENSE_STATUSES
      createdById: v.id("users"),
      submittedAt: v.optional(v.number()),
      approvedById: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      rejectionReason: v.optional(v.string()),
      paidTransactionId: v.optional(v.id("ledgerTransactions")),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_status", ["schoolId", "status"])
      .index("by_school_date", ["schoolId", "expenseDate"]),

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

    /* ---------------- Phase 5 — HR & departments ---------------- */

    /* ---------------- Phase 6 — observability ---------------- */

    /**
     * Structured backend/integration/delivery failure events plus reported
     * frontend errors. Platform-level diagnostics — schoolId optional so
     * anonymous crashes still surface.
     */
    observabilityEvents: defineTable({
      schoolId: v.optional(v.id("schools")),
      severity: v.string(), // info | warning | error | critical
      component: v.string(),
      message: v.string(),
      details: v.optional(v.any()),
      createdAt: v.number(),
    }).index("by_time", ["createdAt"]),

    departments: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      description: v.optional(v.string()),
      headStaffId: v.optional(v.id("staff")),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"]),

    /**
     * HR profile extending the existing Staff record (staff._id is the
     * identity anchor — no duplicate person records).
     */
    employees: defineTable({
      schoolId: v.id("schools"),
      staffId: v.id("staff"),
      departmentId: v.optional(v.id("departments")),
      jobTitle: v.optional(v.string()),
      hireDate: v.optional(v.string()), // YYYY-MM-DD
      supervisorStaffId: v.optional(v.id("staff")),
      qualifications: v.optional(v.string()),
      emergencyContactName: v.optional(v.string()),
      emergencyContactPhone: v.optional(v.string()),
      emergencyContactRelationship: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: v.string(), // ENTITY_STATUS
      updatedAt: v.optional(v.number()),
      updatedById: v.optional(v.id("users")),
    })
      .index("by_school", ["schoolId"])
      .index("by_staff", ["staffId"])
      .index("by_department", ["departmentId"]),

    contracts: defineTable({
      schoolId: v.id("schools"),
      employeeId: v.id("employees"),
      staffId: v.id("staff"), // denormalized identity anchor for quick scoping
      contractNumber: v.string(),
      contractType: v.string(), // CONTRACT_TYPES
      startDate: v.string(), // YYYY-MM-DD
      endDate: v.optional(v.string()),
      salaryStructureId: v.optional(v.id("salaryStructures")),
      documentId: v.optional(v.id("files")),
      status: v.string(), // CONTRACT_STATUSES
      createdById: v.id("users"),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_employee", ["employeeId"])
      .index("by_staff", ["staffId"])
      .index("by_school_status", ["schoolId", "status"]),

    staffDocuments: defineTable({
      schoolId: v.id("schools"),
      staffId: v.id("staff"),
      employeeId: v.optional(v.id("employees")),
      documentType: v.string(), // STAFF_DOCUMENT_TYPES
      title: v.string(),
      fileId: v.optional(v.id("files")),
      expiryDate: v.optional(v.string()),
      uploadedById: v.id("users"),
      uploadedAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_staff", ["staffId"])
      .index("by_employee", ["employeeId"]),

    leaveTypes: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      annualDays: v.number(),
      paid: v.boolean(),
      requiresApproval: v.boolean(),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"]),

    leaveRequests: defineTable({
      schoolId: v.id("schools"),
      staffId: v.id("staff"),
      employeeId: v.optional(v.id("employees")),
      leaveTypeId: v.id("leaveTypes"),
      startDate: v.string(),
      endDate: v.string(),
      days: v.number(),
      reason: v.optional(v.string()),
      status: v.string(), // LEAVE_REQUEST_STATUSES
      requestedById: v.id("users"),
      decidedById: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      decisionNote: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_staff", ["staffId"])
      .index("by_school_status", ["schoolId", "status"]),

    /* ---------------- Phase 5 — payroll ---------------- */

    salaryStructures: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      basicSalary: v.number(),
      status: v.string(), // ENTITY_STATUS
      createdById: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_school", ["schoolId"]),

    salaryComponents: defineTable({
      schoolId: v.id("schools"),
      salaryStructureId: v.id("salaryStructures"),
      componentType: v.string(), // PAYROLL_COMPONENT_TYPES (earning | deduction)
      name: v.string(),
      calculation: v.string(), // PAYROLL_COMPONENT_CALC
      amount: v.number(), // fixed amount, or percentage value when percentage_of_basic
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_structure", ["salaryStructureId"]),

    payrollRuns: defineTable({
      schoolId: v.id("schools"),
      runNumber: v.string(),
      periodLabel: v.string(), // e.g. "September 2026"
      periodYear: v.number(),
      periodMonth: v.number(), // 1-12
      totalGross: v.number(),
      totalDeductions: v.number(),
      totalNet: v.number(),
      employeeCount: v.number(),
      status: v.string(), // PAYROLL_RUN_STATUSES
      createdById: v.id("users"),
      approvedById: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      paidTransactionId: v.optional(v.id("ledgerTransactions")),
      paidAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_status", ["schoolId", "status"]),

    payslips: defineTable({
      schoolId: v.id("schools"),
      payrollRunId: v.id("payrollRuns"),
      staffId: v.id("staff"),
      employeeId: v.id("employees"),
      basicSalary: v.number(),
      grossPay: v.number(),
      totalDeductions: v.number(),
      netPay: v.number(),
      lines: v.array(
        v.object({
          name: v.string(),
          componentType: v.string(),
          amount: v.number(),
        }),
      ),
      salaryStructureId: v.optional(v.id("salaryStructures")),
      contractId: v.optional(v.id("contracts")),
      generatedAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_run", ["payrollRunId"])
      .index("by_staff", ["staffId"]),

    /* ---------------- Phase 5 — library ---------------- */

    libraryCategories: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"]),

    books: defineTable({
      schoolId: v.id("schools"),
      title: v.string(),
      author: v.optional(v.string()),
      isbn: v.optional(v.string()),
      categoryId: v.optional(v.id("libraryCategories")),
      publisher: v.optional(v.string()),
      location: v.optional(v.string()),
      totalCopies: v.number(),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_category", ["categoryId"]),

    bookCopies: defineTable({
      schoolId: v.id("schools"),
      bookId: v.id("books"),
      copyNumber: v.string(),
      status: v.string(), // COPY_STATUSES
    })
      .index("by_school", ["schoolId"])
      .index("by_book", ["bookId"]),

    bookLoans: defineTable({
      schoolId: v.id("schools"),
      bookId: v.id("books"),
      bookCopyId: v.id("bookCopies"),
      borrowerStaffId: v.optional(v.id("staff")),
      borrowerStudentId: v.optional(v.id("students")),
      issuedById: v.id("users"),
      issueDate: v.string(),
      dueDate: v.string(),
      returnedAt: v.optional(v.number()),
      returnDate: v.optional(v.string()),
      fineAmount: v.number(),
      fineWaived: v.optional(v.boolean()),
      status: v.string(), // LOAN_STATUSES
    })
      .index("by_school", ["schoolId"])
      .index("by_copy", ["bookCopyId"])
      .index("by_student", ["borrowerStudentId"])
      .index("by_staff", ["borrowerStaffId"])
      .index("by_school_status", ["schoolId", "status"]),

    /* ---------------- Phase 5 — transport ---------------- */

    vehicles: defineTable({
      schoolId: v.id("schools"),
      registrationNumber: v.string(),
      vehicleType: v.optional(v.string()),
      capacity: v.number(),
      driverId: v.optional(v.id("drivers")),
      status: v.string(), // VEHICLE_STATUSES
    })
      .index("by_school", ["schoolId"]),

    drivers: defineTable({
      schoolId: v.id("schools"),
      staffId: v.optional(v.id("staff")), // set when the driver is school staff
      fullName: v.string(),
      phone: v.optional(v.string()),
      licenseNumber: v.optional(v.string()),
      licenseExpiry: v.optional(v.string()),
      isExternal: v.boolean(),
      status: v.string(), // DRIVER_STATUSES
    })
      .index("by_school", ["schoolId"])
      .index("by_staff", ["staffId"]),

    transportRoutes: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      vehicleId: v.optional(v.id("vehicles")),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"]),

    routeStops: defineTable({
      schoolId: v.id("schools"),
      routeId: v.id("transportRoutes"),
      stopName: v.string(),
      pickupTime: v.string(),
      displayOrder: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_route", ["routeId"]),

    transportAssignments: defineTable({
      schoolId: v.id("schools"),
      studentId: v.id("students"),
      routeId: v.id("transportRoutes"),
      stopId: v.optional(v.id("routeStops")),
      vehicleId: v.optional(v.id("vehicles")),
      direction: v.string(), // TRANSPORT_DIRECTIONS
      academicYearId: v.optional(v.id("academicYears")),
      status: v.string(), // TRANSPORT_ASSIGNMENT_STATUSES
      assignedById: v.optional(v.id("users")),
      assignedAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"])
      .index("by_route", ["routeId"]),

    /* ---------------- Phase 5 — boarding ---------------- */

    hostels: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      gender: v.optional(v.string()), // GENDERS
      wardenStaffId: v.optional(v.id("staff")),
      capacity: v.optional(v.number()),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"]),

    hostelRooms: defineTable({
      schoolId: v.id("schools"),
      hostelId: v.id("hostels"),
      roomNumber: v.string(),
      capacity: v.number(),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"])
      .index("by_hostel", ["hostelId"]),

    beds: defineTable({
      schoolId: v.id("schools"),
      roomId: v.id("hostelRooms"),
      bedNumber: v.string(),
      status: v.string(), // BED_STATUSES
    })
      .index("by_school", ["schoolId"])
      .index("by_room", ["roomId"]),

    boardingAllocations: defineTable({
      schoolId: v.id("schools"),
      studentId: v.id("students"),
      hostelId: v.id("hostels"),
      roomId: v.id("hostelRooms"),
      bedId: v.id("beds"),
      academicYearId: v.optional(v.id("academicYears")),
      startDate: v.string(),
      endDate: v.optional(v.string()),
      status: v.string(), // BOARDING_ALLOCATION_STATUSES
      allocatedById: v.optional(v.id("users")),
      createdAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"])
      .index("by_bed", ["bedId"])
      .index("by_room", ["roomId"]),

    /* ---------------- Phase 5 — inventory & assets ---------------- */

    assets: defineTable({
      schoolId: v.id("schools"),
      assetNumber: v.string(),
      name: v.string(),
      category: v.string(),
      purchaseDate: v.optional(v.string()),
      purchaseValue: v.optional(v.number()),
      location: v.optional(v.string()),
      condition: v.string(), // ASSET_CONDITIONS
      custodianStaffId: v.optional(v.id("staff")),
      notes: v.optional(v.string()),
      status: v.string(), // ENTITY_STATUS
      createdById: v.id("users"),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_number", ["schoolId", "assetNumber"]),

    inventoryItems: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      category: v.string(),
      unit: v.string(),
      quantity: v.number(),
      reorderLevel: v.number(),
      unitCost: v.optional(v.number()),
      status: v.string(), // ENTITY_STATUS
      createdById: v.id("users"),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"]),

    stockMovements: defineTable({
      schoolId: v.id("schools"),
      itemId: v.id("inventoryItems"),
      movementType: v.string(), // STOCK_MOVEMENT_TYPES
      quantity: v.number(), // always positive; direction from movementType
      balanceAfter: v.number(),
      reference: v.optional(v.string()),
      issuedToStaffId: v.optional(v.id("staff")),
      notes: v.optional(v.string()),
      createdById: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_item", ["itemId"]),

    /* ---------------- Phase 5 — procurement ---------------- */

    suppliers: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      contactPerson: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      category: v.optional(v.string()),
      address: v.optional(v.string()),
      status: v.string(), // ENTITY_STATUS
    })
      .index("by_school", ["schoolId"]),

    purchaseRequests: defineTable({
      schoolId: v.id("schools"),
      requestNumber: v.string(),
      supplierId: v.optional(v.id("suppliers")),
      departmentId: v.optional(v.id("departments")),
      requestedById: v.id("users"),
      neededBy: v.optional(v.string()),
      justification: v.optional(v.string()),
      estimatedTotal: v.number(),
      status: v.string(), // PURCHASE_REQUEST_STATUSES
      decidedById: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      decisionNote: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_status", ["schoolId", "status"]),

    purchaseRequestItems: defineTable({
      schoolId: v.id("schools"),
      purchaseRequestId: v.id("purchaseRequests"),
      description: v.string(),
      quantity: v.number(),
      unitCost: v.number(),
    })
      .index("by_request", ["purchaseRequestId"])
      .index("by_school", ["schoolId"]),

    purchaseOrders: defineTable({
      schoolId: v.id("schools"),
      orderNumber: v.string(),
      purchaseRequestId: v.id("purchaseRequests"),
      supplierId: v.optional(v.id("suppliers")),
      total: v.number(),
      orderDate: v.string(),
      status: v.string(), // PURCHASE_ORDER_STATUSES
      receivedAt: v.optional(v.number()),
      createdById: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_request", ["purchaseRequestId"]),

    /* ---------------- Phase 5 — clinic / medical (sensitive) ---------------- */

    medicalProfiles: defineTable({
      schoolId: v.id("schools"),
      studentId: v.id("students"),
      bloodGroup: v.optional(v.string()), // BLOOD_GROUPS
      allergies: v.array(v.string()),
      conditions: v.array(v.string()),
      emergencyNotes: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
      updatedById: v.optional(v.id("users")),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"]),

    clinicVisits: defineTable({
      schoolId: v.id("schools"),
      studentId: v.id("students"),
      visitDate: v.string(),
      complaint: v.string(),
      assessment: v.optional(v.string()),
      treatment: v.optional(v.string()),
      provider: v.optional(v.string()),
      disposition: v.optional(v.string()), // VISIT_DISPOSITIONS
      notes: v.optional(v.string()),
      recordedById: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"]),

    files: defineTable({
      schoolId: v.optional(v.id("schools")),
      uploadedById: v.optional(v.id("users")),
      filename: v.string(),
      mimeType: v.string(),
      bytes: v.optional(v.bytes()),
    }).index("by_school", ["schoolId"]),

/* ==================================================================== */
/* Phase 6 — integrations, external payments, communication, QR,        */
/* biometrics, GPS, automation, SaaS, feature flags, data import        */
/* ==================================================================== */

    /* ---------------- integration configuration ---------------- */

    /**
     * Per-school provider configuration. Secrets are NEVER stored here —
     * only safe, non-secret metadata and enabled flags. Actual credentials
     * live in server environment variables only.
     */
    integrations: defineTable({
      schoolId: v.id("schools"),
      kind: v.string(), // payments | sms | email | whatsapp | gps
      provider: v.string(), // mpesa_daraja | none | ...
      environment: v.string(), // sandbox | production | not_configured
      enabled: v.boolean(),
      /** Non-secret display metadata (e.g. masked shortcode "1234***"). */
      displayMetadata: v.optional(v.record(v.string(), v.string())),
      configuredById: v.optional(v.id("users")),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_kind", ["schoolId", "kind"]),

    /* ---------------- external payments (M-Pesa) ---------------- */

    /** Parent-initiated STK push / payment request. Pending until verified. */
    paymentRequests: defineTable({
      schoolId: v.id("schools"),
      studentId: v.id("students"),
      invoiceId: v.optional(v.id("invoices")),
      amount: v.number(),
      account: v.string(),
      phone: v.string(),
      status: v.string(), // PAYMENT_REQUEST_STATUSES
      provider: v.string(),
      providerRequestId: v.optional(v.string()),
      providerRef: v.optional(v.string()),
      failureReason: v.optional(v.string()),
      initiatedById: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_student", ["studentId"])
      .index("by_provider_ref", ["providerRef"])
      .index("by_school_status", ["schoolId", "status"]),

    /**
     * Raw provider transactions received via callback — the reconciliation
     * source of truth between the provider and SchoolCore payments.
     */
    providerTransactions: defineTable({
      schoolId: v.optional(v.id("schools")),
      account: v.string(),
      providerTxnId: v.string(),
      providerRequestId: v.optional(v.string()),
      amount: v.number(),
      phone: v.optional(v.string()),
      status: v.string(),
      resultDesc: v.optional(v.string()),
      matchedPaymentId: v.optional(v.id("payments")),
      matchedById: v.optional(v.id("users")),
      matchedAt: v.optional(v.number()),
      receivedAt: v.number(),
    })
      .index("by_provider_txn", ["providerTxnId"])
      .index("by_school", ["schoolId"])
      .index("by_account", ["account"])
      .index("by_school_status", ["schoolId", "status"]),

    /* ---------------- communication platform ---------------- */

    smsTemplates: defineTable({
      schoolId: v.id("schools"),
      event: v.string(),
      name: v.string(),
      body: v.string(),
      enabled: v.boolean(),
      updatedAt: v.optional(v.number()),
      updatedById: v.optional(v.id("users")),
    })
      .index("by_school_event", ["schoolId", "event"]),

    emailTemplates: defineTable({
      schoolId: v.id("schools"),
      event: v.string(),
      name: v.string(),
      subject: v.string(),
      html: v.optional(v.string()),
      text: v.optional(v.string()),
      enabled: v.boolean(),
      updatedAt: v.optional(v.number()),
      updatedById: v.optional(v.id("users")),
    })
      .index("by_school_event", ["schoolId", "event"]),

    /** Every outbound message (queued or sent) across channels. */
    commMessages: defineTable({
      schoolId: v.id("schools"),
      channel: v.string(), // in_app | sms | email | whatsapp
      event: v.string(),
      templateId: v.optional(v.string()),
      recipientKind: v.string(), // parent | student | staff | custom
      recipientUserId: v.optional(v.id("users")),
      recipientAddress: v.optional(v.string()),
      studentId: v.optional(v.id("students")),
      body: v.string(),
      status: v.string(), // COMM_STATUSES
      providerMessageId: v.optional(v.string()),
      failureReason: v.optional(v.string()),
      attempts: v.number(),
      queuedAt: v.number(),
      sentAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_school_status", ["schoolId", "status"])
      .index("by_recipient", ["recipientUserId"])
      .index("by_status", ["status"]),

    /** Per-user channel preferences. */
    commPreferences: defineTable({
      schoolId: v.id("schools"),
      userId: v.id("users"),
      inApp: v.boolean(),
      sms: v.boolean(),
      email: v.boolean(),
      whatsapp: v.optional(v.boolean()),
      updatedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_school", ["schoolId"]),

    /** Bulk communication jobs (batched, idempotent sends). */
    commJobs: defineTable({
      schoolId: v.id("schools"),
      channel: v.string(),
      event: v.string(),
      audience: v.string(),
      audienceId: v.optional(v.string()),
      body: v.string(),
      totalCount: v.number(),
      sentCount: v.number(),
      failedCount: v.number(),
      status: v.string(),
      createdById: v.id("users"),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_status", ["status"]),

    /* ---------------- QR identity ---------------- */

    /**
     * Opaque QR tokens for students and staff. Tokens carry NO personal
     * data; they resolve server-side to a permitted identity view only.
     */
    qrTokens: defineTable({
      schoolId: v.id("schools"),
      subjectKind: v.string(), // student | staff
      subjectId: v.id("students"),
      token: v.string(),
      active: v.boolean(),
      issuedById: v.id("users"),
      issuedAt: v.number(),
      revokedAt: v.optional(v.number()),
    })
      .index("by_token", ["token"])
      .index("by_subject", ["subjectId"])
      .index("by_school", ["schoolId"]),

    /* ---------------- biometric attendance foundation ---------------- */

    /**
     * Biometric device enrollment references. No biometric data is stored —
     * only the device's own identifier for a subject.
     */
    biometricEnrollments: defineTable({
      schoolId: v.id("schools"),
      subjectKind: v.string(), // student | staff
      subjectId: v.id("students"),
      deviceId: v.string(),
      deviceSubjectRef: v.string(),
      status: v.string(), // active | revoked
      enrolledById: v.id("users"),
      enrolledAt: v.number(),
      revokedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_device_ref", ["deviceId", "deviceSubjectRef"])
      .index("by_subject", ["subjectId"]),

    /** Registered biometric devices (per school, optional). */
    biometricDevices: defineTable({
      schoolId: v.id("schools"),
      deviceId: v.string(),
      label: v.string(),
      location: v.optional(v.string()),
      secretRef: v.string(),
      status: v.string(), // active | disabled
      lastSeenAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_device", ["deviceId"])
      .index("by_school", ["schoolId"]),

    /** Staging table for verified device attendance events before dedup. */
    deviceEvents: defineTable({
      schoolId: v.id("schools"),
      deviceId: v.string(),
      deviceSubjectRef: v.string(),
      eventType: v.string(), // attendance_in | attendance_out
      eventAt: v.number(),
      processed: v.boolean(),
      processedAttendanceId: v.optional(v.id("attendanceRecords")),
      duplicate: v.optional(v.boolean()),
      receivedAt: v.number(),
    })
      .index("by_school", ["schoolId"])
      .index("by_device", ["deviceId"])
      .index("by_processed", ["processed"]),

    /* ---------------- transport GPS ---------------- */

    /** GPS devices attached to existing Phase 5 vehicles. */
    gpsDevices: defineTable({
      schoolId: v.id("schools"),
      vehicleId: v.id("vehicles"),
      deviceId: v.string(),
      provider: v.string(),
      status: v.string(), // active | disabled
      secretRef: v.string(),
      lastSeenAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_device", ["deviceId"])
      .index("by_school", ["schoolId"])
      .index("by_vehicle", ["vehicleId"]),

    /** Recent location pings. Retention enforced by a scheduled job. */
    gpsPings: defineTable({
      schoolId: v.id("schools"),
      gpsDeviceId: v.id("gpsDevices"),
      vehicleId: v.id("vehicles"),
      lat: v.number(),
      lng: v.number(),
      speedKph: v.optional(v.number()),
      heading: v.optional(v.number()),
      recordedAt: v.number(),
      receivedAt: v.number(),
    })
      .index("by_vehicle_time", ["vehicleId", "recordedAt"])
      .index("by_school", ["schoolId"])
      .index("by_recorded", ["recordedAt"]),

    /* ---------------- automation engine ---------------- */

    automations: defineTable({
      schoolId: v.id("schools"),
      name: v.string(),
      trigger: v.string(),
      condition: v.optional(
        v.object({
          field: v.string(),
          op: v.string(), // gt | lt | eq
          value: v.string(),
        }),
      ),
      actions: v.array(
        v.object({
          type: v.string(), // in_app | sms | email | task | admin_alert
          payload: v.optional(v.string()),
        }),
      ),
      enabled: v.boolean(),
      createdById: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school_trigger", ["schoolId", "trigger"])
      .index("by_school", ["schoolId"]),

    automationRuns: defineTable({
      schoolId: v.id("schools"),
      automationId: v.id("automations"),
      trigger: v.string(),
      targetKind: v.string(),
      targetId: v.optional(v.string()),
      actionsAttempted: v.number(),
      actionsSucceeded: v.number(),
      status: v.string(), // success | partial | failed
      detail: v.optional(v.string()),
      ranAt: v.number(),
    })
      .index("by_automation", ["automationId"])
      .index("by_school", ["schoolId"])
      .index("by_ran_at", ["ranAt"]),

    /* ---------------- SaaS subscriptions ---------------- */

    plans: defineTable({
      name: v.string(),
      slug: v.string(),
      description: v.optional(v.string()),
      monthlyPrice: v.number(),
      currency: v.string(),
      /** Entitlements: maxStudents, sms, gps, ai, advancedAnalytics... */
      entitlements: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
      displayOrder: v.number(),
      active: v.boolean(),
      createdAt: v.number(),
    }).index("by_slug", ["slug"]),

    schoolSubscriptions: defineTable({
      schoolId: v.id("schools"),
      planId: v.id("plans"),
      status: v.string(), // SUBSCRIPTION_STATUSES
      trialEndsAt: v.optional(v.number()),
      currentPeriodEnd: v.optional(v.number()),
      startedAt: v.number(),
      cancelledAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_status", ["status"]),

    subscriptionInvoices: defineTable({
      schoolId: v.id("schools"),
      subscriptionId: v.id("schoolSubscriptions"),
      invoiceNumber: v.string(),
      amount: v.number(),
      currency: v.string(),
      periodStart: v.string(),
      periodEnd: v.string(),
      status: v.string(), // paid | open | void
      createdAt: v.number(),
      paidAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_subscription", ["subscriptionId"]),

    /** Per-school/platform feature flags (platform > plan > school). */
    featureFlags: defineTable({
      /** Undefined = platform-level flag. */
      schoolId: v.optional(v.id("schools")),
      key: v.string(),
      enabled: v.boolean(),
      note: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
      updatedById: v.optional(v.id("users")),
    })
      .index("by_key", ["key"])
      .index("by_school_key", ["schoolId", "key"]),

    /* ---------------- data import jobs ---------------- */

    importJobs: defineTable({
      schoolId: v.id("schools"),
      kind: v.string(), // students | guardians | staff
      filename: v.string(),
      status: v.string(), // draft | validated | imported | failed
      columnMap: v.record(v.string(), v.string()),
      rowsTotal: v.number(),
      rowsValid: v.number(),
      rowsInvalid: v.number(),
      errors: v.array(v.object({ row: v.number(), field: v.string(), message: v.string() })),
      stagedRows: v.array(v.record(v.string(), v.string())),
      dedupeStrategy: v.string(), // skip | update
      createdById: v.id("users"),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_school", ["schoolId"])
      .index("by_status", ["status"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
