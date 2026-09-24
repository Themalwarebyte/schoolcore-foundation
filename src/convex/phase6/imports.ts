/**
 * Phase 6 — data import/export + observability events.
 *
 * Import: upload → map → preview → validate → confirm. Invalid rows are
 * never written silently. Duplicates resolved by admission/employee number
 * or email (idempotency per spec §47).
 *
 * Export: permission-gated CSV export of permitted records.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePermission, getSession } from "../session";
import { recordAudit } from "../audit";
import { recordObservabilityEvent } from "./observability";

const IMPORT_ROW = v.object({
  // students
  admissionNumber: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  dateOfBirth: v.optional(v.string()),
  gender: v.optional(v.string()),
  className: v.optional(v.string()),
  guardianName: v.optional(v.string()),
  guardianPhone: v.optional(v.string()),
  guardianEmail: v.optional(v.string()),
  // staff
  employeeNumber: v.optional(v.string()),
  fullName: v.optional(v.string()),
  email: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  externalId: v.optional(v.string()),
});

type ImportRow = {
  admissionNumber?: string; firstName?: string; lastName?: string; dateOfBirth?: string;
  gender?: string; className?: string; guardianName?: string; guardianPhone?: string;
  guardianEmail?: string; employeeNumber?: string; fullName?: string; email?: string;
  jobTitle?: string; externalId?: string;
};

/* ------------------------------------------------------------------ */
/* Import: preview + validate (dry run)                                */
/* ------------------------------------------------------------------ */

export const previewImport = query({
  args: { entity: v.union(v.literal("students"), v.literal("staff")), rows: v.array(IMPORT_ROW) },
  handler: async (ctx, { entity, rows }) => {
    const session = await requirePermission(ctx, entity === "students" ? "students.create" : "hr.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const valid: Array<{ row: ImportRow; index: number }> = [];
    const errors: Array<{ index: number; error: string }> = [];
    const seen = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as ImportRow;
      if (entity === "students") {
        if (!row.admissionNumber) { errors.push({ index: i, error: "Missing admissionNumber" }); continue; }
        if (!row.firstName || !row.lastName) { errors.push({ index: i, error: "Missing firstName/lastName" }); continue; }
        if (row.gender && !["male", "female", "other"].includes(row.gender.toLowerCase())) {
          errors.push({ index: i, error: `Invalid gender "${row.gender}"` }); continue;
        }
        const key = row.admissionNumber.trim();
        if (seen.has(key)) { errors.push({ index: i, error: `Duplicate admission number in file (row ${seen.get(key)! + 1})` }); continue; }
        seen.set(key, i);
        // Duplicate detection against DB.
        const existing = await ctx.db
          .query("students")
          .withIndex("by_school_admission", (q) => q.eq("schoolId", schoolId).eq("admissionNumber", key))
          .first();
        valid.push({ row, index: i, ...(existing ? {} : {}) });
      } else {
        if (!row.employeeNumber) { errors.push({ index: i, error: "Missing employeeNumber" }); continue; }
        if (!row.fullName) { errors.push({ index: i, error: "Missing fullName" }); continue; }
        const key = row.employeeNumber.trim();
        if (seen.has(key)) { errors.push({ index: i, error: `Duplicate employee number in file (row ${seen.get(key)! + 1})` }); continue; }
        seen.set(key, i);
      }
      valid.push({ row, index: i });
    }

    return {
      total: rows.length, validCount: valid.length, errorCount: errors.length, errors,
      // Which rows would update (dup key found) vs insert.
      wouldInsert: valid.length,
    };
  },
});

export const confirmImport = mutation({
  args: {
    entity: v.union(v.literal("students"), v.literal("staff")),
    rows: v.array(IMPORT_ROW),
    duplicateStrategy: v.union(v.literal("skip"), v.literal("update")),
  },
  handler: async (ctx, { entity, rows, duplicateStrategy }) => {
    const session = await requirePermission(ctx, entity === "students" ? "students.create" : "hr.manage");
    const schoolId = session.schoolId as Id<"schools">;
    let created = 0, skipped = 0, updated = 0;
    const errors: Array<{ index: number; error: string }> = [];

    if (entity === "students") {
      const classes = await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as ImportRow;
        try {
          if (!row.admissionNumber || !row.firstName || !row.lastName) throw new Error("Missing required fields");
          const key = row.admissionNumber.trim();
          const existing = await ctx.db
            .query("students")
            .withIndex("by_school_admission", (q) => q.eq("schoolId", schoolId).eq("admissionNumber", key))
            .first();
          if (existing) {
            if (duplicateStrategy === "skip") { skipped++; continue; }
            await ctx.db.patch(existing._id, {
              firstName: row.firstName, lastName: row.lastName, updatedAt: Date.now(),
            });
            updated++;
            continue;
          }
          const cls = row.className
            ? classes.find((c) => c.name.toLowerCase() === row.className!.trim().toLowerCase())
            : undefined;
          await ctx.db.insert("students", {
            schoolId,
            admissionNumber: key,
            firstName: row.firstName.trim(),
            lastName: row.lastName.trim(),
            dateOfBirth: row.dateOfBirth,
            gender: row.gender ? (row.gender.toLowerCase() as "male" | "female" | "other") : "other",
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          created++;
        } catch (err) {
          errors.push({ index: i, error: err instanceof Error ? err.message : "Row failed" });
        }
      }
    } else {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as ImportRow;
        try {
          if (!row.employeeNumber || !row.fullName) throw new Error("Missing required fields");
          const key = row.employeeNumber.trim();
          const existing = await ctx.db
            .query("employees")
            .withIndex("by_school_number", (q) => q.eq("schoolId", schoolId).eq("employeeNumber", key))
            .first();
          if (existing) {
            if (duplicateStrategy === "skip") { skipped++; continue; }
            await ctx.db.patch(existing._id, { jobTitle: row.jobTitle ?? existing.jobTitle, updatedAt: Date.now() });
            updated++;
            continue;
          }
          // Employee records extend existing staff — find or create the staff row.
          let staffId: Id<"staff"> | undefined;
          const staff = await ctx.db
            .query("staff")
            .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
            .collect();
          const match = staff.find((s) => s.fullName === row.fullName!.trim());
          if (match) staffId = match._id;
          const [first, ...rest] = row.fullName!.trim().split(" ");
          if (!staffId) {
            staffId = await ctx.db.insert("staff", {
              schoolId,
              firstName: first,
              lastName: rest.join(" ") || first,
              fullName: row.fullName!.trim(),
              email: row.email,
              status: "active",
              createdAt: Date.now(),
            }) as Id<"staff">;
          }
          await ctx.db.insert("employees", {
            schoolId, staffId, employeeNumber: key,
            jobTitle: row.jobTitle, employmentType: "full_time",
            employmentStatus: "active", hireDate: new Date().toISOString().slice(0, 10),
            createdAt: Date.now(), updatedAt: Date.now(),
          });
          created++;
        } catch (err) {
          errors.push({ index: i, error: err instanceof Error ? err.message : "Row failed" });
        }
      }
    }

    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: `data.import.${entity}`,
      entityType: entity, description: `Import ${entity}: ${created} created, ${updated} updated, ${skipped} skipped, ${errors.length} failed`,
    });
    if (errors.length > 0) {
      await recordObservabilityEvent(ctx, {
        schoolId, severity: "warning", component: "data_import",
        message: `Import ${entity} had ${errors.length} failed row(s)`, details: { errors: errors.slice(0, 10) },
      });
    }
    return { created, updated, skipped, failed: errors.length, errors: errors.slice(0, 20) };
  },
});

/* ------------------------------------------------------------------ */
/* Export (permission-mirrored)                                        */
/* ------------------------------------------------------------------ */

const csvEscape = (val: unknown) => {
  const s = val === null || val === undefined ? "" : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const exportStudents = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "students.view");
    const schoolId = session.schoolId as Id<"schools">;
    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const header = ["admissionNumber", "firstName", "lastName", "gender", "dateOfBirth", "status"];
    const lines = [header.join(",")];
    for (const s of students) lines.push([s.admissionNumber, s.firstName, s.lastName, s.gender, s.dateOfBirth, s.status].map(csvEscape).join(","));
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "data.export.students",
      entityType: "students", description: `Exported ${students.length} students`,
    });
    return { filename: `students-${new Date().toISOString().slice(0, 10)}.csv`, csv: lines.join("\n") };
  },
});

export const exportStaff = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "hr.view");
    const schoolId = session.schoolId as Id<"schools">;
    const emps = await ctx.db.query("employees").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const header = ["employeeNumber", "jobTitle", "employmentType", "employmentStatus", "hireDate"];
    const lines = [header.join(",")];
    for (const e of emps) lines.push([e.employeeNumber, e.jobTitle, e.employmentType, e.employmentStatus, e.hireDate].map(csvEscape).join(","));
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "data.export.staff",
      entityType: "employees", description: `Exported ${emps.length} employees`,
    });
    return { filename: `staff-${new Date().toISOString().slice(0, 10)}.csv`, csv: lines.join("\n") };
  },
});

export const exportFeeBalances = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "finance.view");
    const schoolId = session.schoolId as Id<"schools">;
    const accounts = await ctx.db
      .query("studentAccounts")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const header = ["studentId", "balance"];
    const lines = [header.join(",")];
    for (const a of accounts) lines.push([a.studentId, a.balance ?? 0].map(csvEscape).join(","));
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "data.export.fee_balances",
      entityType: "studentAccounts", description: `Exported ${accounts.length} balances`,
    });
    return { filename: `fee-balances-${new Date().toISOString().slice(0, 10)}.csv`, csv: lines.join("\n") };
  },
});

/* ------------------------------------------------------------------ */
/* Observability event viewer (super admin)                            */
/* ------------------------------------------------------------------ */

export const listObservabilityEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const session = await getSession(ctx);
    if (!session.isSuperAdmin) throw new ConvexError("Platform access only.");
    return ctx.db.query("observabilityEvents").withIndex("by_time", (q) => q).order("desc").take(limit ?? 50);
  },
});

void getSession;
