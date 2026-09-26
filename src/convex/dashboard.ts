import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission } from "./session";

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "dashboard.view");
    const schoolId = session.schoolId as Id<"schools">;

    const [students, staff, guardians, years, sections, subjects] = await Promise.all([
      ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("staff").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("guardians").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("academicYears").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db
        .query("classSections")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect(),
      ctx.db.query("subjects").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);

    const currentYear = years.find((y) => y.isCurrent) ?? null;
    const activeSections = sections.filter((c) => c.status === "active");

    // Students per grade (via enrollments in the current year).
    const grades = await ctx.db
      .query("gradeLevels")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const gradeById = new Map(grades.map((g) => [g._id, g]));
    const enrollments = currentYear
      ? await ctx.db
          .query("enrollments")
          .withIndex("by_year", (q) => q.eq("academicYearId", currentYear._id))
          .collect()
      : [];
    const studentsByGrade = new Map<string, number>();
    for (const e of enrollments) {
      if (e.status !== "active") continue;
      const section = sections.find((s) => s._id === e.classSectionId);
      if (!section) continue;
      const grade = gradeById.get(section.gradeLevelId);
      if (!grade) continue;
      studentsByGrade.set(grade.name, (studentsByGrade.get(grade.name) ?? 0) + 1);
    }

    const staffByDepartment = new Map<string, number>();
    for (const s of staff) {
      const key = s.department ?? "Unassigned";
      staffByDepartment.set(key, (staffByDepartment.get(key) ?? 0) + 1);
    }

    const recentStudents = await ctx.db
      .query("students")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .order("desc")
      .take(5);

    return {
      counts: {
        students: students.filter((s) => s.studentStatus === "active").length,
        staff: staff.filter((s) => s.employmentStatus === "active").length,
        teachers: staff.filter(
          (s) => s.employmentStatus === "active" && s.jobTitle?.toLowerCase().includes("teach"),
        ).length,
        guardians: guardians.filter((g) => g.status === "active").length,
        classes: activeSections.length,
        subjects: subjects.filter((s) => s.status === "active").length,
      },
      academicContext: currentYear
        ? { name: currentYear.name, startDate: currentYear.startDate, endDate: currentYear.endDate }
        : null,
      studentsByGrade: [...studentsByGrade.entries()].map(([name, count]) => ({ name, count })),
      genderDistribution: {
        male: students.filter((s) => s.gender === "male" && s.studentStatus === "active").length,
        female: students.filter((s) => s.gender === "female" && s.studentStatus === "active").length,
        other: students.filter((s) => s.gender === "other" && s.studentStatus === "active").length,
      },
      staffByDepartment: [...staffByDepartment.entries()].map(([name, count]) => ({ name, count })),
      recentStudents: recentStudents.map((s) => ({
        _id: s._id,
        fullName: [s.firstName, s.lastName].filter(Boolean).join(" "),
        admissionNumber: s.admissionNumber,
        studentStatus: s.studentStatus,
      })),
    };
  },
});

/* ------------------------------------------------------------------ */
/* First-time setup checklist (lives under onboarding records;         */
/* auto-derives steps so schools see progress without running the      */
/* wizard explicitly).                                                 */
/* ------------------------------------------------------------------ */

export const setupChecklist = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "dashboard.view");
    if (!session.schoolId) throw new ConvexError("Select a school to continue.");
    const schoolId = session.schoolId as Id<"schools">;

    const [school, years, sections, students, staff] = await Promise.all([
      ctx.db.get(schoolId),
      ctx.db.query("academicYears").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("staff").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    const currentYear = years.find((y) => y.isCurrent) ?? null;
    const [feeMethods, categories, parentLinks] = await Promise.all([
      ctx.db.query("paymentMethods").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("feeCategories").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("guardianStudents").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    const wizard = await ctx.db
      .query("onboardingRecords")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();

    const steps = [
      { key: "profile", label: "School profile complete", done: !!(school?.phone || school?.physicalAddress || school?.email) || !!wizard?.profileDone },
      { key: "academics", label: "Academic year & classes created", done: (!!currentYear && sections.length > 0) || !!wizard?.academicsDone },
      { key: "staff", label: "Teachers & staff added", done: staff.length > 0 || !!wizard?.usersDone },
      { key: "students", label: "Students enrolled", done: students.length > 0 || !!wizard?.importDone },
      { key: "finance", label: "Finance configured (fee categories & payment methods)", done: categories.length > 0 && feeMethods.length > 0 },
      { key: "parents", label: "Guardians linked to students", done: parentLinks.length > 0 },
      { key: "activate", label: "School activated", done: school?.status === "active" },
    ];
    const done = steps.filter((s) => s.done).length;
    return {
      steps,
      doneCount: done,
      total: steps.length,
      percent: Math.round((done / steps.length) * 100),
      isComplete: done === steps.length,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Attention required: pending work that needs an administrator         */
/* ------------------------------------------------------------------ */

export const attention = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "dashboard.view");
    if (!session.schoolId) throw new ConvexError("Select a school to continue.");
    const schoolId = session.schoolId as Id<"schools">;

    const [overdue, admissions, leave, expenses, incompleteStudents] = await Promise.all([
      ctx.db.query("invoices").withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "overdue")).collect(),
      ctx.db.query("applications").withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "submitted")).collect(),
      ctx.db.query("leaveRequests").withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "pending")).collect(),
      ctx.db.query("expenses").withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "submitted")).collect(),
      ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);

    return {
      overdueInvoices: overdue.length,
      pendingAdmissions: admissions.length,
      pendingLeave: leave.length,
      pendingExpenses: expenses.length,
      incompleteStudents: incompleteStudents.filter(
        (s) => !s.dateOfBirth || !s.gender || !s.admissionDate,
      ).length,
    };
  },
});
