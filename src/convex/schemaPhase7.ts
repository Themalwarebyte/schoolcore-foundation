/**
 * Phase 7 table definitions — spread into the main schema (see schema.ts).
 *
 * Kept in a dedicated module because the main schema file is very large.
 * Conventions match the rest of the schema: school-scoped tables carry a
 * schoolId and are listed in session.ts's SchoolScopedTable union.
 * Platform-scoped tables (schoolRequests while pending) have no schoolId.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const phase7Tables = {
  /* ---------------- public school registration ---------------- */

  /**
   * Prospective school registration request from the public landing page.
   * Platform-scoped (no schoolId): only super admins read these.
   */
  schoolRequests: defineTable({
    schoolName: v.string(),
    registrationNumber: v.optional(v.string()),
    country: v.optional(v.string()),
    county: v.optional(v.string()),
    physicalAddress: v.optional(v.string()),
    postalAddress: v.optional(v.string()),
    schoolType: v.optional(v.string()),
    curriculum: v.optional(v.string()),
    expectedStudents: v.optional(v.number()),
    expectedTeachers: v.optional(v.number()),
    website: v.optional(v.string()),
    email: v.string(),
    phone: v.optional(v.string()),
    contactName: v.string(),
    contactPosition: v.optional(v.string()),
    contactEmail: v.string(),
    contactPhone: v.optional(v.string()),
    status: v.string(), // SCHOOL_REQUEST_STATUSES
    decisionNotes: v.optional(v.string()),
    reviewedById: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    /** Set when the request is approved and its workspace created. */
    schoolId: v.optional(v.id("schools")),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_email", ["email"])
    .index("by_school", ["schoolId"]),

  /** Public request attachments (certificate, logo, supporting docs). */
  schoolRequestDocuments: defineTable({
    requestId: v.id("schoolRequests"),
    kind: v.string(), // registration_certificate | logo | supporting
    fileId: v.id("files"),
    uploadedAt: v.number(),
  }).index("by_request", ["requestId"]),

  /* ---------------- onboarding wizard ---------------- */

  /** Per-school onboarding progress; created at approval time. */
  onboardingRecords: defineTable({
    schoolId: v.id("schools"),
    requestId: v.optional(v.id("schoolRequests")),
    profileDone: v.boolean(),
    academicsDone: v.boolean(),
    usersDone: v.boolean(),
    importDone: v.boolean(),
    activated: v.boolean(),
    activatedAt: v.optional(v.number()),
    activatedById: v.optional(v.id("users")),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_school", ["schoolId"])
    .index("by_activated", ["activated"]),

  /* ---------------- admissions ---------------- */

  applications: defineTable({
    schoolId: v.id("schools"),
    applicationNumber: v.string(),
    firstName: v.string(),
    middleName: v.optional(v.string()),
    lastName: v.string(),
    dateOfBirth: v.optional(v.string()),
    gender: v.optional(v.string()),
    previousSchool: v.optional(v.string()),
    notes: v.optional(v.string()),
    guardianName: v.string(),
    guardianPhone: v.string(),
    guardianEmail: v.optional(v.string()),
    guardianRelationship: v.optional(v.string()),
    appliedGradeLevelId: v.optional(v.id("gradeLevels")),
    status: v.string(), // APPLICATION_STATUSES
    assessmentNotes: v.optional(v.string()),
    assessmentScore: v.optional(v.number()),
    assessedById: v.optional(v.id("users")),
    assessedAt: v.optional(v.number()),
    decisionNotes: v.optional(v.string()),
    decidedById: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    studentId: v.optional(v.id("students")),
    guardianId: v.optional(v.id("guardians")),
    enrollmentId: v.optional(v.id("enrollments")),
    invoiceId: v.optional(v.id("invoices")),
    convertedAt: v.optional(v.number()),
    submittedById: v.optional(v.id("users")),
    submittedAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_school", ["schoolId"])
    .index("by_school_status", ["schoolId", "status"])
    .index("by_school_number", ["schoolId", "applicationNumber"]),

  applicationDocuments: defineTable({
    schoolId: v.id("schools"),
    applicationId: v.id("applications"),
    kind: v.string(), // birth_certificate | previous_report | photo | other
    fileId: v.id("files"),
    uploadedAt: v.number(),
  })
    .index("by_application", ["applicationId"])
    .index("by_school", ["schoolId"]),

  /* ---------------- promotion ---------------- */

  promotionRuns: defineTable({
    schoolId: v.id("schools"),
    runNumber: v.string(),
    fromAcademicYearId: v.id("academicYears"),
    toAcademicYearId: v.id("academicYears"),
    classSectionId: v.optional(v.id("classSections")),
    totalStudents: v.number(),
    promoted: v.number(),
    repeated: v.number(),
    transferred: v.number(),
    graduated: v.number(),
    status: v.string(), // draft | confirmed
    createdById: v.id("users"),
    createdAt: v.number(),
    confirmedAt: v.optional(v.number()),
  })
    .index("by_school", ["schoolId"])
    .index("by_from_year", ["fromAcademicYearId"]),

  /**
   * One row per student per run. Confirm creates NEW enrollments in the
   * target year — historical enrollments are never modified.
   */
  promotionLines: defineTable({
    schoolId: v.id("schools"),
    runId: v.id("promotionRuns"),
    studentId: v.id("students"),
    fromEnrollmentId: v.id("enrollments"),
    fromClassSectionId: v.id("classSections"),
    toClassSectionId: v.optional(v.id("classSections")),
    outcome: v.string(), // PROMOTION_OUTCOMES
    applied: v.boolean(),
    appliedEnrollmentId: v.optional(v.id("enrollments")),
  })
    .index("by_run", ["runId"])
    .index("by_student", ["studentId"])
    .index("by_school", ["schoolId"]),

  /* ---------------- fee voteheads + payment allocation ---------------- */

  /**
   * Fee voteheads: the meaning behind every fee line (Tuition, Lunch,
   * Transport…). Payments are allocated against invoice lines by votehead.
   */
  feeVoteheads: defineTable({
    schoolId: v.id("schools"),
    name: v.string(),
    code: v.string(),
    description: v.optional(v.string()),
    allocationPriority: v.number(), // lower = allocated first
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_school", ["schoolId"])
    .index("by_school_code", ["schoolId", "code"]),

  /** Links a fee item to its votehead (feeItems keep their own category). */
  feeItemVoteheads: defineTable({
    schoolId: v.id("schools"),
    feeItemId: v.id("feeItems"),
    voteheadId: v.id("feeVoteheads"),
  })
    .index("by_fee_item", ["feeItemId"])
    .index("by_school", ["schoolId"]),

  /**
   * Per-payment allocation snapshot. Remaining balance per votehead is
   * always derived: Σ invoice lines − Σ allocations, per votehead.
   */
  paymentAllocations: defineTable({
    schoolId: v.id("schools"),
    paymentId: v.id("payments"),
    invoiceId: v.id("invoices"),
    voteheadId: v.optional(v.id("feeVoteheads")),
    voteheadName: v.string(), // denormalized for reporting/audit
    amount: v.number(),
    allocatedById: v.id("users"),
    allocatedAt: v.number(),
    strategy: v.string(), // ALLOCATION_STRATEGIES
  })
    .index("by_payment", ["paymentId"])
    .index("by_invoice", ["invoiceId"])
    .index("by_school", ["schoolId"]),

  /** Per-school strategy for the payment allocation engine. */
  allocationSettings: defineTable({
    schoolId: v.id("schools"),
    strategy: v.string(), // ALLOCATION_STRATEGIES (default votehead_priority)
    updatedAt: v.number(),
    updatedById: v.id("users"),
  }).index("by_school", ["schoolId"]),

  /* ---------------- bank statement imports ---------------- */

  bankImportBatches: defineTable({
    schoolId: v.id("schools"),
    filename: v.string(),
    bankReference: v.optional(v.string()),
    statementDate: v.optional(v.string()),
    rowCount: v.number(),
    status: v.string(), // BANK_IMPORT_STATUSES
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_school", ["schoolId"])
    .index("by_status", ["status"]),

  bankImportRows: defineTable({
    schoolId: v.id("schools"),
    batchId: v.id("bankImportBatches"),
    lineNo: v.number(),
    date: v.string(),
    reference: v.string(),
    amount: v.number(),
    narration: v.optional(v.string()),
    candidateStudentId: v.optional(v.id("students")),
    candidateInvoiceId: v.optional(v.id("invoices")),
    matchBasis: v.optional(v.string()),
    duplicate: v.boolean(),
    status: v.string(), // BANK_IMPORT_STATUSES
    paymentId: v.optional(v.id("payments")),
    postedAt: v.optional(v.number()),
    postedById: v.optional(v.id("users")),
    discardReason: v.optional(v.string()),
  })
    .index("by_batch", ["batchId"])
    .index("by_school", ["schoolId"])
    .index("by_reference", ["reference"]),

  /* ---------------- meals ---------------- */

  mealPlans: defineTable({
    schoolId: v.id("schools"),
    name: v.string(),
    planType: v.string(), // MEAL_PLAN_TYPES
    description: v.optional(v.string()),
    dailyCost: v.number(),
    status: v.string(), // ENTITY_STATUS
    createdAt: v.number(),
  })
    .index("by_school", ["schoolId"])
    .index("by_school_name", ["schoolId", "name"]),

  mealEnrollments: defineTable({
    schoolId: v.id("schools"),
    planId: v.id("mealPlans"),
    studentId: v.id("students"),
    academicYearId: v.id("academicYears"),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    subsidyPercent: v.optional(v.number()),
    status: v.string(), // MEAL_ELIGIBILITY_STATUSES
    createdById: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_school", ["schoolId"])
    .index("by_plan", ["planId"])
    .index("by_student", ["studentId"])
    .index("by_school_status", ["schoolId", "status"]),

  mealConsumption: defineTable({
    schoolId: v.id("schools"),
    mealEnrollmentId: v.id("mealEnrollments"),
    studentId: v.id("students"),
    consumptionDate: v.string(),
    mealType: v.string(), // MEAL_CONSUMPTION_TYPES
    recordedViaQr: v.optional(v.boolean()),
    recordedById: v.id("users"),
    recordedAt: v.number(),
  })
    .index("by_student_date", ["studentId", "consumptionDate"])
    .index("by_enrollment", ["mealEnrollmentId"])
    .index("by_school_date", ["schoolId", "consumptionDate"]),

  /* ---------------- invitations & one-time tokens ---------------- */

  invitations: defineTable({
    schoolId: v.optional(v.id("schools")),
    email: v.string(),
    name: v.optional(v.string()),
    role: v.string(), // Role
    status: v.string(), // INVITATION_STATUSES
    invitedById: v.id("users"),
    invitedAt: v.number(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedByUserId: v.optional(v.id("users")),
  })
    .index("by_school", ["schoolId"])
    .index("by_email", ["email"])
    .index("by_status", ["status"]),

  /**
   * One-time, expiring tokens for account activation and password reset.
   * Only a token HASH is stored — the raw token never persists.
   */
  activationTokens: defineTable({
    userId: v.id("users"),
    schoolId: v.optional(v.id("schools")),
    kind: v.string(), // ACTIVATION_TOKEN_KINDS
    tokenHash: v.string(),
    status: v.string(), // ACTIVATION_TOKEN_STATUSES
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_user", ["userId"])
    .index("by_status", ["status"]),
};
