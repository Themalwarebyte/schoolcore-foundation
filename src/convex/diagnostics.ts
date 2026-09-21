import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Diagnostic helpers for the Phase 2 verification scripts (scripts/phase2.test.ts).
 * The public query is read-only. The internal mutation exists so the verification
 * harness can construct specific authorization cases against the seeded demo
 * school (a second teacher owning an assessment) without hard-coding IDs.
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
    const anyUser = (await ctx.db.query("users").collect())[0]?._id;
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

    // Allocation (unique per staff+class+subject+year enforced by create logic;
    // here we construct directly and idempotently).
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
        createdBy: (staff.userId ?? anyUser) as never,
      }));

    return { ok: true as const, allocationId, assessmentId };
  },
});
