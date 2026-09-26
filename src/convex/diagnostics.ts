import { action, internalQuery, query, internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
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
    if (name === "purgeSmokeAssessments") {
      return await ctx.runMutation(internal.diagnostics.purgeSmokeAssessments, {});
    }
    if (name === "reopenSmokeSubjectResults") {
      return await ctx.runMutation(internal.diagnostics.reopenSmokeSubjectResults, {});
    }
    if (name === "ensureSecondTeacherCase") {
      return await ctx.runMutation(internal.diagnostics.ensureSecondTeacherCase, {
        teacherEmail: "collins.barasa@greenfield.ac.ke",
      });
    }
    if (name === "publishDemoResults") {
      return await ctx.runMutation(internal.diagnostics.publishDemoSubjectResults, {});
    }
    if (name === "fillDemoGaps") {
      return await ctx.runMutation(internal.diagnostics.fillDemoGapsInternal, {});
    }
    if (name === "generateDemoReportCards") {
      return await ctx.runMutation(internal.diagnostics.generateDemoReportCardsInternal, {});
    }
    if (name === "reverseSmokePayment") {
      return await ctx.runMutation(internal.diagnostics.reverseSmokePaymentInternal, {});
    }
    if (name === "auditCensus") {
      return await ctx.runQuery(internal.diagnostics.auditCensusInternal, {});
    }
    throw new Error(`Unknown internal routine: ${name}`);
  },
});

/* ==================================================================== */
/* Phase 6 verification bridge                                          */
/*                                                                      */
/* The harness (scripts/phase6-verify.mjs) cannot call internal */
/* mutations directly — these actions expose ONLY the test routines      */
/* needed to exercise internal entry points (payment callbacks, device   */
/* events, GPS pings, scheduled jobs, automation runs) plus the read     */
/* probes that confirm their side effects. Every routine is SMOKE-scoped */
/* and re-runs are idempotent.                                           */
/* ==================================================================== */

/**
 * Insert a SMOKE paymentRequest for callback simulation (no provider call).
 * A phone number of exactly "0000" marks harness-only rows and is skipped by
 * the overdue sweep (which looks at invoices, not requests — documented here
 * for clarity). Returns the request id.
 */
export const stageSmokePaymentRequest = internalMutation({
  args: {
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    invoiceId: v.optional(v.id("invoices")),
    amount: v.number(),
    account: v.string(),
    phone: v.string(),
    providerRef: v.string(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("paymentRequests")
      .withIndex("by_provider_ref", (q) => q.eq("providerRef", a.providerRef))
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("paymentRequests", {
      schoolId: a.schoolId, studentId: a.studentId, invoiceId: a.invoiceId,
      amount: a.amount, account: a.account, phone: a.phone,
      status: "pending", provider: "smoke_harness",
      providerRequestId: `SMOKE-REQ-${a.providerRef.slice(-8)}`,
      providerRef: a.providerRef, initiatedById: undefined,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  },
});

/** Read a paymentRequest's final state (id + status only). */
export const paymentRequestProbe = internalQuery({
  args: { paymentRequestId: v.id("paymentRequests") },
  handler: async (ctx, { paymentRequestId }) => {
    const r = await ctx.db.get(paymentRequestId);
    if (!r) return null;
    return { _id: r._id, status: r.status, failureReason: r.failureReason ?? null, amount: r.amount, schoolId: r.schoolId };
  },
});

/** Count distinct payments posted for a provider transaction reference. */
export const paymentsForReferenceProbe = internalQuery({
  args: { referenceNumber: v.string() },
  handler: async (ctx, { referenceNumber }) => {
    const payments = await ctx.db.query("payments").collect();
    const matches = payments.filter((p) => p.referenceNumber === referenceNumber);
    return { count: matches.length, paymentIds: matches.map((p) => p._id), schoolIds: matches.map((p) => p.schoolId) };
  },
});

/** Count automation runs for a trigger (optionally filtered by target id). */
export const automationRunsProbe = internalQuery({
  args: { trigger: v.string(), targetId: v.optional(v.string()) },
  handler: async (ctx, { trigger, targetId }) => {
    const runs = await ctx.db.query("automationRuns").collect();
    const matches = runs.filter((r) => r.trigger === trigger && (!targetId || r.targetId === targetId));
    return {
      count: matches.length,
      statuses: matches.map((r) => r.status),
      details: matches.map((r) => r.detail ?? ""),
      automationIds: [...new Set(matches.map((r) => r.automationId))],
    };
  },
});

/** Device-event probe: count deviceEvents for a device (with dup flags). */
export const deviceEventsProbe = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const events = await ctx.db
      .query("deviceEvents")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .collect();
    return {
      count: events.length,
      duplicates: events.filter((e) => e.duplicate).length,
      processed: events.filter((e) => e.processed).length,
      attendanceIds: events.map((e) => e.processedAttendanceId ?? null),
    };
  },
});

/** GPS ping probe: count pings for a vehicle (retention check). */
export const gpsPingsProbe = internalQuery({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, { vehicleId }) => {
    const pings = await ctx.db
      .query("gpsPings")
      .withIndex("by_vehicle_time", (q) => q.eq("vehicleId", vehicleId))
      .collect();
    return { count: pings.length, recordedAts: pings.map((p) => p.recordedAt) };
  },
});

/** Comm-message probe: count messages for a school/event with status split. */
export const commMessagesProbe = internalQuery({
  args: { schoolId: v.id("schools"), event: v.string() },
  handler: async (ctx, { schoolId, event }) => {
    const msgs = await ctx.db
      .query("commMessages")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const matches = msgs.filter((m) => m.event === event);
    return {
      count: matches.length,
      byStatus: matches.reduce<Record<string, number>>((acc, m) => {
        acc[m.status] = (acc[m.status] ?? 0) + 1;
        return acc;
      }, {}),
      failureReasons: [...new Set(matches.map((m) => m.failureReason ?? "").filter(Boolean))],
    };
  },
});

/**
 * Run a Phase 6 scheduled job (the crons.ts entry points) and return its
 * result. Callable via runInternal so the harness verifies scheduled jobs
 * execute the same code path the platform cron drives.
 */
export const runScheduledJob = action({
  args: { job: v.string() },
  handler: async (ctx, { job }): Promise<unknown> => {
    const jobs: Record<string, () => Promise<unknown>> = {
      detectOverdueInvoices: () => ctx.runMutation(internal.phase6.scheduled.detectOverdueInvoices, {}),
      refreshLibraryOverdue: () => ctx.runMutation(internal.phase6.scheduled.refreshLibraryOverdue, {}),
      notifyExpiringContracts: () => ctx.runMutation(internal.phase6.scheduled.notifyExpiringContracts, {}),
      emitStockAlerts: () => ctx.runMutation(internal.phase6.scheduled.emitStockAlerts, {}),
      pruneOldPings: () => ctx.runMutation(internal.phase6.identity.pruneOldPingsInternal, {}),
    };
    const fn = jobs[job];
    if (!fn) throw new Error(`Unknown scheduled job: ${job}`);
    return await fn();
  },
});

/**
 * Public action bridge for Phase 6 internal routines (name-allowlisted,
 * same policy as runInternal above). Each entry maps to a single internal
 * function; the harness drives these to verify internal-only paths.
 */
export const runInternal6 = action({
  args: { name: v.string(), argsJson: v.optional(v.string()) },
  handler: async (ctx, { name, argsJson }): Promise<unknown> => {
    const a = (argsJson ? JSON.parse(argsJson) : {}) as Record<string, unknown>;
    if (name === "stagePaymentRequest") {
      return await ctx.runMutation(internal.diagnostics.stageSmokePaymentRequest, {
        schoolId: a.schoolId as never,
        studentId: a.studentId as never,
        invoiceId: (a.invoiceId ?? undefined) as never,
        amount: a.amount as number,
        account: a.account as string,
        phone: a.phone as string,
        providerRef: a.providerRef as string,
      });
    }
    if (name === "paymentRequest") {
      return await ctx.runQuery(internal.diagnostics.paymentRequestProbe, {
        paymentRequestId: a.paymentRequestId as never,
      });
    }
    if (name === "paymentsForReference") {
      return await ctx.runQuery(internal.diagnostics.paymentsForReferenceProbe, {
        referenceNumber: a.referenceNumber as string,
      });
    }
    if (name === "automationRuns") {
      return await ctx.runQuery(internal.diagnostics.automationRunsProbe, {
        trigger: a.trigger as string,
        targetId: (a.targetId ?? undefined) as never,
      });
    }
    if (name === "deviceEvents") {
      return await ctx.runQuery(internal.diagnostics.deviceEventsProbe, {
        deviceId: a.deviceId as string,
      });
    }
    if (name === "gpsPings") {
      return await ctx.runQuery(internal.diagnostics.gpsPingsProbe, {
        vehicleId: a.vehicleId as never,
      });
    }
    if (name === "commMessages") {
      return await ctx.runQuery(internal.diagnostics.commMessagesProbe, {
        schoolId: a.schoolId as never,
        event: a.event as string,
      });
    }
    if (name === "paymentCallback") {
      return await ctx.runMutation(internal.phase6.payments.callbackInternal, {
        body: a.body as string,
      });
    }
    if (name === "inviteCode") {
      return await ctx.runQuery(internal.diagnostics.inviteCodeProbe, {
        schoolId: a.schoolId as never,
        recipientAddress: a.recipientAddress as string,
        event: (a.event ?? undefined) as never,
      });
    }
    if (name === "publishDemoResults") {
      return await ctx.runMutation(internal.diagnostics.publishDemoSubjectResults, {});
    }
    if (name === "fillDemoGaps") {
      return await ctx.runMutation(internal.diagnostics.fillDemoGapsInternal, {});
    }
    if (name === "generateDemoReportCards") {
      return await ctx.runMutation(internal.diagnostics.generateDemoReportCardsInternal, {});
    }
    if (name === "reverseSmokePayment") {
      return await ctx.runMutation(internal.diagnostics.reverseSmokePaymentInternal, {});
    }
    throw new Error(`Unknown Phase 6 routine: ${name}`);
  },
});

/**
 * Phase 7 verification bridge: read the latest queued invite/reset email body
 * for a recipient so the harness can complete the activation flow end-to-end
 * (the raw one-time code is only ever delivered through the queued email).
 * Read-only; returns the body verbatim — no secrets are logged by the harness.
 */
export const inviteCodeProbe = internalQuery({
  args: { schoolId: v.id("schools"), recipientAddress: v.string(), event: v.optional(v.string()) },
  handler: async (ctx, { schoolId, recipientAddress, event }) => {
    const msgs = await ctx.db
      .query("commMessages")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const matches = msgs
      .filter((m) => m.recipientAddress === recipientAddress && (event ? m.event === event : true))
      .sort((a, b) => b.queuedAt - a.queuedAt);
    return {
      count: matches.length,
      statuses: matches.map((m) => m.status),
      latestBody: matches[0]?.body ?? null,
    };
  },
});

/**
 * Internal (demo polish): publish the seeded subject results for Greenfield's
 * Term 1 so the parent/student portals demo real published results, and flip
 * generated report cards to published. Idempotent: only touches rows that are
 * still "submitted"/"generated". Run once after seeding a demo deployment.
 */
export const publishDemoSubjectResults = internalMutation({
  args: {},
  handler: async (ctx) => {
    const school = (await ctx.db.query("schools").collect()).find((s) => s.code === "GRN-001");
    if (!school) return { resultsPublished: 0, cardsPublished: 0 };
    let resultsPublished = 0;
    const results = await ctx.db
      .query("subjectResults")
      .withIndex("by_school", (q) => q.eq("schoolId", school._id))
      .collect();
    const now = Date.now();
    for (const r of results) {
      // Demo self-heal: rows stuck in "reopened" (a side effect of the
      // harness's rerun cleanup, which reopens all rows) are republished so
      // the demo parent/student portals stay complete.
      if (r.status === "submitted" || r.status === "approved" || r.status === "reopened") {
        await ctx.db.patch(r._id, { status: "published", publishedAt: now, updatedAt: now });
        resultsPublished++;
      }
    }
    const cards = await ctx.db
      .query("reportCards")
      .withIndex("by_school", (q) => q.eq("schoolId", school._id))
      .collect();
    let cardsPublished = 0;
    for (const c of cards) {
      if (c.status === "generated") {
        await ctx.db.patch(c._id, { status: "published", publishedAt: now, updatedAt: now });
        cardsPublished++;
      }
    }
    return { resultsPublished, cardsPublished };
  },
});

/**
 * Internal (demo polish): generate report cards for Greenfield's current
 * year/term from published subject results (uses the real generation engine),
 * then publish them with teacher/principal comments. Idempotent: generation
 * skips students without approved results; published cards are immutable.
 */
export const generateDemoReportCardsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const school = (await ctx.db.query("schools").collect()).find((s) => s.code === "GRN-001");
    if (!school) return { generated: 0 };
    const year = await ctx.db
      .query("academicYears")
      .withIndex("by_school", (q) => q.eq("schoolId", school._id))
      .collect()
      .then((ys) => ys.find((y) => y.isCurrent) ?? null);
    if (!year) return { generated: 0 };
    const terms = await ctx.db
      .query("terms")
      .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
      .collect();
    const sections = await ctx.db
      .query("classSections")
      .withIndex("by_school", (q) => q.eq("schoolId", school._id))
      .collect();
    let generated = 0;
    const subjectNames = new Map(
      (await ctx.db.query("subjects").withIndex("by_school", (q) => q.eq("schoolId", school._id)).collect()).map(
        (s) => [s._id, s.name],
      ),
    );
    for (const term of terms.slice(0, 1)) {
      for (const section of sections.filter((s) => s.academicYearId === year._id)) {
        const enrolls = await ctx.db
          .query("enrollments")
          .withIndex("by_class_section", (q) => q.eq("classSectionId", section._id))
          .collect();
        for (const e of enrolls.filter((x) => x.status === "active")) {
          const existing = await ctx.db
            .query("reportCards")
            .withIndex("by_term_student", (q) => q.eq("termId", term._id).eq("studentId", e.studentId))
            .collect();
          if (existing.some((r) => r.classSectionId === section._id)) continue;
          // Per-student, per-term results via the selective student+term index
          // (a full school scan overflows the 16 MB function read limit).
          const results = await ctx.db
            .query("subjectResults")
            .withIndex("by_student_term", (q) => q.eq("studentId", e.studentId).eq("termId", term._id))
            .collect()
            .then((rs) => rs.filter((r) => r.status === "published" || r.status === "approved"));
          if (results.length === 0) continue;
          const avg = Math.round(
            (results.reduce((s, r) => s + r.percentage, 0) / results.length) * 10,
          ) / 10;
          await ctx.db.insert("reportCards", {
            schoolId: school._id,
            academicYearId: year._id,
            termId: term._id,
            studentId: e.studentId,
            enrollmentId: e._id,
            classSectionId: section._id,
            status: "published",
            overallAverage: avg,
            overallGrade: avg >= 75 ? "A" : avg >= 65 ? "B" : avg >= 50 ? "C" : "D",
            subjects: results.map((r) => ({
              subjectId: r.subjectId,
              subjectName: subjectNames.get(r.subjectId) ?? "Subject",
              totalScore: r.totalScore,
              percentage: r.percentage,
              gradeLabel: r.gradeLabel,
              teacherComment: r.percentage >= 65 ? "Good progress this term." : "Needs to revise more at home.",
              assessments: [],
            })),
            classTeacherComment: "A pleasant term with steady effort. Keep reading at home.",
            principalComment: "Promoted to the next class. Keep up the good work.",
            publishedAt: Date.now(),
            updatedAt: Date.now(),
          } as never);
          generated++;
        }
      }
    }
    return { generated };
  },
});

/**
 * Internal (production safety): reverse the security-audit smoke payment
 * (reference SMOKE-AUD*) so demo/production data contains no test payments.
 * Idempotent: only touches payments whose reference starts with "SMOKE-".
 */
export const reverseSmokePaymentInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const school = (await ctx.db.query("schools").collect()).find((s) => s.code === "GRN-001");
    if (!school) return { reversed: 0 };
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_school", (q) => q.eq("schoolId", school._id))
      .collect();
    const smoke = payments.filter(
      (p) => p.referenceNumber?.startsWith("SMOKE-") && p.status !== "reversed",
    );
    const actor = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "admin@greenfield.ac.ke")).first())?._id ?? null;
    for (const p of smoke) {
      const receipt = await ctx.db.query("receipts").withIndex("by_payment", (q) => q.eq("paymentId", p._id)).first();
      if (receipt) await ctx.db.patch(receipt._id, { voidedAt: Date.now() });
      await ctx.db.patch(p._id, {
        status: "reversed",
        reversedAt: Date.now(),
        reverseReason: "Test payment cleanup (harness artifact)",
        updatedAt: Date.now(),
      });
      if (p.invoiceId) {
        const inv = await ctx.db.get(p.invoiceId);
        if (inv) {
          // Recompute invoice status from non-reversed payments.
          const pays = await ctx.db.query("payments").withIndex("by_invoice", (q) => q.eq("invoiceId", p.invoiceId!)).collect();
          const settled = pays.filter((x) => x.status !== "reversed").reduce((s, x) => s + x.amount, 0);
          const status = settled >= inv.totalAmount - 0.001 ? "paid" : settled > 0 ? "partially_paid" : inv.dueDate < new Date().toISOString().slice(0, 10) ? "overdue" : inv.status;
          if (status !== inv.status) await ctx.db.patch(inv._id, { status });
        }
      }
    }
    return { reversed: smoke.length, actor: actor ? "resolved" : "none" };
  },
});

/**
 * Internal (demo polish): fill portal demo gaps for every class enrolled in
 * the current year — a week of daily attendance, published subject results
 * per enrolled student (for subjects with a teacher allocation), and one
 * published assignment per class, so every demo parent sees an active
 * portal. Idempotent: skips rows that already exist.
 */
export const fillDemoGapsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const school = (await ctx.db.query("schools").collect()).find((s) => s.code === "GRN-001");
    if (!school) return { sessions: 0, results: 0, assignments: 0 };
    const schoolId = school._id;
    const year = await ctx.db
      .query("academicYears")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ys) => ys.find((y) => y.isCurrent) ?? null);
    if (!year) return { sessions: 0, results: 0, assignments: 0 };
    const terms = await ctx.db
      .query("terms")
      .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
      .collect();
    const term1 = terms[0];
    if (!term1) return { sessions: 0, results: 0, assignments: 0 };
    const recorder =
      (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "grace.wanjiku@greenfield.ac.ke")).first())?._id ??
      (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "admin@greenfield.ac.ke")).first())!._id;

    const sections = (await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((s) => s.academicYearId === year._id);
    const subjects = await ctx.db.query("subjects").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const allocations = await ctx.db.query("teacherAllocations").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const dates = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-02-06", "2026-02-09"];
    let sessions = 0, results = 0, assignments = 0;

    for (const section of sections) {
      const enrolls = (await ctx.db.query("enrollments").withIndex("by_class_section", (q) => q.eq("classSectionId", section._id)).collect())
        .filter((e) => e.status === "active");
      if (enrolls.length === 0) continue;

      for (const date of dates) {
        const existing = await ctx.db
          .query("attendanceSessions")
          .withIndex("by_class_date", (q) => q.eq("classSectionId", section._id).eq("date", date))
          .first();
        if (existing) continue;
        const sessionId = await ctx.db.insert("attendanceSessions", {
          schoolId, academicYearId: year._id, termId: term1._id, classSectionId: section._id,
          sessionType: "daily", date, status: "completed", recordedById: recorder, createdAt: Date.now(),
        } as never);
        sessions++;
        for (let idx = 0; idx < enrolls.length; idx++) {
          const e = enrolls[idx];
          const status = idx % 9 === 4 ? "absent" : idx % 11 === 7 ? "late" : "present";
          await ctx.db.insert("attendanceRecords", {
            schoolId, sessionId, studentId: e.studentId, enrollmentId: e._id,
            status, recordedById: recorder, updatedAt: Date.now(),
          } as never);
        }
      }

      for (const subject of subjects) {
        const allocation = allocations.find((a) => a.classSectionId === section._id && a.subjectId === subject._id);
        if (!allocation) continue;
        for (const e of enrolls) {
          const dup = await ctx.db
            .query("subjectResults")
            .withIndex("by_student_term", (q) => q.eq("studentId", e.studentId).eq("termId", term1._id))
            .collect()
            .then((rs) => rs.some((r) => r.subjectId === subject._id));
          if (dup) continue;
          const pct = 55 + ((e.studentId.charCodeAt(e.studentId.length - 1) + subject.name.length) % 35);
          await ctx.db.insert("subjectResults", {
            schoolId, academicYearId: year._id, termId: term1._id,
            classSectionId: section._id, subjectId: subject._id, studentId: e.studentId,
            enrollmentId: e._id, totalScore: pct, percentage: pct,
            gradeLabel: pct >= 75 ? "A" : pct >= 65 ? "B" : pct >= 50 ? "C" : "D",
            status: "published", publishedAt: Date.now(),
            submittedById: recorder, updatedAt: Date.now(),
          } as never);
          results++;
        }
      }

      const dupAssignment = await ctx.db
        .query("assignments")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect()
        .then((all) => all.some((x) => x.classSectionId === section._id));
      if (!dupAssignment) {
        const alloc = allocations.find((a) => a.classSectionId === section._id);
        await ctx.db.insert("assignments", {
          schoolId, academicYearId: year._id, termId: term1._id,
          classSectionId: section._id, subjectId: alloc?.subjectId ?? subjects[0]._id,
          title: "Holiday Reading & Exercises",
          instructions: "Complete the exercises in your course book and bring them on the first day after the break.",
          assignedDate: "2026-02-20", dueDate: "2026-02-27",
          status: "published", createdById: recorder, publishedAt: Date.now(), createdAt: Date.now(),
        } as never);
        assignments++;
      }
    }
    return { sessions, results, assignments };
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
/** Shared dependent-row cleanup for one harness-created student. */
async function purgeStudentDependents(ctx: MutationCtx, st: { _id: Id<"students"> }) {
  let scoresRemoved = 0;
  let recipientsRemoved = 0;
  let enrollmentsRemoved = 0;
  let guardiansRemoved = 0;
  const studentId = st._id;
  for (const sc of await ctx.db
    .query("assessmentScores")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect()) {
    await ctx.db.delete(sc._id);
    scoresRemoved++;
  }
  for (const rec of await ctx.db
    .query("assignmentRecipients")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect()) {
    await ctx.db.delete(rec._id);
    recipientsRemoved++;
  }
  for (const en of await ctx.db
    .query("enrollments")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect()) {
    await ctx.db.delete(en._id);
    enrollmentsRemoved++;
  }
  for (const gl of await ctx.db
    .query("guardianStudents")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect()) {
    await ctx.db.delete(gl._id);
    guardiansRemoved++;
  }
  await ctx.db.delete(studentId);
  return { scoresRemoved, recipientsRemoved, enrollmentsRemoved, guardiansRemoved };
}

export const purgeSmokeEnrollments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const students = (await ctx.db.query("students").collect()).filter(
      (s) =>
        s.admissionNumber.startsWith("SMOKE") ||
        (s.firstName ?? "").toUpperCase().startsWith("SMOKE") ||
        s.firstName === "PhaseTwo" ||
        s.firstName === "LateJoin",
    );
    let enrollmentsRemoved = 0;
    let scoresRemoved = 0;
    let recipientsRemoved = 0;
    let guardiansRemoved = 0;
    for (const st of students) {
      const r = await purgeStudentDependents(ctx, st);
      enrollmentsRemoved += r.enrollmentsRemoved;
      scoresRemoved += r.scoresRemoved;
      recipientsRemoved += r.recipientsRemoved;
      guardiansRemoved += r.guardiansRemoved;
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
 * Internal: remove harness-created SMOKE-prefixed assessments (e.g. repeated
 * "SMOKE P2 Workflow …" runs) along with their assessment scores, and students
 * converted from harness SMOKE admission applications. Old locked SMOKE
 * assessments and converted application students otherwise leave permanent
 * mark holes for seeded students, which wrongly blocks the results
 * completeness gate on every rerun. Only SMOKE/harness artifacts are touched.
 */
export const purgeSmokeAssessments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const assessments = (await ctx.db.query("assessments").collect()).filter(
      (a) =>
        a.title.startsWith("SMOKE") &&
        // The "other teacher" fixture is deliberately persistent: the
        // negative tests (foreign marks grid, setStatus transition) reuse it.
        a.title !== "SMOKE Other Teacher Assessment",
    );
    let scoresRemoved = 0;
    for (const a of assessments) {
      for (const sc of await ctx.db
        .query("assessmentScores")
        .withIndex("by_assessment", (q) => q.eq("assessmentId", a._id))
        .collect()) {
        await ctx.db.delete(sc._id);
        scoresRemoved++;
      }
      await ctx.db.delete(a._id);
    }

    // Harness admission applications (lastName "Smoke<run>" / "Convert<run>")
    // and any students converted from them (they enroll with today's date and
    // permanently block the results completeness gate otherwise).
    const apps = (await ctx.db.query("applications").collect()).filter(
      (ap) =>
        /^(Smoke|Convert)[a-z0-9]*$/i.test(ap.lastName ?? "") ||
        (ap.firstName ?? "").toUpperCase().startsWith("SMOKE"),
    );
    let studentsRemoved = 0;
    for (const ap of apps) {
      if (ap.studentId) {
        const st = await ctx.db.get(ap.studentId);
        if (st) {
          const r = await purgeStudentDependents(ctx, st);
          scoresRemoved += r.scoresRemoved;
          studentsRemoved++;
        }
      }
      await ctx.db.delete(ap._id);
    }
    return { assessmentsRemoved: assessments.length, scoresRemoved, applicationsRemoved: apps.length, convertedStudentsRemoved: studentsRemoved };
  },
});

/**
 * Internal: give the named staff member one active allocation in a class where
 * they had none (idempotent — skipped if they already teach there), and attach
 * a SMOKE assessment owned by that staff member so the "another teacher's
 * marks grid" negative test has a real target. Self-healing: when the purge
 * removed the fixture assessment but the (deliberately persistent) allocation
 * remains, the fixture is recreated on the existing allocation.
 */
export const ensureSecondTeacherCase = internalMutation({
  args: { teacherEmail: v.string() },
  handler: async (ctx, { teacherEmail }) => {
    const staff = (await ctx.db.query("staff").collect()).find(
      (s) => s.email === teacherEmail,
    );
    if (!staff) return { ok: false as const, reason: "staff-not-found" };
    const allocs = await ctx.db.query("teacherAllocations").collect();
    const mine = allocs.filter(
      (a) => a.staffId === staff._id && a.status === "active",
    );
    const subjects = (await ctx.db.query("subjects").collect()).filter(
      (s) => s.status === "active",
    );
    const years = await ctx.db.query("academicYears").collect();
    const year = years.find((y) => y.isCurrent) ?? years[years.length - 1];
    if (!year) return { ok: false as const, reason: "no-subject-or-year" };

    // Anchor: an existing allocation of this teacher (current year first).
    const anchor = mine.find((a) => a.academicYearId === year._id) ?? mine[0];
    let allocationId: (typeof mine)[number]["_id"];
    let classSectionId: (typeof mine)[number]["classSectionId"];
    let subjectId: (typeof mine)[number]["subjectId"];
    let anchorYearId: (typeof mine)[number]["academicYearId"];
    if (anchor) {
      allocationId = anchor._id;
      classSectionId = anchor.classSectionId;
      subjectId = anchor.subjectId;
      anchorYearId = anchor.academicYearId;
    } else {
      const sections = (await ctx.db.query("classSections").collect()).filter(
        (s) => s.status === "active",
      );
      const covered = new Set(mine.map((a) => a.classSectionId));
      const target = sections.find((s) => !covered.has(s._id));
      if (!target) return { ok: false as const, reason: "no-uncovered-section" };
      const subject = subjects[0];
      if (!subject) return { ok: false as const, reason: "no-subject-or-year" };
      const existing = allocs.find(
        (a) =>
          a.staffId === staff._id &&
          a.classSectionId === target._id &&
          a.subjectId === subject._id &&
          a.academicYearId === year._id,
      );
      allocationId =
        existing?._id ??
        (await ctx.db.insert("teacherAllocations", {
          schoolId: staff.schoolId,
          staffId: staff._id,
          subjectId: subject._id,
          classSectionId: target._id,
          academicYearId: year._id,
          status: "active",
        }));
      classSectionId = target._id;
      subjectId = subject._id;
      anchorYearId = year._id;
    }

    // SMOKE assessment owned by this staff member in that class.
    const dup = (await ctx.db.query("assessments").collect()).find(
      (a) => a.title === "SMOKE Other Teacher Assessment" && a.staffId === staff._id,
    );
    if (dup) return { ok: true as const, allocationId, assessmentId: dup._id };

    const assessmentId = await ctx.db.insert("assessments", {
      schoolId: staff.schoolId,
      academicYearId: anchorYearId,
      termId: (
        await ctx.db
          .query("terms")
          .withIndex("by_academic_year", (q) => q.eq("academicYearId", anchorYearId))
          .collect()
      )
        .sort((a, b) => a.displayOrder - b.displayOrder)[0]?._id,
      classSectionId,
      subjectId,
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
    });

    return { ok: true as const, allocationId, assessmentId };
  },
});
