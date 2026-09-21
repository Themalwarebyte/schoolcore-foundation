import { action, internalQuery, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Diagnostic helpers for the Phase 2 verification scripts (scripts/phase2.test.ts).
 * The public query is read-only. Internal mutations exist so the verification
 * harness can (a) construct a specific authorization case — a second teacher
 * owning an assessment — and (b) clean up its own SMOKE-only leftovers that
 * would otherwise interfere with later runs (e.g. mid-term joiners that block
 * the results completeness gate). No real (non-SMOKE) data is touched:
 * only students created by the harness (SMOKE admission numbers / harness
 * first names) are deleted, along with their dependent rows.
 */

export const allocationProbe = query({
  args: {},
  handler: async (ctx) => {
    const sections = (await ctx.db.query("classSections").collect()).filter(
      (s) => s.status === "active",
    );
    const subjects = (await ctx.db.query("subjects").collect()).filter(
      (s) => s.status === "active",
    );
    const assessments = await ctx.db.query("assessments").collect();
    const staff = await ctx.db.query("staff").collect();
    const users = await ctx.db.query("users").collect();
    const years = await ctx.db.query("academicYears").collect();

    const labelFor = async (sectionId: typeof sections[number]["_id"]) => {
      const section = await ctx.db.get(sectionId);
      if (!section) return sectionId;
      const grade = await ctx.db.get(section.gradeLevelId);
      return `${grade?.name ?? ""} ${section.streamName}`.trim();
    };

    const emailToStaff: Record<string, string> = {};
    for (const s of staff) {
      if (s.email) emailToStaff[s.email] = s._id;
    }

    return {
      sections: await Promise.all(
        sections.map(async (s) => ({
          id: s._id,
          label: await labelFor(s._id),
        })),
      ),
      subjects: subjects.map((s) => ({ id: s._id, name: s.name })),
      assessments: assessments.map((a) => ({
        id: a._id,
        title: a.title,
        staffId: a.staffId ?? null,
      })),
      emailToStaffId: emailToStaff,
      usersByEmail: Object.fromEntries(users.map((u) => [u.email, u._id])),
      currentYearId:
        years.find((y) => y.isCurrent)?._id ?? years[years.length - 1]?._id ?? null,
    };
  },
});

/**
 * Public action bridge: lets the CLI / verification scripts invoke the internal
 * maintenance routines above (convex run / scripts cannot call internal
 * functions directly). Name-allowlisted so it cannot trigger arbitrary code.
 */
export const runInternal = action({
  args: { name: v.string() },
  handler: async (ctx, { name }): Promise<unknown> => {
    if (name === "purgeSmokeEnrollments") {
      return await ctx.runMutation(internal.diagnostics.purgeSmokeEnrollments, {});
    }
    if (name === "reopenSmokeSubjectResults") {
      return await ctx.runMutation(internal.diagnostics.reopenSmokeSubjectResults, {});
    }
    if (name === "ensureSecondTeacherCase") {
      return await ctx.runMutation(internal.diagnostics.ensureSecondTeacherCase, {
        teacherEmail: "collins.barasa@greenfield.ac.ke",
      });
    }
    if (name === "auditCensus") {
      return await ctx.runQuery(internal.diagnostics.auditCensusInternal, {});
    }
    throw new Error(`Unknown internal routine: ${name}`);
  },
});

/** Read-only census of every audit action ever recorded (all schools). */
export const auditCensusInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const logs = await ctx.db.query("auditLogs").collect();
    const counts: Record<string, number> = {};
    for (const l of logs) {
      counts[l.action] = (counts[l.action] ?? 0) + 1;
    }
    return counts;
  },
});

/**
 * Internal: remove THIS HARNESS'S students and all their dependent rows so
 * reruns start clean (a mid-term joiner with missing marks permanently blocks
 * the results completeness gate). Matches only harness-created students:
 * SMOKE-prefixed admission numbers or the harness's distinctive first names.
 */
export const purgeSmokeEnrollments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const students = (await ctx.db.query("students").collect()).filter(
      (s) =>
        s.admissionNumber.startsWith("SMOKE-") ||
        s.firstName === "PhaseTwo" ||
        s.firstName === "LateJoin",
    );
    let enrollmentsRemoved = 0;
    let scoresRemoved = 0;
    let recipientsRemoved = 0;
    let guardiansRemoved = 0;
    for (const st of students) {
      for (const sc of await ctx.db
        .query("assessmentScores")
        .withIndex("by_student", (q) => q.eq("studentId", st._id))
        .collect()) {
        await ctx.db.delete(sc._id);
        scoresRemoved++;
      }
      for (const rec of await ctx.db
        .query("assignmentRecipients")
        .withIndex("by_student", (q) => q.eq("studentId", st._id))
        .collect()) {
        await ctx.db.delete(rec._id);
        recipientsRemoved++;
      }
      for (const en of await ctx.db
        .query("enrollments")
        .withIndex("by_student", (q) => q.eq("studentId", st._id))
        .collect()) {
        await ctx.db.delete(en._id);
        enrollmentsRemoved++;
      }
      // Guardian links pointing at this student.
      for (const gl of await ctx.db
        .query("guardianStudents")
        .withIndex("by_student", (q) => q.eq("studentId", st._id))
        .collect()) {
        await ctx.db.delete(gl._id);
        guardiansRemoved++;
      }
      await ctx.db.delete(st._id);
    }
    return { studentsRemoved: students.length, enrollmentsRemoved, scoresRemoved, recipientsRemoved, guardiansRemoved };
  },
});

/**
 * Internal: clear stale published/locked subject results (the harness's
 * workflow subject) so reruns can resubmit.
 */
export const reopenSmokeSubjectResults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("subjectResults").collect();
    let cleared = 0;
    for (const r of rows) {
      if (r.status === "published" || r.status === "locked") {
        await ctx.db.patch(r._id, {
          status: "reopened" as const,
          reopenReason: "SMOKE rerun cleanup",
          updatedAt: Date.now(),
        });
        cleared++;
      }
    }
    return { cleared };
  },
});

/**
 * Internal: give the named staff member one active allocation in a class where
 * they had none (idempotent — skipped if they already teach there), and attach
 * a SMOKE assessment owned by that staff member so the "another teacher's
 * marks grid" negative test has a real target.
 */
export const ensureSecondTeacherCase = internalMutation({
  args: { teacherEmail: v.string() },
  handler: async (ctx, { teacherEmail }) => {
    const staff = (await ctx.db.query("staff").collect()).find(
      (s) => s.email === teacherEmail,
    );
    if (!staff) return { ok: false as const, reason: "staff-not-found" };
    const sections = (await ctx.db.query("classSections").collect()).filter(
      (s) => s.status === "active",
    );
    const allocs = await ctx.db.query("teacherAllocations").collect();
    const mine = allocs.filter(
      (a) => a.staffId === staff._id && a.status === "active",
    );
    const covered = new Set(mine.map((a) => a.classSectionId));
    const target = sections.find((s) => !covered.has(s._id));
    if (!target) return { ok: false as const, reason: "no-uncovered-section" };
    const subjects = (await ctx.db.query("subjects").collect()).filter(
      (s) => s.status === "active",
    );
    const subject = subjects[0];
    const years = await ctx.db.query("academicYears").collect();
    const year = years.find((y) => y.isCurrent) ?? years[years.length - 1];
    if (!subject || !year) return { ok: false as const, reason: "no-subject-or-year" };

    // Allocation (idempotent — reuse if it already exists).
    const existing = allocs.find(
      (a) =>
        a.staffId === staff._id &&
        a.classSectionId === target._id &&
        a.subjectId === subject._id &&
        a.academicYearId === year._id,
    );
    const allocationId =
      existing?._id ??
      (await ctx.db.insert("teacherAllocations", {
        schoolId: staff.schoolId,
        staffId: staff._id,
        subjectId: subject._id,
        classSectionId: target._id,
        academicYearId: year._id,
        status: "active",
      }));

    // SMOKE assessment owned by this staff member in that class.
    const dup = (await ctx.db.query("assessments").collect()).find(
      (a) => a.title === "SMOKE Other Teacher Assessment",
    );
    const assessmentId =
      dup?._id ??
      (await ctx.db.insert("assessments", {
        schoolId: staff.schoolId,
        academicYearId: year._id,
        termId: (
          await ctx.db
            .query("terms")
            .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
            .collect()
        )
          .sort((a, b) => a.displayOrder - b.displayOrder)[0]?._id,
        classSectionId: target._id,
        subjectId: subject._id,
        teacherAllocationId: allocationId,
        staffId: staff._id,
        assessmentTypeId: (
          await ctx.db.query("assessmentTypes").collect()
        )[0]._id,
        title: "SMOKE Other Teacher Assessment",
        assessmentDate: "2026-03-05",
        maxMarks: 50,
        weight: 10,
        countsTowardFinal: true,
        status: "marking",
        createdBy: (staff.userId ?? (await ctx.db.query("users").collect())[0]?._id) as never,
      }));

    return { ok: true as const, allocationId, assessmentId };
  },
});
