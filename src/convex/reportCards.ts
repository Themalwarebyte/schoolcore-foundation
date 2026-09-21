import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { gradeFor, overallAverage, competitionRanks } from "./engines/results";

type MutationCtxLike = MutationCtx;

/** Build the immutable snapshot body for one student's term report card. */
async function buildSnapshot(
  ctx: MutationCtxLike,
  schoolId: Id<"schools">,
  termId: Id<"terms">,
  studentId: Id<"students">,
  enrollmentId: Id<"enrollments">,
  classSectionId: Id<"classSections">,
  rankingEnabled: boolean,
) {
  const term = await ctx.db.get(termId);
  if (!term) throw new ConvexError("Term not found.");
  const academicYearId = term.academicYearId;

  // All approved/published subject results for this student + term.
  const results = await ctx.db
    .query("subjectResults")
    .withIndex("by_student_term", (q) => q.eq("studentId", studentId).eq("termId", termId))
    .collect();
  const usable = results.filter((r) => r.status === "approved" || r.status === "published");
  if (usable.length === 0) {
    throw new ConvexError(
      "No approved results found for this student in this term. Results must be approved before report cards can be generated.",
    );
  }

  const bands = await ctx.runQuery(internal.grading.activeBandsInternal, { schoolId });

  // Attendance summary for the term (daily sessions only — no double counting).
  const sessions = await ctx.db
    .query("attendanceSessions")
    .withIndex("by_school_term", (q) => q.eq("schoolId", schoolId).eq("termId", termId))
    .collect();
  const daily = sessions.filter((s) => s.sessionType === "daily");
  let present = 0, absent = 0, late = 0, excused = 0;
  for (const s of daily) {
    const recs = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_session", (q) => q.eq("sessionId", s._id))
      .collect();
    const mine = recs.filter((r) => r.studentId === studentId);
    for (const r of mine) {
      if (r.status === "present") present++;
      else if (r.status === "absent") absent++;
      else if (r.status === "late") late++;
      else if (r.status === "excused") excused++;
    }
  }
  const totalDays = present + absent + late + excused;

  const subjects = await Promise.all(
    usable.map(async (r) => {
      const subject = await ctx.db.get(r.subjectId);
      // Component transparency: per-assessment inputs for this subject + term.
      const assessments = await ctx.db
        .query("assessments")
        .withIndex("by_class_subject_term", (q) =>
          q.eq("classSectionId", r.classSectionId).eq("subjectId", r.subjectId).eq("termId", termId),
        )
        .collect();
      const scores = await ctx.db
        .query("assessmentScores")
        .withIndex("by_student", (q) => q.eq("studentId", studentId))
        .collect();
      const scoreByAssessment = new Map(scores.map((s) => [s.assessmentId, s]));
      const components = assessments
        .filter((a) => a.countsTowardFinal)
        .sort((a, b) => a.assessmentDate.localeCompare(b.assessmentDate))
        .map((a) => {
          const sc = scoreByAssessment.get(a._id);
          const score = sc?.status === "entered" && typeof sc.score === "number" ? sc.score : undefined;
          return {
            title: a.title,
            score,
            maxMarks: a.maxMarks,
            weight: a.weight,
            status: sc ? (sc.status as string) : "missing",
          };
        });
      return {
        subjectId: r.subjectId,
        subjectName: subject?.name ?? "—",
        totalScore: r.totalScore,
        percentage: r.percentage,
        gradeLabel: r.gradeLabel ?? (bands ? (gradeFor(bands, r.percentage)?.label ?? undefined) : undefined),
        teacherComment: undefined as string | undefined,
        components,
      };
    }),
  );
  subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

  const percentages = subjects.map((s) => s.percentage);
  const overallAveragePct = overallAverage(percentages);
  const overallGrade = bands ? (gradeFor(bands, overallAveragePct)?.label ?? undefined) : undefined;

  return {
    attendance:
      totalDays > 0
        ? {
            present: present + late,
            absent,
            late,
            excused,
            percentage: Math.round(((present + late) / totalDays) * 1000) / 10,
          }
        : undefined,
    overallAverage: overallAveragePct,
    overallGrade,
    subjects,
    academicYearId,
    enrollmentId,
    classSectionId,
    rankingEnabled,
  };
}

/** Rank calculation across a class for one term (competition ranking, §46). */
async function classRanks(
  ctx: MutationCtxLike,
  termId: Id<"terms">,
  classSectionId: Id<"classSections">,
): Promise<{ studentId: Id<"students">; rank: number; classSize: number }[]> {
  const results = await ctx.db
    .query("subjectResults")
    .withIndex("by_term_class", (q) => q.eq("termId", termId).eq("classSectionId", classSectionId))
    .collect();
  const usable = results.filter((r) => r.status === "approved" || r.status === "published");
  const byStudent = new Map<Id<"students">, number[]>();
  for (const r of usable) {
    const list = byStudent.get(r.studentId) ?? [];
    list.push(r.percentage);
    byStudent.set(r.studentId, list);
  }
  const entries = [...byStudent.entries()].map(([studentId, list]) => ({
    studentId,
    average: list.reduce((a, b) => a + b, 0) / list.length,
  }));
  entries.sort((a, b) => b.average - a.average);
  const ranks = competitionRanks(entries.map((e) => Math.round(e.average * 100) / 100));
  return entries.map((e, i) => ({ studentId: e.studentId, rank: ranks[i], classSize: entries.length }));
}

/** Generate (or regenerate as draft) report cards for a whole class or one student. */
export const generate = mutation({
  args: {
    termId: v.id("terms"),
    classSectionId: v.id("classSections"),
    studentId: v.optional(v.id("students")),
  },
  handler: async (ctx, { termId, classSectionId, studentId }) => {
    const session = await requirePermission(ctx, "report_cards.generate");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "terms", termId);
    await getSchoolRecord(ctx, schoolId, "classSections", classSectionId);

    const settings = await ctx.db
      .query("schoolSettings")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    const rankingEnabled = settings?.rankingEnabled ?? false;

    // Only actively enrolled students in this class for the term.
    const enrolls = await ctx.db
      .query("enrollments")
      .withIndex("by_class_section", (q) => q.eq("classSectionId", classSectionId))
      .collect();
    const active = enrolls.filter(
      (e) => e.status === "active" && (!studentId || e.studentId === studentId),
    );
    if (active.length === 0) throw new ConvexError("No enrolled students found for this selection.");

    const ranks = rankingEnabled ? await classRanks(ctx, termId, classSectionId) : [];
    const rankByStudent = new Map(ranks.map((r) => [r.studentId, r]));

    let generated = 0;
    let skipped = 0;
    for (const e of active) {
      const existing = await ctx.db
        .query("reportCards")
        .withIndex("by_term_student", (q) => q.eq("termId", termId).eq("studentId", e.studentId))
        .collect();
      const prev = existing.find((r) => r.classSectionId === classSectionId);
      if (prev && (prev.status === "published")) {
        skipped++; // published snapshots are immutable (§49)
        continue;
      }
      let snapshot;
      try {
        snapshot = await buildSnapshot(ctx, schoolId, termId, e.studentId, e._id, classSectionId, rankingEnabled);
      } catch {
        skipped++; // no approved results yet — leave this student out
        continue;
      }
      const rank = rankByStudent.get(e.studentId);
      if (prev) {
        await ctx.db.patch(prev._id, {
          status: "generated",
          attendance: snapshot.attendance,
          overallAverage: snapshot.overallAverage,
          overallGrade: snapshot.overallGrade,
          subjects: snapshot.subjects,
          rank: rankingEnabled ? (rank?.rank ?? undefined) : undefined,
          classSize: rankingEnabled ? (rank?.classSize ?? undefined) : undefined,
          generatedById: session.userId,
          generatedAt: Date.now(),
          snapshotVersion: prev.snapshotVersion + 1,
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("reportCards", {
          schoolId,
          academicYearId: snapshot.academicYearId,
          termId,
          studentId: e.studentId,
          enrollmentId: snapshot.enrollmentId,
          classSectionId: snapshot.classSectionId,
          status: "generated",
          attendance: snapshot.attendance,
          overallAverage: snapshot.overallAverage,
          overallGrade: snapshot.overallGrade,
          subjects: snapshot.subjects,
          rank: rankingEnabled ? (rank?.rank ?? undefined) : undefined,
          classSize: rankingEnabled ? (rank?.classSize ?? undefined) : undefined,
          generatedById: session.userId,
          generatedAt: Date.now(),
          snapshotVersion: 1,
        });
      }
      generated++;
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "report_card.generated",
      entityType: "reportCards",
      description: `Report cards generated (${generated}, ${skipped} skipped — no approved results or already published)`,
      metadata: { termId, classSectionId },
    });
    return { generated, skipped };
  },
});

/** Publish report cards (bulk) — snapshots become immutable. */
export const publish = mutation({
  args: { termId: v.id("terms"), classSectionId: v.id("classSections") },
  handler: async (ctx, { termId, classSectionId }) => {
    const session = await requirePermission(ctx, "report_cards.publish");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "terms", termId);
    const cards = await ctx.db
      .query("reportCards")
      .withIndex("by_term_class", (q) => q.eq("termId", termId).eq("classSectionId", classSectionId))
      .collect();
    const eligible = cards.filter((c) => c.status === "generated");
    if (eligible.length === 0) {
      throw new ConvexError("No generated report cards found to publish for this class and term.");
    }
    const now = Date.now();
    for (const c of eligible) {
      await ctx.db.patch(c._id, { status: "published", publishedAt: now, updatedAt: now });
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "report_card.published",
      entityType: "reportCards",
      description: `Report cards published (${eligible.length})`,
      metadata: { termId, classSectionId },
    });
    return { count: eligible.length };
  },
});

/** Save class-teacher / principal comments before publication (§47). */
export const saveComments = mutation({
  args: {
    reportCardId: v.id("reportCards"),
    classTeacherComment: v.optional(v.string()),
    principalComment: v.optional(v.string()),
  },
  handler: async (ctx, { reportCardId, classTeacherComment, principalComment }) => {
    const session = await requirePermission(ctx, "report_cards.generate");
    const schoolId = session.schoolId as Id<"schools">;
    const card = await getSchoolRecord(ctx, schoolId, "reportCards", reportCardId);
    if (card.status === "published") {
      throw new ConvexError("Published report cards cannot be edited. Reopen results and regenerate first.");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (classTeacherComment !== undefined) {
      // Class teacher of this class, or admins.
      if (session.role.role === "teacher") {
        const section = await ctx.db.get(card.classSectionId);
        const staff = await ctx.db
          .query("staff")
          .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
          .collect();
        const mine = staff.find((s) => s.userId === session.userId);
        if (!section || section.classTeacherStaffId !== mine?._id) {
          throw new ConvexError("Only the class teacher can write the class teacher comment.");
        }
      }
      patch.classTeacherComment = classTeacherComment;
    }
    if (principalComment !== undefined) {
      if (session.role.role !== "principal" && session.role.role !== "school_admin" && session.role.role !== "super_admin") {
        throw new ConvexError("Only the principal or an administrator can write the headteacher comment.");
      }
      patch.principalComment = principalComment;
    }
    await ctx.db.patch(reportCardId, patch);
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "report_card.comments_saved",
      entityType: "reportCards",
      entityId: reportCardId,
    });
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const listForClass = query({
  args: { termId: v.id("terms"), classSectionId: v.id("classSections") },
  handler: async (ctx, { termId, classSectionId }) => {
    const session = await requirePermission(ctx, "report_cards.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "terms", termId);
    const cards = await ctx.db
      .query("reportCards")
      .withIndex("by_term_class", (q) => q.eq("termId", termId).eq("classSectionId", classSectionId))
      .collect();
    return await Promise.all(
      cards.map(async (c) => {
        const st = await ctx.db.get(c.studentId);
        return {
          _id: c._id,
          studentId: c.studentId,
          fullName: st ? [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") : "—",
          admissionNumber: st?.admissionNumber ?? "",
          status: c.status,
          overallAverage: c.overallAverage,
          overallGrade: c.overallGrade,
          rank: c.rank,
          classSize: c.classSize,
          snapshotVersion: c.snapshotVersion,
        };
      }),
    );
  },
});

/** Full report card document for the printable view. */
export const get = query({
  args: { reportCardId: v.id("reportCards") },
  handler: async (ctx, { reportCardId }) => {
    const session = await requirePermission(ctx, "report_cards.view");
    const schoolId = session.schoolId as Id<"schools">;
    const card = await getSchoolRecord(ctx, schoolId, "reportCards", reportCardId);
    const student = await ctx.db.get(card.studentId);
    const section = await ctx.db.get(card.classSectionId);
    const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
    const year = await ctx.db.get(card.academicYearId);
    const term = await ctx.db.get(card.termId);
    const school = await ctx.db.get(schoolId);
    const settings = await ctx.db
      .query("schoolSettings")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    return {
      card,
      student: student
        ? {
            fullName: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
            admissionNumber: student.admissionNumber,
          }
        : null,
      classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
      yearName: year?.name ?? "—",
      termName: term?.name ?? "—",
      termEndDate: term?.endDate ?? null,
      school: {
        name: school?.name ?? "",
        address: school?.physicalAddress ?? school?.postalAddress ?? "",
        motto: undefined as string | undefined,
      },
      settings: {
        showAttendance: settings?.reportCardShowAttendance ?? true,
        showSubjectComments: settings?.reportCardShowSubjectComments ?? true,
        showRank: (settings?.reportCardShowRank ?? true) && (settings?.rankingEnabled ?? false),
        signatureLabels: settings?.reportCardSignatureLabels ?? "Class Teacher | Principal",
        footerText: settings?.reportCardFooterText ?? "",
        nextTermOpeningDate: settings?.nextTermOpeningDate,
      },
    };
  },
});

/** Overview of report-card readiness per class (dashboard + principal §60). */
export const readiness = query({
  args: { termId: v.optional(v.id("terms")) },
  handler: async (ctx, { termId }) => {
    const session = await requirePermission(ctx, "report_cards.view");
    const schoolId = session.schoolId as Id<"schools">;
    let effectiveTermId = termId;
    if (!effectiveTermId) {
      const t = await ctx.db
        .query("terms")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      effectiveTermId = t?._id;
    }
    if (!effectiveTermId) return { generated: 0, published: 0, students: 0 };
    const cards = await ctx.db
      .query("reportCards")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const termCards = cards.filter((c) => c.termId === effectiveTermId);
    return {
      generated: termCards.filter((c) => c.status === "generated").length,
      published: termCards.filter((c) => c.status === "published").length,
      students: termCards.length,
    };
  },
});
