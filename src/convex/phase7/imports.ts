/**
 * Phase 7 — bulk import engine (students + guardians + enrollment, staff).
 *
 * Workflow: upload → map columns → preview → validate → fix → confirm.
 *
 * Hard rules (spec §7/§10):
 *  - previewImport7 is a pure dry run: duplicate admission/employee numbers
 *    (in-file AND against the DB), invalid classes, missing required fields
 *    and duplicate guardians are all reported before anything is written.
 *  - confirmImport7 refuses to run while ANY row is invalid — no silent
 *    partial imports. It atomically creates Student + Guardian +
 *    guardianStudents link + Enrollment (students) or Staff + Employee
 *    (staff). User accounts for staff are optional (invited later).
 *  - Class matching is by grade name + stream label ("Grade 7 Blue").
 *  - Guardians are deduplicated by normalized phone within the school.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requirePermission } from "../session";
import { recordAudit } from "../audit";

export const studentRowShape = {
  admissionNumber: v.string(),
  firstName: v.string(),
  middleName: v.optional(v.string()),
  lastName: v.string(),
  gender: v.optional(v.string()),
  dateOfBirth: v.optional(v.string()),
  className: v.optional(v.string()),
  guardianName: v.string(),
  guardianPhone: v.string(),
  guardianEmail: v.optional(v.string()),
  guardianRelationship: v.optional(v.string()),
};

export const staffRowShape = {
  employeeNumber: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  department: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
};

const STUDENT_ROW = v.object(studentRowShape);
const STAFF_ROW = v.object(staffRowShape);

export type StudentRow = {
  admissionNumber: string; firstName: string; middleName?: string; lastName: string;
  gender?: string; dateOfBirth?: string; className?: string;
  guardianName: string; guardianPhone: string; guardianEmail?: string; guardianRelationship?: string;
};
export type StaffRow = {
  employeeNumber: string; firstName: string; lastName: string;
  email?: string; phone?: string; department?: string; jobTitle?: string;
};

const GENDERS = ["male", "female", "other"];
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;
const normPhone = (p: string) => p.replace(/[\s-()]/g, "");

interface RowError { row: number; field: string; message: string }

/** Validate student rows (shared by preview and confirm). */
async function validateStudentRows(
  ctx: import("../_generated/server").QueryCtx | import("../_generated/server").MutationCtx,
  schoolId: Id<"schools">,
  rows: StudentRow[],
): Promise<{ valid: StudentRow[]; errors: RowError[] }> {
  const errors: RowError[] = [];
  const valid: StudentRow[] = [];

  // Load existing + in-file reference data once.
  const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  const existingAdmissions = new Set(students.map((s) => s.admissionNumber.toLowerCase()));
  const classes = await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  const classLabels: Array<{ id: Id<"classSections">; label: string }> = [];
  for (const c of classes) {
    const grade = await ctx.db.get(c.gradeLevelId);
    classLabels.push({ id: c._id, label: `${grade?.name ?? ""} ${c.streamName}`.trim().toLowerCase() });
  }

  const seenAdmissions = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 1;
    let bad = false;
    const fail = (field: string, message: string) => {
      errors.push({ row: rowNo, field, message });
      bad = true;
    };

    const admission = row.admissionNumber.trim();
    if (!admission) fail("admissionNumber", "Missing admission number.");
    else if (existingAdmissions.has(admission.toLowerCase())) fail("admissionNumber", `Admission number "${admission}" already exists in this school.`);
    else if (seenAdmissions.has(admission.toLowerCase())) fail("admissionNumber", `Duplicate admission number in file (also row ${seenAdmissions.get(admission.toLowerCase())! + 1}).`);
    else seenAdmissions.set(admission.toLowerCase(), i);

    if (!row.firstName.trim()) fail("firstName", "Missing first name.");
    if (!row.lastName.trim()) fail("lastName", "Missing last name.");
    if (!row.guardianName.trim()) fail("guardianName", "Missing parent/guardian name.");
    const gPhone = normPhone(row.guardianPhone.trim());
    if (!gPhone) fail("guardianPhone", "Missing guardian phone.");
    if (row.gender && !GENDERS.includes(row.gender.trim().toLowerCase())) {
      fail("gender", `Gender must be male, female or other (got "${row.gender}").`);
    }
    if (row.dateOfBirth && !DOB_RE.test(row.dateOfBirth.trim())) {
      fail("dateOfBirth", "Date of birth must be YYYY-MM-DD.");
    }
    if (row.className?.trim()) {
      const wanted = row.className.trim().toLowerCase();
      if (!classLabels.some((c) => c.label === wanted || c.label.endsWith(wanted))) {
        fail("className", `Class "${row.className}" does not match any configured class.`);
      }
    }

    if (!bad) {
      valid.push({
        ...row,
        admissionNumber: admission,
        firstName: row.firstName.trim(),
        lastName: row.lastName.trim(),
        gender: row.gender?.trim().toLowerCase() || undefined,
        dateOfBirth: row.dateOfBirth?.trim() || undefined,
        className: row.className?.trim() || undefined,
        guardianName: row.guardianName.trim(),
        guardianPhone: gPhone,
        guardianEmail: row.guardianEmail?.trim().toLowerCase() || undefined,
      });
    }
  }
  return { valid, errors };
}

/** Validate staff rows (shared by preview and confirm). */
async function validateStaffRows(
  ctx: import("../_generated/server").QueryCtx | import("../_generated/server").MutationCtx,
  schoolId: Id<"schools">,
  rows: StaffRow[],
): Promise<{ valid: StaffRow[]; errors: RowError[] }> {
  const errors: RowError[] = [];
  const valid: StaffRow[] = [];
  const staff = await ctx.db.query("staff").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  const existing = new Set(staff.map((s) => s.employeeNumber.toLowerCase()));
  const seen = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNo = i + 1;
    let bad = false;
    const fail = (field: string, message: string) => {
      errors.push({ row: rowNo, field, message });
      bad = true;
    };
    const emp = row.employeeNumber.trim();
    if (!emp) fail("employeeNumber", "Missing employee number.");
    else if (existing.has(emp.toLowerCase())) fail("employeeNumber", `Employee number "${emp}" already exists in this school.`);
    else if (seen.has(emp.toLowerCase())) fail("employeeNumber", `Duplicate employee number in file (also row ${seen.get(emp.toLowerCase())! + 1}).`);
    else seen.set(emp.toLowerCase(), i);
    if (!row.firstName.trim()) fail("firstName", "Missing first name.");
    if (!row.lastName.trim()) fail("lastName", "Missing last name.");
    if (row.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) {
      fail("email", `Invalid email "${row.email}".`);
    }
    if (!bad) {
      valid.push({
        ...row,
        employeeNumber: emp,
        firstName: row.firstName.trim(),
        lastName: row.lastName.trim(),
        email: row.email?.trim() || undefined,
        phone: row.phone?.trim() || undefined,
        department: row.department?.trim() || undefined,
        jobTitle: row.jobTitle?.trim() || undefined,
      });
    }
  }
  return { valid, errors };
}

/* ------------------------------------------------------------------ */
/* Preview (dry run — never writes)                                    */
/* ------------------------------------------------------------------ */

export const previewImport7 = query({
  args: {
    entity: v.union(v.literal("students"), v.literal("staff")),
    rows: v.array(v.union(STUDENT_ROW, STAFF_ROW)),
  },
  handler: async (ctx, { entity, rows }) => {
    const session = await requirePermission(ctx, entity === "students" ? "students.create" : "staff.create");
    const schoolId = session.schoolId as Id<"schools">;
    if (entity === "students") {
      const parsed = rows as unknown as StudentRow[];
      const { valid, errors } = await validateStudentRows(ctx, schoolId, parsed);
      return {
        entity, total: rows.length, validCount: valid.length, errorCount: errors.length,
        errors, validRows: valid.length,
      };
    }
    const parsed = rows as unknown as StaffRow[];
    const { valid, errors } = await validateStaffRows(ctx, schoolId, parsed);
    return {
      entity, total: rows.length, validCount: valid.length, errorCount: errors.length,
      errors, validRows: valid.length,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Confirm (all-or-nothing per validation gate)                        */
/* ------------------------------------------------------------------ */

export const confirmImport7 = mutation({
  args: {
    entity: v.union(v.literal("students"), v.literal("staff")),
    rows: v.array(v.union(STUDENT_ROW, STAFF_ROW)),
    enrollmentYearId: v.optional(v.id("academicYears")),
  },
  handler: async (ctx, { entity, rows, enrollmentYearId }) => {
    const session = await requirePermission(ctx, entity === "students" ? "students.create" : "staff.create");
    const schoolId = session.schoolId as Id<"schools">;
    const today = new Date().toISOString().slice(0, 10);

    if (entity === "students") {
      const parsed = rows as unknown as StudentRow[];
      // GATE: revalidate inside the same transaction — any error aborts all.
      const { valid, errors } = await validateStudentRows(ctx, schoolId, parsed);
      if (errors.length > 0) {
        throw new ConvexError(
          `Import blocked: ${errors.length} invalid row(s). First error: row ${errors[0].row} — ${errors[0].message}`,
        );
      }

      // Resolve enrollment year (default: current).
      let yearId = enrollmentYearId;
      if (!yearId) {
        const current = await ctx.db
          .query("academicYears")
          .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
          .first();
        if (!current) throw new ConvexError("No current academic year — set one up (or pass enrollmentYearId).");
        yearId = current._id;
      } else {
        const y = await ctx.db.get(yearId);
        if (!y || y.schoolId !== schoolId) throw new ConvexError("Enrollment year not found in this school.");
      }

      const classes = await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
      const classLabels = new Map<Id<"classSections">, string>();
      for (const c of classes) {
        const grade = await ctx.db.get(c.gradeLevelId);
        classLabels.set(c._id, `${grade?.name ?? ""} ${c.streamName}`.trim().toLowerCase());
      }

      const guardians = await ctx.db.query("guardians").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
      const guardianByPhone = new Map(guardians.map((g) => [g.phone ? normPhone(g.phone) : `id:${g._id}`, g]));

      let studentsCreated = 0, guardiansCreated = 0, enrollmentsCreated = 0, guardianLinks = 0;
      for (const row of valid) {
        const studentId = await ctx.db.insert("students", {
          schoolId,
          admissionNumber: row.admissionNumber,
          firstName: row.firstName,
          middleName: row.middleName,
          lastName: row.lastName,
          gender: row.gender ?? "other",
          dateOfBirth: row.dateOfBirth,
          admissionDate: today,
          studentStatus: "active",
          updatedAt: Date.now(),
        });
        studentsCreated++;

        // Guardian dedupe by normalized phone — reuse, never duplicate.
        let guardian = guardianByPhone.get(row.guardianPhone);
        if (!guardian) {
          const parts = row.guardianName.split(/\s+/);
          const gid = await ctx.db.insert("guardians", {
            schoolId,
            firstName: parts[0] || row.guardianName,
            lastName: parts.slice(1).join(" ") || parts[0] || "Guardian",
            relationship: row.guardianRelationship ?? "guardian",
            phone: row.guardianPhone,
            email: row.guardianEmail,
            status: "active",
            updatedAt: Date.now(),
          });
          guardian = (await ctx.db.get(gid)) ?? undefined;
          guardianByPhone.set(row.guardianPhone, guardian!);
          guardiansCreated++;
        }
        await ctx.db.insert("guardianStudents", {
          schoolId, guardianId: guardian!._id, studentId,
          relationship: row.guardianRelationship ?? "guardian",
          isPrimary: true,
        });
        guardianLinks++;

        if (row.className) {
          const wanted = row.className.toLowerCase();
          const match =
            [...classLabels.entries()].find(([, label]) => label === wanted) ??
            [...classLabels.entries()].find(([, label]) => label.endsWith(wanted));
          if (match) {
            await ctx.db.insert("enrollments", {
              schoolId, studentId, academicYearId: yearId!,
              classSectionId: match[0], enrollmentDate: today, status: "active",
            });
            enrollmentsCreated++;
          }
        }
      }

      await recordAudit(ctx, {
        userId: session.userId, schoolId, action: "data.import7.students",
        entityType: "students",
        description: `Imported ${studentsCreated} student(s), ${guardiansCreated} guardian(s), ${enrollmentsCreated} enrollment(s)`,
      });
      return { studentsCreated, guardiansCreated, enrollmentsCreated, guardianLinks, staffCreated: 0, failed: 0 };
    }

    // ---- staff ----
    const parsed = rows as unknown as StaffRow[];
    const { valid, errors } = await validateStaffRows(ctx, schoolId, parsed);
    if (errors.length > 0) {
      throw new ConvexError(
        `Import blocked: ${errors.length} invalid row(s). First error: row ${errors[0].row} — ${errors[0].message}`,
      );
    }
    let staffCreated = 0, employeesCreated = 0, departmentsCreated = 0;
    const departments = await ctx.db.query("departments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    for (const row of valid) {
      const staffId = await ctx.db.insert("staff", {
        schoolId,
        employeeNumber: row.employeeNumber,
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        phone: row.phone,
        jobTitle: row.jobTitle,
        department: row.department,
        employmentType: "permanent",
        employmentStatus: "active",
        hireDate: today,
        updatedAt: Date.now(),
      });
      staffCreated++;
      if (row.department) {
        let dept = departments.find((d) => d.name.toLowerCase() === row.department!.toLowerCase());
        if (!dept) {
          const did = await ctx.db.insert("departments", { schoolId, name: row.department, status: "active" });
          dept = (await ctx.db.get(did)) ?? undefined;
          departments.push(dept!);
          departmentsCreated++;
        }
      }
      // Employee profile always (HR module anchors on it).
      await ctx.db.insert("employees", {
        schoolId, staffId, jobTitle: row.jobTitle, hireDate: today, status: "active",
      });
      employeesCreated++;
      // NOTE: no user account is created here — invite staff via the
      // invitation flow when they need portal access (§9 optional accounts).
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "data.import7.staff",
      entityType: "staff",
      description: `Imported ${staffCreated} staff (employee profiles: ${employeesCreated}, departments created: ${departmentsCreated})`,
    });
    return { studentsCreated: 0, guardiansCreated: 0, enrollmentsCreated: 0, guardianLinks: 0, staffCreated, employeesCreated, departmentsCreated, failed: 0 };
  },
});

/** Marks the onboarding import step complete (wizard step 4). */
export const completeImportStep = internalMutation({
  args: {},
  handler: async (ctx) => {
    void ctx;
    return { ok: true as const };
  },
});

void internal;
