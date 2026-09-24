import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

/* ================================================================== */
/* Medical profiles — SENSITIVE. medical.view to read (access audited),*/
/* medical.manage to write. Teachers have neither.                     */
/* ================================================================== */

export const getMedicalProfile = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "medical.view");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    // Read-access auditing for medical data happens via the auditMedicalAccess
    // mutation (queries cannot write); the UI calls it when a profile is opened.
    const profile = await ctx.db
      .query("medicalProfiles")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .first();
    return {
      student: {
        name: `${student.firstName} ${student.lastName}`,
        admissionNumber: student.admissionNumber,
        gender: student.gender ?? null,
        dateOfBirth: student.dateOfBirth ?? null,
      },
      profile: profile
        ? {
            bloodGroup: profile.bloodGroup ?? null,
            allergies: profile.allergies,
            conditions: profile.conditions,
            emergencyNotes: profile.emergencyNotes ?? null,
            updatedAt: profile.updatedAt ?? null,
          }
        : null,
    };
  },
});

/** Audit a medical record access (called by the UI on open). */
export const auditMedicalAccess = mutation({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "medical.view");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "medical.profile.viewed",
      entityType: "medicalProfiles", entityId: studentId,
      description: `Medical profile viewed for ${student.firstName} ${student.lastName} (${student.admissionNumber})`,
    });
    return true;
  },
});

export const upsertMedicalProfile = mutation({
  args: {
    studentId: v.id("students"),
    bloodGroup: v.optional(v.string()),
    allergies: v.optional(v.array(v.string())),
    conditions: v.optional(v.array(v.string())),
    emergencyNotes: v.optional(v.string()),
  },
  handler: async (ctx, { studentId, bloodGroup, allergies, conditions, emergencyNotes }) => {
    const session = await requirePermission(ctx, "medical.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    const existing = await ctx.db
      .query("medicalProfiles")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .first();
    const patch = {
      bloodGroup,
      allergies: allergies ?? existing?.allergies ?? [],
      conditions: conditions ?? existing?.conditions ?? [],
      emergencyNotes: emergencyNotes?.trim(),
      updatedAt: Date.now(),
      updatedById: session.userId,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("medicalProfiles", { schoolId, studentId, ...patch });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "medical.profile.updated",
      entityType: "medicalProfiles", entityId: studentId,
      description: `Medical profile updated for ${student.firstName} ${student.lastName} (${student.admissionNumber})`,
    });
    return studentId;
  },
});

/* ================================================================== */
/* Clinic visits                                                       */
/* ================================================================== */

export const listVisits = query({
  args: { studentId: v.optional(v.id("students")), limit: v.optional(v.number()) },
  handler: async (ctx, { studentId, limit }) => {
    const session = await requirePermission(ctx, "medical.view");
    const schoolId = session.schoolId as Id<"schools">;
    let visits = await ctx.db
      .query("clinicVisits")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (studentId) visits = visits.filter((v2) => v2.studentId === studentId);
    visits.sort((a, b) => b.createdAt - a.createdAt);
    if (limit && visits.length > limit) visits = visits.slice(0, limit);
    const out = await Promise.all(
      visits.map(async (v2) => {
        const student = await ctx.db.get(v2.studentId);
        return {
          _id: v2._id,
          studentId: v2.studentId,
          studentName: student ? `${student.firstName} ${student.lastName}` : "—",
          admissionNumber: student?.admissionNumber ?? "—",
          visitDate: v2.visitDate,
          complaint: v2.complaint,
          assessment: v2.assessment ?? null,
          treatment: v2.treatment ?? null,
          provider: v2.provider ?? null,
          disposition: v2.disposition ?? null,
          notes: v2.notes ?? null,
        };
      }),
    );
    return out;
  },
});

export const recordVisit = mutation({
  args: {
    studentId: v.id("students"),
    visitDate: v.string(),
    complaint: v.string(),
    assessment: v.optional(v.string()),
    treatment: v.optional(v.string()),
    provider: v.optional(v.string()),
    disposition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { studentId, visitDate, complaint, assessment, treatment, provider, disposition, notes }) => {
    const session = await requirePermission(ctx, "medical.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    if (!complaint.trim()) throw new ConvexError("Complaint is required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) throw new ConvexError("Visit date must be YYYY-MM-DD.");
    const id = await ctx.db.insert("clinicVisits", {
      schoolId,
      studentId,
      visitDate,
      complaint: complaint.trim(),
      assessment: assessment?.trim(),
      treatment: treatment?.trim(),
      provider: provider?.trim(),
      disposition,
      notes: notes?.trim(),
      recordedById: session.userId,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "medical.visit.recorded",
      entityType: "clinicVisits", entityId: id,
      description: `Clinic visit recorded for ${student.firstName} ${student.lastName} (${visitDate}): ${complaint.trim().slice(0, 60)}`,
    });
    return id;
  },
});

export const updateVisit = mutation({
  args: {
    visitId: v.id("clinicVisits"),
    assessment: v.optional(v.string()),
    treatment: v.optional(v.string()),
    disposition: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { visitId, assessment, treatment, disposition, notes }) => {
    const session = await requirePermission(ctx, "medical.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const v2 = await getSchoolRecord(ctx, schoolId, "clinicVisits", visitId);
    await ctx.db.patch(visitId, {
      assessment: assessment?.trim() ?? v2.assessment,
      treatment: treatment?.trim() ?? v2.treatment,
      disposition: disposition ?? v2.disposition,
      notes: notes?.trim() ?? v2.notes,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "medical.visit.updated",
      entityType: "clinicVisits", entityId: visitId,
      description: `Clinic visit ${v2.visitDate} updated`,
    });
    return visitId;
  },
});

/* ================================================================== */
/* Medical dashboard (counts only — no clinical content)               */
/* ================================================================== */

export const medicalDashboard = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "medical.view");
    const schoolId = session.schoolId as Id<"schools">;
    const [profiles, visits] = await Promise.all([
      ctx.db.query("medicalProfiles").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("clinicVisits").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const monthPrefix = today.slice(0, 7);
    return {
      profileCount: profiles.length,
      allergyCount: profiles.reduce((s, p) => s + p.allergies.length, 0),
      conditionCount: profiles.reduce((s, p) => s + p.conditions.length, 0),
      visitsTotal: visits.length,
      visitsThisMonth: visits.filter((v2) => v2.visitDate.startsWith(monthPrefix)).length,
      visitsToday: visits.filter((v2) => v2.visitDate === today).length,
      hospitalReferred: visits.filter((v2) => v2.disposition === "sent_to_hospital" || v2.disposition === "referred").length,
    };
  },
});
