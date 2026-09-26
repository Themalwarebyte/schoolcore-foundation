import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission } from "./session";
import { recordAudit } from "./audit";
import { DAYS_OF_WEEK } from "./schema";
import { todayInTz } from "./attendance";

/* ------------------------------------------------------------------ */
/* Academic settings (attendance/timetable/grading/report cards)        */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  attendanceMode: "daily",
  schoolDays: ["mon", "tue", "wed", "thu", "fri"],
  editableWindowDays: 7,
  rankingEnabled: false,
  reportCardShowAttendance: true,
  reportCardShowSubjectComments: true,
  reportCardShowRank: true,
};

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "settings.view");
    const schoolId = session.schoolId as Id<"schools">;
    const s = await ctx.db
      .query("schoolSettings")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    return { ...DEFAULT_SETTINGS, ...(s ?? {}), schoolId, reportCardSignatureLabels: s?.reportCardSignatureLabels ?? "Class Teacher | Principal", reportCardFooterText: s?.reportCardFooterText ?? "", nextTermOpeningDate: s?.nextTermOpeningDate ?? null };
  },
});

/** Internal: lazily provision settings row so policy checks never see undefined mode. */
export const ensureSettingsInternal = internalMutation({
  args: { attendanceMode: v.string() },
  handler: async (ctx, { attendanceMode }) => {
    const schools = await ctx.db.query("schools").collect();
    for (const school of schools) {
      const existing = await ctx.db
        .query("schoolSettings")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .first();
      if (!existing) {
        await ctx.db.insert("schoolSettings", {
          schoolId: school._id,
          attendanceMode,
          schoolDays: ["mon", "tue", "wed", "thu", "fri"],
          editableWindowDays: 7,
          rankingEnabled: true,
          reportCardShowAttendance: true,
          reportCardShowSubjectComments: true,
          reportCardShowRank: true,
          reportCardSignatureLabels: "Class Teacher | Principal",
        });
      } else if (existing.attendanceMode === "daily" && attendanceMode === "both") {
        // Self-heal demo schools so both daily and lesson attendance are exercised.
        await ctx.db.patch(existing._id, { attendanceMode: "both", updatedAt: Date.now() });
      }
    }
    return null;
  },
});

export const saveSettings = mutation({
  args: {
    attendanceMode: v.string(),
    schoolDays: v.array(v.string()),
    editableWindowDays: v.number(),
    rankingEnabled: v.boolean(),
    reportCardShowAttendance: v.boolean(),
    reportCardShowSubjectComments: v.boolean(),
    reportCardShowRank: v.boolean(),
    reportCardSignatureLabels: v.optional(v.string()),
    reportCardFooterText: v.optional(v.string()),
    nextTermOpeningDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "settings.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!["daily", "lesson", "both"].includes(args.attendanceMode)) {
      throw new ConvexError("Unknown attendance mode.");
    }
    for (const d of args.schoolDays) {
      if (!DAYS_OF_WEEK.includes(d as (typeof DAYS_OF_WEEK)[number])) {
        throw new ConvexError("Unknown school day.");
      }
    }
    if (args.schoolDays.length === 0) throw new ConvexError("Select at least one school day.");
    if (args.editableWindowDays < 0 || args.editableWindowDays > 365) {
      throw new ConvexError("Editable window must be between 0 and 365 days.");
    }
    const existing = await ctx.db
      .query("schoolSettings")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    const { schoolId: _ignored, ...values } = { ...args, schoolId };
    void _ignored;
    if (existing) {
      await ctx.db.patch(existing._id, { ...values, updatedAt: Date.now(), updatedById: session.userId });
    } else {
      await ctx.db.insert("schoolSettings", {
        schoolId,
        ...values,
        updatedAt: Date.now(),
        updatedById: session.userId,
      });
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "settings.academic_updated",
      entityType: "schoolSettings",
      description: `Academic settings updated (mode: ${args.attendanceMode}, ranking: ${args.rankingEnabled ? "on" : "off"})`,
    });
  },
});

/* ------------------------------------------------------------------ */
/* Teacher home (§59)                                                  */
/* ------------------------------------------------------------------ */

export const teacherHome = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "dashboard.view");
    const schoolId = session.schoolId as Id<"schools">;
    const school = await ctx.db.get(schoolId);
    const today = todayInTz(school?.timezone);

    const staff = await ctx.db
      .query("staff")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const mine = staff.find((s) => s.userId === session.userId && s.employmentStatus === "active");
    if (!mine) return null; // non-teaching staff see the regular dashboard

    // Allocations → today's classes.
    const allocs = (
      await ctx.db.query("teacherAllocations").withIndex("by_staff", (q) => q.eq("staffId", mine._id)).collect()
    ).filter((a) => a.status === "active");

    const yearId = allocs[0]?.academicYearId;
    let entries: {
      _id: Id<"timetableEntries">;
      classSectionId: Id<"classSections">;
      subjectId: Id<"subjects">;
      periodName: string;
      startTime: string;
      dayOfWeek: string;
      classLabel: string;
      subjectName: string;
      attendanceDone: boolean;
    }[] = [];
    if (yearId) {
      const rows = await ctx.db
        .query("timetableEntries")
        .withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", yearId))
        .collect();
      const todayDow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(today + "T00:00:00Z").getUTCDay()];
      const periods = await ctx.db
        .query("timetablePeriods")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const periodById = new Map(periods.map((p) => [p._id, p]));
      const mineEntries = rows.filter(
        (e) => e.staffId === mine._id && e.status === "published" && e.dayOfWeek === todayDow,
      );
      const sessions = await ctx.db
        .query("attendanceSessions")
        .withIndex("by_school_date", (q) => q.eq("schoolId", schoolId).eq("date", today))
        .collect();
      entries = await Promise.all(
        mineEntries.map(async (e) => {
          const section = await ctx.db.get(e.classSectionId);
          const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
          const subject = await ctx.db.get(e.subjectId);
          const period = periodById.get(e.periodId);
          const isTeaching = period?.periodType === "teaching";
          const attendanceDone = sessions.some(
            (s) =>
              s.classSectionId === e.classSectionId &&
              (s.sessionType === "daily" ||
                (s.sessionType === "lesson" && s.subjectId === e.subjectId)),
          ) || !isTeaching;
          return {
            _id: e._id,
            classSectionId: e.classSectionId,
            subjectId: e.subjectId,
            periodName: period?.name ?? "—",
            startTime: period?.startTime ?? "",
            dayOfWeek: e.dayOfWeek,
            classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
            subjectName: subject?.name ?? "—",
            attendanceDone,
          };
        }),
      );
      entries.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }

    // Assignments + assessments needing attention.
    const terms = yearId
      ? await ctx.db.query("terms").withIndex("by_academic_year", (q) => q.eq("academicYearId", yearId)).collect()
      : [];
    const currentTerm = terms.find((t) => t.isCurrent) ?? terms[0];
    const assignments = currentTerm
      ? (
          await ctx.db
            .query("assignments")
            .withIndex("by_school_term", (q) => q.eq("schoolId", schoolId).eq("termId", currentTerm._id))
            .collect()
        )
          .filter((a) => a.staffId === mine._id && a.status !== "archived")
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .slice(0, 5)
          .map((a) => ({ _id: a._id, title: a.title, dueDate: a.dueDate, status: a.status }))
      : [];
    const assessments = currentTerm
      ? (
          await ctx.db
            .query("assessments")
            .withIndex("by_school_term", (q) => q.eq("schoolId", schoolId).eq("termId", currentTerm._id))
            .collect()
        )
          .filter((a) => a.staffId === mine._id && ["draft", "open", "marking"].includes(a.status))
          .map(async (a) => {
            const scores = await ctx.db
              .query("assessmentScores")
              .withIndex("by_assessment", (q) => q.eq("assessmentId", a._id))
              .collect();
            const subject = await ctx.db.get(a.subjectId);
            const section = await ctx.db.get(a.classSectionId);
            const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
            const enrolls = await ctx.db
              .query("enrollments")
              .withIndex("by_class_section", (q) => q.eq("classSectionId", a.classSectionId))
              .collect();
            const expected = enrolls.filter((e) => e.status === "active").length;
            return {
              _id: a._id,
              title: a.title,
              status: a.status,
              subjectName: subject?.name ?? "—",
              classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
              entered: scores.filter((s) => s.status === "entered").length,
              expected,
            };
          })
      : [];
    const assessmentRows = (await Promise.all(assessments)).filter((a) => a.entered < a.expected || a.status === "draft").slice(0, 5);

    return {
      isTeacher: true,
      staffName: `${mine.firstName} ${mine.lastName}`,
      today,
      todaysClasses: entries,
      allocations: allocs.length,
      assignments,
      assessments: assessmentRows,
      actionRequired: {
        attendance: entries.filter((e) => !e.attendanceDone).length,
        marksIncomplete: assessmentRows.length,
      },
    };
  },
});

/* ------------------------------------------------------------------ */
/* School dashboard operational indicators (§58)                       */
/* ------------------------------------------------------------------ */

export const ops = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "dashboard.view");
    const schoolId = session.schoolId as Id<"schools">;
    const school = await ctx.db.get(schoolId);
    const today = todayInTz(school?.timezone);

    const year = await ctx.db
      .query("academicYears")
      .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
      .first();
    const term = year
      ? await ctx.db
          .query("terms")
          .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
          .collect()
          .then((ts) => ts.find((t) => t.isCurrent) ?? null)
      : null;

    // Attendance today.
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_school_date", (q) => q.eq("schoolId", schoolId).eq("date", today))
      .collect();
    const daily = sessions.filter((s) => s.sessionType === "daily");
    let present = 0, total = 0, completed = 0;
    for (const s of daily) {
      const recs = await ctx.db
        .query("attendanceRecords")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      total += recs.length;
      present += recs.filter((r) => r.status === "present" || r.status === "late").length;
      if (s.status === "completed") completed++;
    }
    const sections = year
      ? await ctx.db
          .query("classSections")
          .withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", year._id))
          .collect()
      : [];
    const activeSections = sections.filter((s) => s.status === "active");

    // Assessments awaiting marks / upcoming.
    let awaitingMarks = 0;
    let upcomingAssessments = 0;
    if (term) {
      const assessments = await ctx.db
        .query("assessments")
        .withIndex("by_school_term", (q) => q.eq("schoolId", schoolId).eq("termId", term._id))
        .collect();
      const open = assessments.filter((a) => ["draft", "open", "marking"].includes(a.status));
      upcomingAssessments = assessments.filter((a) => a.assessmentDate >= today && ["open", "draft"].includes(a.status)).length;
      for (const a of open) {
        const scores = await ctx.db
          .query("assessmentScores")
          .withIndex("by_assessment", (q) => q.eq("assessmentId", a._id))
          .collect();
        const enrolls = await ctx.db
          .query("enrollments")
          .withIndex("by_class_section", (q) => q.eq("classSectionId", a.classSectionId))
          .collect();
        const expected = enrolls.filter((e) => e.status === "active").length;
        if (scores.filter((s) => s.status === "entered").length < expected) awaitingMarks++;
      }
    }

    // Results awaiting approval.
    let resultsAwaitingApproval = 0;
    if (term) {
      const results = await ctx.db
        .query("subjectResults")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      resultsAwaitingApproval = results.filter((r) => r.termId === term._id && r.status === "submitted").length;
    }

    // Report cards awaiting publication.
    let reportCardsAwaiting = 0;
    if (term) {
      const cards = await ctx.db
        .query("reportCards")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      reportCardsAwaiting = cards.filter((c) => c.termId === term._id && c.status === "generated").length;
    }

    return {
      today,
      termName: term?.name ?? null,
      yearName: year?.name ?? null,
      attendance: {
        sessionsToday: daily.length,
        completedToday: completed,
        classesTotal: activeSections.length,
        percentageToday: total > 0 ? Math.round((present / total) * 1000) / 10 : null,
        recordsToday: total,
      },
      awaitingMarks,
      upcomingAssessments,
      resultsAwaitingApproval,
      reportCardsAwaiting,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Academic analytics (§53–57)                                         */
/* ------------------------------------------------------------------ */

export const analytics = query({
  args: {
    termId: v.optional(v.id("terms")),
    classSectionId: v.optional(v.id("classSections")),
    subjectId: v.optional(v.id("subjects")),
  },
  handler: async (ctx, { termId, classSectionId, subjectId }) => {
    const session = await requirePermission(ctx, "academic_analytics.view");
    const schoolId = session.schoolId as Id<"schools">;
    let effectiveTermId = termId;
    if (!effectiveTermId) {
      const t = await ctx.db
        .query("terms")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      effectiveTermId = t?._id;
    }
    if (!effectiveTermId) return null;

    let results = await ctx.db
      .query("subjectResults")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    results = results.filter((r) => r.termId === effectiveTermId && (r.status === "approved" || r.status === "published" || r.status === "submitted"));
    if (classSectionId) results = results.filter((r) => r.classSectionId === classSectionId);
    if (subjectId) results = results.filter((r) => r.subjectId === subjectId);

    // Class × subject averages.
    const byClass = new Map<Id<"classSections">, number[]>();
    const bySubject = new Map<Id<"subjects">, number[]>();
    const gradeDistribution = new Map<string, number>();
    for (const r of results) {
      const c = byClass.get(r.classSectionId) ?? [];
      c.push(r.percentage);
      byClass.set(r.classSectionId, c);
      const s = bySubject.get(r.subjectId) ?? [];
      s.push(r.percentage);
      bySubject.set(r.subjectId, s);
      if (r.gradeLabel) gradeDistribution.set(r.gradeLabel, (gradeDistribution.get(r.gradeLabel) ?? 0) + 1);
    }

    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

    const sections = await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const subjects = await ctx.db.query("subjects").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const labelForSection = async (id: Id<"classSections">) => {
      const s = sections.find((x) => x._id === id);
      if (!s) return "—";
      const g = await ctx.db.get(s.gradeLevelId);
      return `${g?.name ?? ""} ${s.streamName}`.trim();
    };

    const classRows = await Promise.all(
      [...byClass.entries()].map(async ([id, xs]) => ({
        id,
        label: await labelForSection(id),
        average: avg(xs),
        students: new Set(results.filter((r) => r.classSectionId === id).map((r) => r.studentId)).size,
      })),
    );
    const subjectRows = [...bySubject.entries()].map(([id, xs]) => ({
      id,
      name: subjects.find((s) => s._id === id)?.name ?? "—",
      average: avg(xs),
    }));

    // Assessment-level stats (completion + averages) for the selected scope.
    let assessmentRows: { id: Id<"assessments">; title: string; average: number | null; completion: number }[] = [];
    if (classSectionId && subjectId) {
      const assessments = await ctx.db
        .query("assessments")
        .withIndex("by_class_subject_term", (q) =>
          q.eq("classSectionId", classSectionId).eq("subjectId", subjectId).eq("termId", effectiveTermId as Id<"terms">),
        )
        .collect();
      const enrolls = await ctx.db
        .query("enrollments")
        .withIndex("by_class_section", (q) => q.eq("classSectionId", classSectionId))
        .collect();
      const expected = enrolls.filter((e) => e.status === "active").length;
      assessmentRows = await Promise.all(
        assessments.map(async (a) => {
          const scores = await ctx.db
            .query("assessmentScores")
            .withIndex("by_assessment", (q) => q.eq("assessmentId", a._id))
            .collect();
          const entered = scores.filter((s) => s.status === "entered" && typeof s.score === "number");
          return {
            id: a._id,
            title: a.title,
            average:
              entered.length > 0
                ? Math.round((entered.reduce((s, x) => s + (x.score as number) / a.maxMarks, 0) / entered.length) * 1000) / 10
                : null,
            completion: expected > 0 ? Math.round((scores.length / expected) * 100) : 0,
          };
        }),
      );
    }

    return {
      termId: effectiveTermId,
      overallAverage: avg(results.map((r) => r.percentage)),
      resultCount: results.length,
      classAverages: classRows.sort((a, b) => a.label.localeCompare(b.label)),
      subjectAverages: subjectRows.sort((a, b) => a.name.localeCompare(b.name)),
      gradeDistribution: [...gradeDistribution.entries()].map(([grade, count]) => ({ grade, count })),
      assessmentStats: assessmentRows,
    };
  },
});
