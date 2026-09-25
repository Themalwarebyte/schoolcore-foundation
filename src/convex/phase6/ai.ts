/**
 * Phase 6 — AI-assisted analytics.
 *
 * SAFETY RULES (spec §28–§31):
 *  - Insights are ADVISORY ONLY and always labeled AI-generated.
 *  - Deterministic, evidence-based computations over data the caller is
 *    already permitted to see. No external AI provider is required, so no
 *    school data ever leaves the platform.
 *  - Medical and payroll data are NEVER included.
 *  - High-stakes decisions (discipline, admissions, scholarships, promotion,
 *    termination, diagnosis) are explicitly out of scope.
 */
import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePermission } from "../session";

interface Insight {
  key: string;
  title: string;
  summary: string;
  evidence: string[];
  severity: "info" | "watch" | "positive";
}

/**
 * School-wide insights: attendance + academic + fee trends.
 * Administration-level surface only: teachers hold ai.view for their own
 * scoped insights (teacherInsights) but never school-wide aggregates.
 */
const SCHOOL_INSIGHT_ROLES = ["school_admin", "principal", "super_admin"] as const;
export const schoolInsights = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "ai.view");
    const schoolId = session.schoolId as Id<"schools">;
    if (!SCHOOL_INSIGHT_ROLES.includes(session.role.role as never)) {
      throw new ConvexError("School-wide AI insights are limited to administrators.");
    }
    const insights: Insight[] = [];

    /* Attendance trend -------------------------------------------------- */
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const sessionIds = new Set(sessions.map((s) => s._id));
    const records = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const byMonth = new Map<string, { present: number; total: number }>();
    for (const r of records) {
      if (!sessionIds.has(r.sessionId)) continue;
      const s = sessions.find((x) => x._id === r.sessionId)!;
      const month = s.date.slice(0, 7);
      const bucket = byMonth.get(month) ?? { present: 0, total: 0 };
      bucket.total += 1;
      if (r.status === "present" || r.status === "late") bucket.present += 1;
      byMonth.set(month, bucket);
    }
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (months.length >= 2) {
      const [prevMonth, prev] = months[months.length - 2];
      const [curMonth, cur] = months[months.length - 1];
      const prevRate = prev.total ? (prev.present / prev.total) * 100 : 0;
      const curRate = cur.total ? (cur.present / cur.total) * 100 : 0;
      const delta = Math.round((curRate - prevRate) * 10) / 10;
      insights.push({
        key: "attendance_trend",
        title: "Attendance trend",
        summary:
          `Attendance is ${curRate.toFixed(1)}% in ${curMonth}, ` +
          `${delta >= 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} percentage points from ${prevMonth} (${prevRate.toFixed(1)}%).`,
        evidence: [`${prevMonth}: ${prev.present}/${prev.total}`, `${curMonth}: ${cur.present}/${cur.total}`],
        severity: delta < -2 ? "watch" : delta > 2 ? "positive" : "info",
      });
    }

    /* Fee collection ---------------------------------------------------- */
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const totalBilled = invoices
      .filter((i) => i.status !== "cancelled")
      .reduce((s, i) => s + i.totalAmount, 0);
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const totalPaid = payments
      .filter((p) => p.status === "confirmed")
      .reduce((s, p) => s + p.amount, 0);
    if (totalBilled > 0) {
      const rate = Math.round((totalPaid / totalBilled) * 1000) / 10;
      const outstanding = totalBilled - totalPaid;
      insights.push({
        key: "fee_collection",
        title: "Fee collection",
        summary: `Fee collection stands at ${rate}% of billed fees. ${Math.round(outstanding).toLocaleString()} remains outstanding across ${invoices.filter((i) => i.status !== "paid").length} invoice(s).`,
        evidence: [`Billed: ${Math.round(totalBilled).toLocaleString()}`, `Collected: ${Math.round(totalPaid).toLocaleString()}`],
        severity: rate < 70 ? "watch" : rate > 90 ? "positive" : "info",
      });
    }

    /* Class performance summary (top movers) ---------------------------- */
    const results = await ctx.db
      .query("subjectResults")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((rs) => rs.filter((r) => r.status === "published"));
    if (results.length >= 10) {
      const bySubject = new Map<string, number[]>();
      for (const r of results) {
        const pct = r.percentage;
        const list = bySubject.get(r.subjectId) ?? [];
        list.push(pct);
        bySubject.set(r.subjectId, list);
      }
      const subjectNames = new Map<string, string>();
      for (const subjectId of bySubject.keys()) {
        const s = await ctx.db.get(subjectId as Id<"subjects">);
        if (s) subjectNames.set(subjectId, s.name);
      }
      const averages = [...bySubject.entries()]
        .map(([subjectId, list]) => ({
          subject: subjectNames.get(subjectId) ?? "Subject",
          avg: list.reduce((s, p) => s + p, 0) / list.length,
        }))
        .sort((a, b) => b.avg - a.avg);
      if (averages.length >= 2) {
        insights.push({
          key: "subject_performance",
          title: "Subject performance",
          summary: `Strongest subject: ${averages[0].subject} (${averages[0].avg.toFixed(1)}% average). Lowest: ${averages[averages.length - 1].subject} (${averages[averages.length - 1].avg.toFixed(1)}% average) — consider targeted support.`,
          evidence: averages.slice(0, 3).map((a) => `${a.subject}: ${a.avg.toFixed(1)}%`),
          severity: "info",
        });
      }
    }

    return {
      advisoryNotice: "AI-generated insight — review before acting.",
      generatedAt: Date.now(),
      insights,
    };
  },
});

/** Teacher insights: own-subject class performance across assessments. */
export const teacherInsights = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "ai.view");
    const schoolId = session.schoolId as Id<"schools">;
    const insights: Insight[] = [];
    if (session.role.role !== "teacher") {
      return { advisoryNotice: "AI-generated insight — review before acting.", generatedAt: Date.now(), insights };
    }
    const staff = await ctx.db
      .query("staff")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ss) => ss.find((s) => s.userId === session.userId));
    if (!staff) return { advisoryNotice: "AI-generated insight — review before acting.", generatedAt: Date.now(), insights };
    const scores = await ctx.db
      .query("assessmentScores")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ss) => ss.filter((s) => s.recordedById === session.userId || s.status === "entered"));
    const entered = scores.filter((s) => s.status === "entered" && s.score !== undefined);
    if (entered.length >= 5) {
      const avg = entered.reduce((s, x) => s + (x.score ?? 0), 0) / entered.length;
      insights.push({
        key: "marks_entered",
        title: "Marks entered",
        summary: `You have ${entered.length} entered mark(s) averaging ${avg.toFixed(1)} across your assessments.`,
        evidence: [`${entered.length} marks`, `Average ${avg.toFixed(1)}`],
        severity: "info",
      });
    }
    return { advisoryNotice: "AI-generated insight — review before acting.", generatedAt: Date.now(), insights };
  },
});
