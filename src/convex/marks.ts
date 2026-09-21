import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { MARK_STATUSES } from "./schema";
import { validateScoreRow, completeness, type ScoreInput } from "./engines/results";
import { assertTeacherAuthorized } from "./assessments";
import { activeEnrollmentsOnDate } from "./attendance";

/** Marks grid: roster (historical enrollment) + existing scores for an assessment. */
export const grid = query({
  args: { assessmentId: v.id("assessments") },
  handler: async (ctx, { assessmentId }) => {
    const session = await requirePermission(ctx, "marks.view");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assessments", assessmentId);

    // Teachers may only view marks for their own allocated assessments.
    if (session.role.role === "teacher") {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = staff.find((s) => s.userId === session.userId);
      if (a.staffId !== mine?._id) {
        throw new ConvexError("You can only view marks for your own assessments.");
      }
    }

    // Historical roster: students enrolled in the class on the assessment date.
    const roster = await activeEnrollmentsOnDate(ctx, a.classSectionId, a.assessmentDate);
    const scores = await ctx.db
      .query("assessmentScores")
      .withIndex("by_assessment", (q) => q.eq("assessmentId", assessmentId))
      .collect();
    const scoreByStudent = new Map(scores.map((s) => [s.studentId, s]));

    const rows = await Promise.all(
      roster.map(async (r) => {
        const st = await ctx.db.get(r.studentId);
        const sc = scoreByStudent.get(r.studentId);
        return {
          studentId: r.studentId,
          enrollmentId: r.enrollmentId,
          admissionNumber: st?.admissionNumber ?? "",
          fullName: [st?.firstName, st?.middleName, st?.lastName].filter(Boolean).join(" "),
          score: sc?.status === "entered" ? (sc.score ?? null) : null,
          markStatus: (sc?.status ?? "missing") as "entered" | "absent" | "exempt" | "missing",
          comment: sc?.comment ?? null,
        };
      }),
    );
    rows.sort((x, y) => x.fullName.localeCompare(y.fullName));

    const summary = completeness(
      rows.map((r) => ({ status: r.markStatus, weight: 0, maxMarks: a.maxMarks, countsTowardFinal: true, assessmentId: "", title: "" })),
      rows.length,
    );

    return {
      assessment: {
        _id: a._id,
        title: a.title,
        maxMarks: a.maxMarks,
        weight: a.weight,
        status: a.status,
        subjectName: (await ctx.db.get(a.subjectId))?.name ?? "—",
        assessmentDate: a.assessmentDate,
      },
      rows,
      summary,
      editable: a.status === "draft" || a.status === "open" || a.status === "marking" || a.status === "reopened",
    };
  },
});

/** Bulk save marks — one atomic mutation for the whole grid (§32, §34). */
export const saveGrid = mutation({
  args: {
    assessmentId: v.id("assessments"),
    marks: v.array(
      v.object({
        studentId: v.id("students"),
        enrollmentId: v.id("enrollments"),
        status: v.string(), // entered | absent | exempt
        score: v.optional(v.number()),
        comment: v.optional(v.string()),
      }),
    ),
    asDraft: v.optional(v.boolean()),
  },
  handler: async (ctx, { assessmentId, marks, asDraft }) => {
    const session = await requirePermission(ctx, "marks.enter");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assessments", assessmentId);

    // Authorization + lock enforcement.
    if (session.role.role === "teacher") {
      if (a.staffId) {
        const staff = await ctx.db
          .query("staff")
          .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
          .collect();
        const mine = staff.find((s) => s.userId === session.userId);
        if (a.staffId !== mine?._id) {
          throw new ConvexError("You can only enter marks for your own assessments.");
        }
      } else {
        await assertTeacherAuthorized(
          ctx, schoolId, session.userId, a.academicYearId, a.classSectionId, a.subjectId,
        );
      }
    }
    const editableStatuses = ["draft", "open", "marking", "reopened"];
    if (!editableStatuses.includes(a.status)) {
      throw new ConvexError(
        "These marks are locked because results have been submitted, approved or published. Ask an administrator to reopen them.",
      );
    }

    // Roster integrity (§74): every student must be enrolled in this class on the date.
    const roster = new Map(
      (await activeEnrollmentsOnDate(ctx, a.classSectionId, a.assessmentDate)).map((r) => [r.studentId, r.enrollmentId]),
    );

    for (const m of marks) {
      const status = m.status as (typeof MARK_STATUSES)[number];
      if (!MARK_STATUSES.includes(status)) throw new ConvexError("Unknown mark status.");
      const enrollmentId = roster.get(m.studentId);
      if (!enrollmentId) {
        throw new ConvexError("One of the students is not enrolled in this class for this assessment date.");
      }
      if (enrollmentId !== m.enrollmentId) {
        throw new ConvexError("Enrollment mismatch for one of the students.");
      }
      const err = validateScoreRow(m.score ?? null, a.maxMarks, status);
      if (err) throw new ConvexError(err);
    }

    const existing = await ctx.db
      .query("assessmentScores")
      .withIndex("by_assessment", (q) => q.eq("assessmentId", assessmentId))
      .collect();
    const byStudent = new Map(existing.map((e) => [e.studentId, e]));

    let changed = 0;
    for (const m of marks) {
      const prev = byStudent.get(m.studentId);
      const next = {
        status: m.status,
        score: m.status === "entered" ? m.score : undefined,
        comment: m.comment,
      };
      if (prev) {
        if (prev.status !== next.status || (next.status === "entered" && prev.score !== next.score) || prev.comment !== next.comment) {
          await ctx.db.patch(prev._id, {
            status: next.status,
            score: next.score,
            comment: next.comment,
            recordedById: session.userId,
            updatedAt: Date.now(),
          });
          changed++;
          if (prev.status === "entered" && prev.score !== undefined && next.status === "entered" && next.score !== prev.score) {
            await recordAudit(ctx, {
              userId: session.userId,
              schoolId,
              action: "marks.changed",
              entityType: "assessmentScores",
              entityId: prev._id,
              description: `Mark changed ${prev.score}/${a.maxMarks} → ${next.score}/${a.maxMarks}`,
              metadata: { assessmentId, studentId: m.studentId },
            });
          }
        }
      } else {
        await ctx.db.insert("assessmentScores", {
          schoolId,
          assessmentId,
          studentId: m.studentId,
          enrollmentId: m.enrollmentId,
          status: next.status,
          score: next.score,
          comment: next.comment,
          recordedById: session.userId,
          updatedAt: Date.now(),
        });
        changed++;
      }
    }

    if (!asDraft && a.status === "draft") {
      await ctx.db.patch(assessmentId, { status: "marking", updatedAt: Date.now() });
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "marks.saved",
      entityType: "assessments",
      entityId: assessmentId,
      description: `Marks saved for "${a.title}" (${changed} changed)`,
    });
    return { changed };
  },
});

/** Weighted preview for the grid footer — transparency of the calculation (§41). */
export const weightedPreview = query({
  args: { assessmentId: v.id("assessments") },
  handler: async (ctx, { assessmentId }) => {
    const session = await requirePermission(ctx, "marks.view");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assessments", assessmentId);
    const scores = await ctx.db
      .query("assessmentScores")
      .withIndex("by_assessment", (q) => q.eq("assessmentId", assessmentId))
      .collect();
    const entered = scores.filter((s) => s.status === "entered" && typeof s.score === "number");
    const avg =
      entered.length > 0
        ? Math.round((entered.reduce((sum, s) => sum + (s.score as number) / a.maxMarks, 0) / entered.length) * 1000) / 10
        : null;
    return {
      enteredCount: entered.length,
      averagePercent: avg,
      weight: a.weight,
      countsTowardFinal: a.countsTowardFinal,
    };
  },
});
