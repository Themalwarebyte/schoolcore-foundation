import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { computeSubjectResult, gradeFor, competitionRanks, type ScoreInput } from "./engines/results";

/** Accepts both query and mutation contexts (read-only usage). */
type CtxLike = { db: QueryCtx["db"] };
type MutationCtxLike = MutationCtx;

/**
 * Compute the weighted result for every enrolled student in a class × subject ×
 * term from the assessments configured to contribute. Pure reads + engine call.
 */
async function computeForSubject(
  ctx: CtxLike,
  schoolId: Id<"schools">,
  termId: Id<"terms">,
  classSectionId: Id<"classSections">,
  subjectId: Id<"subjects">,
) {
  const term = await ctx.db.get(termId);
  if (!term) throw new ConvexError("Term not found.");
  const academicYearId = term.academicYearId;

  const assessments = await ctx.db
    .query("assessments")
    .withIndex("by_class_subject_term", (q) =>
      q.eq("classSectionId", classSectionId).eq("subjectId", subjectId).eq("termId", termId),
    )
    .collect();
  const contributing = assessments.filter((a) => a.countsTowardFinal && a.status !== "archived");

  const enrolls = await ctx.db
    .query("enrollments")
    .withIndex("by_class_section", (q) => q.eq("classSectionId", classSectionId))
    .collect();
  const active = enrolls.filter((e) => e.status === "active" && e.academicYearId === academicYearId);

  const results: {
    studentId: Id<"students">;
    enrollmentId: Id<"enrollments">;
    totalScore: number;
    percentage: number;
    missingCount: number;
    absentCount: number;
    exemptCount: number;
    enteredCount: number;
    components: {
      assessmentId: Id<"assessments">;
      title: string;
      score: number | null;
      maxMarks: number;
      weight: number;
      contribution: number | null;
      status: ScoreInput["status"];
    }[];
  }[] = [];

  for (const e of active) {
    const scores = await ctx.db
      .query("assessmentScores")
      .withIndex("by_student", (q) => q.eq("studentId", e.studentId))
      .collect();
    const scoreByAssessment = new Map(scores.map((s) => [s.assessmentId, s]));
    const inputs: ScoreInput[] = contributing.map((a) => {
      const sc = scoreByAssessment.get(a._id);
      return {
        assessmentId: a._id,
        title: a.title,
        maxMarks: a.maxMarks,
        weight: a.weight,
        countsTowardFinal: a.countsTowardFinal,
        score: sc?.status === "entered" ? (sc.score ?? null) : null,
        status: sc ? (sc.status as ScoreInput["status"]) : "missing",
      };
    });
    const r = computeSubjectResult(inputs);
    results.push({
      studentId: e.studentId,
      enrollmentId: e._id,
      totalScore: r.totalScore,
      percentage: r.percentage,
      missingCount: r.missingCount,
      absentCount: r.absentCount,
      exemptCount: r.exemptCount,
      enteredCount: r.enteredCount,
      components: r.components.map((c) => ({
        assessmentId: c.assessmentId as Id<"assessments">,
        title: c.title,
        score: c.score,
        maxMarks: c.maxMarks,
        weight: c.weight,
        contribution: c.contribution,
        status: c.status,
      })),
    });
  }
  void schoolId;
  return results;
}

/** Preview the computed results for a class + subject + term (transparency §41). */
export const preview = query({
  args: { termId: v.id("terms"), classSectionId: v.id("classSections"), subjectId: v.id("subjects") },
  handler: async (ctx, { termId, classSectionId, subjectId }) => {
    const session = await requirePermission(ctx, "results.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "terms", termId);
    await getSchoolRecord(ctx, schoolId, "classSections", classSectionId);
    await getSchoolRecord(ctx, schoolId, "subjects", subjectId);

    // Teachers can only preview their own subject results.
    if (session.role.role === "teacher") {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = staff.find((s) => s.userId === session.userId);
      const allocs = mine
        ? await ctx.db.query("teacherAllocations").withIndex("by_staff", (q) => q.eq("staffId", mine._id)).collect()
        : [];
      const ok = allocs.some(
        (a) => a.status === "active" && a.classSectionId === classSectionId && a.subjectId === subjectId,
      );
      if (!ok) throw new ConvexError("You are not allocated to this class for this subject.");
    }

    const rows = await computeForSubject(ctx, schoolId, termId, classSectionId, subjectId);
    const bands = (await ctx.runQuery(internal.grading.activeBandsInternal, { schoolId })) as
      | { label: string; minPercent: number; maxPercent: number; isPass?: boolean }[]
      | null;
    const subject = await ctx.db.get(subjectId);
    return {
      subjectName: subject?.name ?? "—",
      bands,
      rows: rows
        .map((r) => {
          const grade = bands ? gradeFor(bands, r.percentage) : null;
          return { ...r, gradeLabel: grade?.label ?? null };
        })
        .sort((a, b) => b.percentage - a.percentage),
    };
  },
});

/** Teacher submits the whole class×subject result set for review (§42). */
export const submit = mutation({
  args: { termId: v.id("terms"), classSectionId: v.id("classSections"), subjectId: v.id("subjects") },
  handler: async (ctx, { termId, classSectionId, subjectId }) => {
    const session = await requirePermission(ctx, "marks.submit");
    const schoolId = session.schoolId as Id<"schools">;
    const term = await getSchoolRecord(ctx, schoolId, "terms", termId);
    await getSchoolRecord(ctx, schoolId, "classSections", classSectionId);
    await getSchoolRecord(ctx, schoolId, "subjects", subjectId);

    if (session.role.role === "teacher") {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = staff.find((s) => s.userId === session.userId);
      const allocs = mine
        ? await ctx.db.query("teacherAllocations").withIndex("by_staff", (q) => q.eq("staffId", mine._id)).collect()
        : [];
      const ok = allocs.some(
        (a) => a.status === "active" && a.classSectionId === classSectionId && a.subjectId === subjectId,
      );
      if (!ok) throw new ConvexError("You are not allocated to this class for this subject.");
    }

    const assessments = await ctx.db
      .query("assessments")
      .withIndex("by_class_subject_term", (q) =>
        q.eq("classSectionId", classSectionId).eq("subjectId", subjectId).eq("termId", termId),
      )
      .collect();
    if (assessments.length === 0) {
      throw new ConvexError("There are no assessments for this class and subject in this term yet.");
    }

    const rows = await computeForSubject(ctx, schoolId, termId, classSectionId, subjectId);
    if (rows.length === 0) throw new ConvexError("No active enrollments found for this class.");

    // Completeness gate (§43): block submission while marks are simply missing.
    const bands = (await ctx.runQuery(internal.grading.activeBandsInternal, { schoolId })) as
      | { label: string; minPercent: number; maxPercent: number; isPass?: boolean }[]
      | null;
    const withGrades = rows.map((r) => {
      const grade = bands ? gradeFor(bands, r.percentage) : null;
      return { ...r, gradeLabel: grade?.label ?? null };
    });
    const blocking = withGrades.filter((r) => r.missingCount > 0);
    if (blocking.length > 0) {
      throw new ConvexError(
        `${blocking.length} student(s) still have missing marks. Enter a score, or mark them absent/exempt before submitting.`,
      );
    }

    for (const r of withGrades) {
      const existing = await ctx.db
        .query("subjectResults")
        .withIndex("by_student_term", (q) => q.eq("studentId", r.studentId).eq("termId", termId))
        .collect();
      const prev = existing.find(
        (x) => x.subjectId === subjectId && x.classSectionId === classSectionId,
      );
      const payload = {
        totalScore: r.totalScore,
        percentage: r.percentage,
        gradeLabel: r.gradeLabel ?? undefined,
        status: "submitted" as const,
        submittedById: session.userId,
        updatedAt: Date.now(),
      };
      if (prev) {
        if (prev.status === "published" || prev.status === "locked") {
          throw new ConvexError("These results are already published. Reopen them first to resubmit.");
        }
        await ctx.db.patch(prev._id, payload);
      } else {
        await ctx.db.insert("subjectResults", {
          schoolId,
          academicYearId: term.academicYearId,
          termId,
          classSectionId,
          subjectId,
          studentId: r.studentId,
          enrollmentId: r.enrollmentId,
          ...payload,
        });
      }
    }
    // Lock the contributing assessments.
    for (const a of assessments) {
      if (["draft", "open", "marking"].includes(a.status)) {
        await ctx.db.patch(a._id, {
          status: "submitted",
          submittedAt: Date.now(),
          submittedById: session.userId,
          updatedAt: Date.now(),
        });
      }
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "results.submitted",
      entityType: "subjectResults",
      entityId: subjectId,
      description: `Results submitted for ${rows.length} students`,
      metadata: { termId, classSectionId },
    });
    return { count: withGrades.length };
  },
});

/** Principal/Admin approves submitted results (§42). */
export const approve = mutation({
  args: { termId: v.id("terms"), classSectionId: v.id("classSections"), subjectId: v.id("subjects") },
  handler: async (ctx, { termId, classSectionId, subjectId }) => {
    const session = await requirePermission(ctx, "results.approve");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "terms", termId);
    const rows = await ctx.db
      .query("subjectResults")
      .withIndex("by_term_class", (q) => q.eq("termId", termId).eq("classSectionId", classSectionId))
      .collect();
    const subjectRows = rows.filter((r) => r.subjectId === subjectId);
    if (subjectRows.length === 0) throw new ConvexError("No submitted results found for this selection.");
    for (const r of subjectRows) {
      if (r.status !== "submitted" && r.status !== "reopened") {
        throw new ConvexError("Only submitted results can be approved.");
      }
      await ctx.db.patch(r._id, { status: "approved", approvedById: session.userId, updatedAt: Date.now() });
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "results.approved",
      entityType: "subjectResults",
      entityId: subjectId,
      description: `Results approved (${subjectRows.length} students)`,
    });
    return { count: subjectRows.length };
  },
});

/** Principal/Admin publishes approved results — after this, marks are locked (§42). */
export const publish = mutation({
  args: { termId: v.id("terms"), classSectionId: v.id("classSections"), subjectId: v.optional(v.id("subjects")) },
  handler: async (ctx, { termId, classSectionId, subjectId }) => {
    const session = await requirePermission(ctx, "results.publish");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "terms", termId);
    let rows = await ctx.db
      .query("subjectResults")
      .withIndex("by_term_class", (q) => q.eq("termId", termId).eq("classSectionId", classSectionId))
      .collect();
    if (subjectId) rows = rows.filter((r) => r.subjectId === subjectId);
    const eligible = rows.filter((r) => r.status === "approved");
    if (eligible.length === 0) throw new ConvexError("No approved results found to publish.");
    const now = Date.now();
    for (const r of eligible) {
      await ctx.db.patch(r._id, { status: "published", publishedAt: now, updatedAt: now });
      // Lock the contributing assessments too.
      const assessments = await ctx.db
        .query("assessments")
        .withIndex("by_class_subject_term", (q) =>
          q.eq("classSectionId", classSectionId).eq("subjectId", r.subjectId).eq("termId", termId),
        )
        .collect();
      for (const a of assessments) {
        if (["draft", "open", "marking", "submitted", "approved"].includes(a.status)) {
          await ctx.db.patch(a._id, { status: "locked", updatedAt: now });
        }
      }
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "results.published",
      entityType: "subjectResults",
      description: `Results published (${eligible.length} records)`,
      metadata: { termId, classSectionId },
    });
    return { count: eligible.length };
  },
});

/** Authorized reopen with mandatory reason (§35, §42). */
export const reopen = mutation({
  args: { termId: v.id("terms"), classSectionId: v.id("classSections"), subjectId: v.id("subjects"), reason: v.string() },
  handler: async (ctx, { termId, classSectionId, subjectId, reason }) => {
    const session = await requirePermission(ctx, "results.approve");
    const schoolId = session.schoolId as Id<"schools">;
    if (!reason.trim()) throw new ConvexError("A reason is required to reopen results.");
    await getSchoolRecord(ctx, schoolId, "terms", termId);
    const rows = await ctx.db
      .query("subjectResults")
      .withIndex("by_term_class", (q) => q.eq("termId", termId).eq("classSectionId", classSectionId))
      .collect();
    const subjectRows = rows.filter((r) => r.subjectId === subjectId);
    for (const r of subjectRows) {
      if (!["submitted", "approved", "published", "locked"].includes(r.status)) continue;
      await ctx.db.patch(r._id, {
        status: "reopened",
        reopenedById: session.userId,
        reopenReason: reason.trim(),
        updatedAt: Date.now(),
      });
      const assessments = await ctx.db
        .query("assessments")
        .withIndex("by_class_subject_term", (q) =>
          q.eq("classSectionId", classSectionId).eq("subjectId", subjectId).eq("termId", termId),
        )
        .collect();
      for (const a of assessments) {
        if (a.status === "locked" || a.status === "published") {
          await ctx.db.patch(a._id, { status: "reopened", updatedAt: Date.now() });
        }
      }
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "results.reopened",
      entityType: "subjectResults",
      entityId: subjectId,
      description: `Results reopened — ${reason.trim()}`,
    });
    return { count: subjectRows.length };
  },
});

/** Result sheet for a class × subject × term (§44). */
export const sheet = query({
  args: { termId: v.id("terms"), classSectionId: v.id("classSections"), subjectId: v.id("subjects") },
  handler: async (ctx, { termId, classSectionId, subjectId }) => {
    const session = await requirePermission(ctx, "results.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "terms", termId);
    await getSchoolRecord(ctx, schoolId, "classSections", classSectionId);
    await getSchoolRecord(ctx, schoolId, "subjects", subjectId);

    if (session.role.role === "teacher") {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = staff.find((s) => s.userId === session.userId);
      const allocs = mine
        ? await ctx.db.query("teacherAllocations").withIndex("by_staff", (q) => q.eq("staffId", mine._id)).collect()
        : [];
      const ok = allocs.some(
        (a) => a.status === "active" && a.classSectionId === classSectionId && a.subjectId === subjectId,
      );
      if (!ok) throw new ConvexError("You are not allocated to this class for this subject.");
    }

    const results = await ctx.db
      .query("subjectResults")
      .withIndex("by_term_class", (q) => q.eq("termId", termId).eq("classSectionId", classSectionId))
      .collect();
    const subjectResults = results.filter((r) => r.subjectId === subjectId);
    const students = await Promise.all(
      subjectResults.map(async (r) => {
        const st = await ctx.db.get(r.studentId);
        return {
          studentId: r.studentId,
          admissionNumber: st?.admissionNumber ?? "",
          fullName: [st?.firstName, st?.middleName, st?.lastName].filter(Boolean).join(" "),
          totalScore: r.totalScore,
          percentage: r.percentage,
          gradeLabel: r.gradeLabel ?? null,
          status: r.status,
        };
      }),
    );
    const assessments = await ctx.db
      .query("assessments")
      .withIndex("by_class_subject_term", (q) =>
        q.eq("classSectionId", classSectionId).eq("subjectId", subjectId).eq("termId", termId),
      )
      .collect();
    return {
      rows: students.sort((a, b) => b.percentage - a.percentage),
      assessments: assessments
        .filter((a) => a.countsTowardFinal)
        .map((a) => ({ _id: a._id, title: a.title, maxMarks: a.maxMarks, weight: a.weight, status: a.status })),
      statusCounts: {
        draft: subjectResults.filter((r) => r.status === "draft").length,
        submitted: subjectResults.filter((r) => r.status === "submitted").length,
        approved: subjectResults.filter((r) => r.status === "approved").length,
        published: subjectResults.filter((r) => r.status === "published").length,
        reopened: subjectResults.filter((r) => r.status === "reopened").length,
      },
    };
  },
});

/** Aggregate status for the results overview page (per class × subject). */
export const overview = query({
  args: { termId: v.optional(v.id("terms")) },
  handler: async (ctx, { termId }) => {
    const session = await requirePermission(ctx, "results.view");
    const schoolId = session.schoolId as Id<"schools">;
    let effectiveTermId = termId;
    if (!effectiveTermId) {
      const t = await ctx.db
        .query("terms")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      effectiveTermId = t?._id;
    }
    if (!effectiveTermId) return [];
    const results = await ctx.db
      .query("subjectResults")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const termResults = results.filter((r) => r.termId === effectiveTermId);
    const byKey = new Map<string, typeof termResults>();
    for (const r of termResults) {
      const key = `${r.classSectionId}:${r.subjectId}`;
      const list = byKey.get(key) ?? [];
      list.push(r);
      byKey.set(key, list);
    }
    const rows = await Promise.all(
      [...byKey.entries()].map(async ([key, list]) => {
        const [classSectionId, subjectId] = key.split(":");
        const section = await ctx.db.get(classSectionId as Id<"classSections">);
        const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
        const subject = await ctx.db.get(subjectId as Id<"subjects">);
        const avg = list.reduce((s, r) => s + r.percentage, 0) / (list.length || 1);
        const statuses = list.map((r) => r.status);
        const worst = (s: string) => statuses.includes(s);
        return {
          classSectionId,
          classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
          subjectId,
          subjectName: subject?.name ?? "—",
          students: list.length,
          average: Math.round(avg * 10) / 10,
          status: worst("reopened")
            ? "reopened"
            : worst("submitted")
              ? "submitted"
              : worst("approved")
                ? "approved"
                : worst("published")
                  ? "published"
                  : "draft",
        };
      }),
    );
    return rows.sort((a, b) => a.classLabel.localeCompare(b.classLabel) || a.subjectName.localeCompare(b.subjectName));
  },
});

/** Student's own results across subjects for a term (profile tab §45). */
export const forStudent = query({
  args: { studentId: v.id("students"), termId: v.optional(v.id("terms")) },
  handler: async (ctx, { studentId, termId }) => {
    const session = await requirePermission(ctx, "results.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "students", studentId);
    const all = await ctx.db
      .query("subjectResults")
      .withIndex("by_student_term", (q) => q.eq("studentId", studentId))
      .collect();
    const filtered = termId ? all.filter((r) => r.termId === termId) : all;
    const enriched = await Promise.all(
      filtered.map(async (r) => {
        const subject = await ctx.db.get(r.subjectId);
        const term = await ctx.db.get(r.termId);
        return {
          termId: r.termId,
          termName: term?.name ?? "—",
          subjectName: subject?.name ?? "—",
          totalScore: r.totalScore,
          percentage: r.percentage,
          gradeLabel: r.gradeLabel ?? null,
          status: r.status,
        };
      }),
    );
    return enriched.sort((a, b) => a.termName.localeCompare(b.termName) || a.subjectName.localeCompare(b.subjectName));
  },
});
