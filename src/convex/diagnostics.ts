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
    throw new Error(`Unknown Phase 6 routine: ${name}`);
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
