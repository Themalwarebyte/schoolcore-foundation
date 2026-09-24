import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { requirePermission, requireAnyPermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

/* ================================================================== */
/* Identity resolution — the heart of portal security                   */
/* ================================================================== */

/**
 * Resolve the signed-in parent to their Guardian record via the controlled
 * guardianPortalLinks table. Active link + same school + active guardian
 * are all enforced here; every parent query starts from this function.
 */
async function parentIdentity(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
  userId: Id<"users">,
): Promise<Doc<"guardians">> {
  const link = await ctx.db
    .query("guardianPortalLinks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("status"), "active"))
    .first();
  if (!link || link.schoolId !== schoolId) {
    throw new ConvexError("No parent portal link found for this account.");
  }
  const guardian = await ctx.db.get(link.guardianId);
  if (!guardian || guardian.schoolId !== schoolId || guardian.status !== "active") {
    throw new ConvexError("Parent record is not active.");
  }
  return guardian;
}

/** Resolve the signed-in student to their Student record the same way. */
async function studentIdentity(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
  userId: Id<"users">,
): Promise<Doc<"students">> {
  const link = await ctx.db
    .query("studentPortalLinks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("status"), "active"))
    .first();
  if (!link || link.schoolId !== schoolId) {
    throw new ConvexError("No student portal link found for this account.");
  }
  const student = await ctx.db.get(link.studentId);
  if (!student || student.schoolId !== schoolId || student.studentStatus !== "active") {
    throw new ConvexError("Student record is not active.");
  }
  return student;
}

/** Day label map for timetable display (DAYS_OF_WEEK → names). */
const DAY_NAMES: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};
const DAY_ORDER: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/* ================================================================== */
/* Parent portal                                                        */
/* ================================================================== */

export const parentChildren = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const guardian = await parentIdentity(ctx, schoolId, session.userId);
    const links = await ctx.db
      .query("guardianStudents")
      .withIndex("by_guardian", (q) => q.eq("guardianId", guardian._id))
      .collect();
    const children = [];
    for (const link of links) {
      const student = await ctx.db.get(link.studentId);
      if (!student || student.schoolId !== schoolId || student.studentStatus !== "active") continue;
      const enrollment = await ctx.db
        .query("enrollments")
        .withIndex("by_student", (q) => q.eq("studentId", student._id))
        .collect()
        .then((es) => es.filter((e) => e.status === "active").pop());
      const classSection = enrollment
        ? await ctx.db.get(enrollment.classSectionId)
        : null;
      const grade = classSection ? await ctx.db.get(classSection.gradeLevelId) : null;
      children.push({
        studentId: student._id,
        name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
        admissionNumber: student.admissionNumber,
        relationship: link.relationship ?? null,
        className: classSection ? `${grade?.name ?? "Grade"} ${classSection.streamName ?? ""}`.trim() : null,
        classSectionId: classSection?._id ?? null,
      });
    }
    return { guardian: { name: [guardian.firstName, guardian.lastName].filter(Boolean).join(" ") }, children };
  },
});

/**
 * Authorize a parent's access to one child: the child must be connected to
 * the caller's guardian record in the same school. Returns the student.
 */
async function authorizeChild(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
  userId: Id<"users">,
  studentId: Id<"students">,
): Promise<Doc<"students">> {
  const guardian = await parentIdentity(ctx, schoolId, userId);
  const link = await ctx.db
    .query("guardianStudents")
    .withIndex("by_guardian_student", (q) => q.eq("guardianId", guardian._id).eq("studentId", studentId))
    .first();
  if (!link) throw new ConvexError("This student is not linked to your account.");
  const student = await ctx.db.get(studentId);
  if (!student || student.schoolId !== schoolId || student.studentStatus !== "active") {
    throw new ConvexError("Student not found in your school.");
  }
  return student;
}

export const parentChildOverview = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await authorizeChild(ctx, schoolId, session.userId, studentId);

    const today = new Date().toISOString().slice(0, 10);
    const year = await ctx.db
      .query("academicYears")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ys) => ys.find((y) => y.isCurrent) ?? null);
    const term = year
      ? await ctx.db
          .query("terms")
          .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
          .collect()
          .then((ts) => ts.find((t) => t.isCurrent) ?? null)
      : null;

    // Attendance summary: daily sessions only (lesson sessions excluded to
    // avoid double counting — same rule as staff analytics).
    const sessions = term
      ? await ctx.db
          .query("attendanceSessions")
          .withIndex("by_school_term", (q) => q.eq("schoolId", schoolId).eq("termId", term._id))
          .collect()
          .then((ss) => ss.filter((s) => s.sessionType === "daily"))
      : [];
    let present = 0, absent = 0, late = 0, excused = 0;
    for (const s of sessions) {
      const rec = await ctx.db
        .query("attendanceRecords")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .filter((q) => q.eq(q.field("studentId"), student._id))
        .first();
      if (!rec) continue;
      if (rec.status === "present") present++;
      else if (rec.status === "absent") absent++;
      else if (rec.status === "late") late++;
      else if (rec.status === "excused") excused++;
    }
    const marked = present + absent + late + excused;
    const attendancePct = marked > 0 ? Math.round(((present + late) / marked) * 100) : null;

    // Finance: latest invoice totals from the invoices table (live statuses).
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect();
    const live = invoices.filter((i) => i.status !== "cancelled" && i.status !== "draft");
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((ps) => ps.filter((p) => p.status === "confirmed"));
    const discounts = await ctx.db
      .query("discounts")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((ds) => ds.filter((d) => d.status === "applied"));
    const billed = live.reduce((s, i) => s + i.totalAmount, 0);
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const discounted = discounts.reduce((s, d) => s + d.computedAmount, 0);

    // Latest published results (this academic year).
    let latestResult: { subject: string; percentage: number; gradeLabel: string | null } | null = null;
    if (term) {
      const results = await ctx.db
        .query("subjectResults")
        .withIndex("by_student_term", (q) => q.eq("studentId", student._id).eq("termId", term._id))
        .collect()
        .then((rs) => rs.filter((r) => r.status === "published"));
      if (results.length > 0) {
        const avg = Math.round(results.reduce((s, r) => s + r.percentage, 0) / results.length);
        const subj = await ctx.db.get(results[0].subjectId);
        latestResult = {
          subject: subj?.name ?? "Result",
          percentage: avg,
          gradeLabel: results.find((r) => r.gradeLabel)?.gradeLabel ?? null,
        };
      }
    }

    // Upcoming published assignments for the child's class.
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((es) => es.filter((e) => e.status === "active").pop());
    let upcomingAssignments = 0;
    if (enrollment && term) {
      upcomingAssignments = await ctx.db
        .query("assignments")
        .withIndex("by_class_term", (q) => q.eq("classSectionId", enrollment.classSectionId).eq("termId", term._id))
        .collect()
        .then((as) => as.filter((a) => a.status === "published" && a.dueDate >= today).length);
    }

    const unread = await ctx.db
      .query("appNotifications")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .collect()
      .then((ns) => ns.filter((n) => !n.readAt).length);

    return {
      student: {
        name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
        admissionNumber: student.admissionNumber,
      },
      term: term ? { name: term.name } : null,
      attendance: { present, absent, late, excused, percentage: attendancePct, markedDays: marked },
      fees: { billed, paid, discounted, balance: Math.round((billed - paid - discounted) * 100) / 100 },
      latestResult,
      upcomingAssignments,
      unreadNotifications: unread,
    };
  },
});

export const parentChildAttendance = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await authorizeChild(ctx, schoolId, session.userId, studentId);
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ss) => ss.filter((s) => s.sessionType === "daily"));
    const records = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect();
    const bySession = new Map(records.map((r) => [r.sessionId, r]));
    const rows = sessions
      .map((s) => ({ session: s, record: bySession.get(s._id) }))
      .filter((r) => r.record)
      .sort((a, b) => (a.session.date < b.session.date ? 1 : -1))
      .slice(0, 60)
      .map((r) => ({
        date: r.session.date,
        status: r.record!.status,
        reason: r.record!.reason ?? null,
      }));
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const r of records) {
      if (r.status in counts) counts[r.status as keyof typeof counts]++;
    }
    const total = counts.present + counts.absent + counts.late + counts.excused;
    return {
      summary: {
        ...counts,
        percentage: total > 0 ? Math.round(((counts.present + counts.late) / total) * 100) : null,
        totalDays: total,
      },
      recent: rows,
    };
  },
});

export const parentChildResults = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await authorizeChild(ctx, schoolId, session.userId, studentId);
    // subjectResults has no by_student index; by_school + filter is fine at
    // school scale and keeps the portal on indexed paths.
    const results = await ctx.db
      .query("subjectResults")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((rs) => rs.filter((r) => r.studentId === student._id && r.status === "published"));
    const grouped = new Map<Id<"terms">, typeof results>();
    for (const r of results) {
      const list = grouped.get(r.termId) ?? [];
      list.push(r);
      grouped.set(r.termId, list);
    }
    const terms = [];
    for (const [termId, list] of grouped) {
      const term = await ctx.db.get(termId);
      const subjects = [];
      for (const r of list.sort((a, b) => b.percentage - a.percentage)) {
        const subject = await ctx.db.get(r.subjectId);
        subjects.push({
          subjectId: r.subjectId,
          subject: subject?.name ?? "Subject",
          totalScore: r.totalScore,
          percentage: r.percentage,
          gradeLabel: r.gradeLabel ?? null,
        });
      }
      terms.push({
        termId,
        term: term?.name ?? "Term",
        subjects,
        average: Math.round(list.reduce((s, r) => s + r.percentage, 0) / list.length),
      });
    }
    terms.sort((a, b) => (a.termId < b.termId ? 1 : -1));
    return { student: { name: [student.firstName, student.lastName].filter(Boolean).join(" ") }, terms };
  },
});

export const parentChildReportCards = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await authorizeChild(ctx, schoolId, session.userId, studentId);
    const cards = await ctx.db
      .query("reportCards")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((cs) => cs.filter((c) => c.status === "published"));
    const out = [];
    for (const c of cards.sort((a, b) => (a.termId < b.termId ? 1 : -1))) {
      const term = await ctx.db.get(c.termId);
      out.push({
        reportCardId: c._id,
        term: term?.name ?? "Term",
        status: c.status,
        overallAverage: c.overallAverage ?? null,
        overallGrade: c.overallGrade ?? null,
        rank: c.rank ?? null,
        classSize: c.classSize ?? null,
        attendance: c.attendance ?? null,
      });
    }
    return { reportCards: out };
  },
});

export const parentChildAssignments = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await authorizeChild(ctx, schoolId, session.userId, studentId);
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((es) => es.filter((e) => e.status === "active").pop());
    if (!enrollment) return { assignments: [] };
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_class_term", (q) => q.eq("classSectionId", enrollment.classSectionId))
      .collect()
      .then((as) => as.filter((a) => a.status === "published"));
    const today = new Date().toISOString().slice(0, 10);
    const out = [];
    for (const a of assignments.sort((x, y) => (x.dueDate < y.dueDate ? 1 : -1))) {
      const subject = await ctx.db.get(a.subjectId);
      const staff = a.staffId ? await ctx.db.get(a.staffId) : null;
      out.push({
        title: a.title,
        instructions: a.instructions ?? null,
        subject: subject?.name ?? "Subject",
        teacher: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : null,
        issueDate: a.issueDate,
        dueDate: a.dueDate,
        overdue: a.dueDate < today,
      });
    }
    return { assignments: out };
  },
});

export const parentChildTimetable = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await authorizeChild(ctx, schoolId, session.userId, studentId);
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((es) => es.filter((e) => e.status === "active").pop());
    if (!enrollment) return { days: [] };
    const yearId = enrollment.academicYearId;
    const entries = await ctx.db
      .query("timetableEntries")
      .withIndex("by_class_period", (q) => q.eq("classSectionId", enrollment.classSectionId))
      .collect()
      .then((es) => es.filter((e) => e.academicYearId === yearId && e.status === "published"));
    const out = [];
    for (const e of entries) {
      const period = await ctx.db.get(e.periodId);
      const subject = e.subjectId ? await ctx.db.get(e.subjectId) : null;
      const staff = e.staffId ? await ctx.db.get(e.staffId) : null;
      const room = e.roomId ? await ctx.db.get(e.roomId) : null;
      out.push({
        dayOfWeek: e.dayOfWeek,
        dayName: DAY_NAMES[e.dayOfWeek] ?? e.dayOfWeek,
        startTime: period?.startTime ?? null,
        endTime: period?.endTime ?? null,
        periodName: period?.name ?? null,
        subject: subject?.name ?? null,
        teacher: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : null,
        room: room?.name ?? null,
      });
    }
    out.sort((a, b) =>
      a.dayOfWeek === b.dayOfWeek
        ? (a.startTime ?? "").localeCompare(b.startTime ?? "")
        : (DAY_ORDER[a.dayOfWeek ?? ""] ?? 9) - (DAY_ORDER[b.dayOfWeek ?? ""] ?? 9),
    );
    return { days: out };
  },
});

export const parentChildFees = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await authorizeChild(ctx, schoolId, session.userId, studentId);
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect();
    const live = invoices.filter((i) => i.status !== "draft" && i.status !== "cancelled");
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((ps) => ps.filter((p) => p.status === "confirmed"));
    const out = [];
    for (const inv of live.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))) {
      const invPayments = payments.filter((p) => p.invoiceId === inv._id);
      const invDiscounts = await ctx.db
        .query("discounts")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id))
        .collect()
        .then((ds) => ds.filter((d) => d.status === "applied"));
      const paid = invPayments.reduce((s, p) => s + p.amount, 0);
      const discounted = invDiscounts.reduce((s, d) => s + d.computedAmount, 0);
      const term = await ctx.db.get(inv.termId);
      out.push({
        invoiceId: inv._id,
        invoiceNumber: inv.invoiceNumber,
        term: term?.name ?? null,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        status: inv.status,
        totalAmount: inv.totalAmount,
        paid,
        discounted,
        balance: Math.round((inv.totalAmount - paid - discounted) * 100) / 100,
      });
    }
    return {
      invoices: out,
      totals: {
        billed: Math.round(live.reduce((s, i) => s + i.totalAmount, 0) * 100) / 100,
        paid: Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100,
      },
    };
  },
});

export const parentChildReceipts = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await authorizeChild(ctx, schoolId, session.userId, studentId);
    const receipts = await ctx.db
      .query("receipts")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((rs) => rs.filter((r) => !r.voidedAt));
    const out = [];
    for (const r of receipts.sort((a, b) => b.issuedAt - a.issuedAt).slice(0, 50)) {
      out.push({ receiptId: r._id, receiptNumber: r.receiptNumber, issuedAt: r.issuedAt });
    }
    return { receipts: out };
  },
});

/**
 * Portal report-card detail: same PDF-ready shape as reportCards.get but
 * authorized through the portal link (parent→child / student→self) instead
 * of the staff-only report_cards.view permission. Only published cards.
 */
export const portalReportCardDetail = query({
  args: { reportCardId: v.id("reportCards") },
  handler: async (ctx, { reportCardId }) => {
    const session = await requireAnyPermission(ctx, ["portal.parent", "portal.student"]);
    const schoolId = session.schoolId as Id<"schools">;
    let studentId: Id<"students"> | null = null;
    try {
      const guardian = await parentIdentity(ctx, schoolId, session.userId);
      const card = await ctx.db.get(reportCardId);
      if (!card || card.schoolId !== schoolId) throw new Error("not found");
      const link = await ctx.db
        .query("guardianStudents")
        .withIndex("by_guardian_student", (q) => q.eq("guardianId", guardian._id).eq("studentId", card.studentId))
        .first();
      if (!link) throw new Error("not linked");
      studentId = card.studentId;
    } catch {
      const student = await studentIdentity(ctx, schoolId, session.userId);
      const card = await ctx.db.get(reportCardId);
      if (!card || card.schoolId !== schoolId || card.studentId !== student._id) {
        throw new ConvexError("You do not have access to this report card.");
      }
      studentId = student._id;
    }
    const card = await ctx.db.get(reportCardId);
    if (!card || card.status !== "published") {
      throw new ConvexError("Report card is not available.");
    }
    void studentId;
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

export const receiptDetail = query({
  args: { receiptId: v.id("receipts") },
  handler: async (ctx, { receiptId }) => {
    const session = await requirePermission(ctx, "portal.parent");
    const schoolId = session.schoolId as Id<"schools">;
    const receipt = await getSchoolRecord(ctx, schoolId, "receipts", receiptId);
    if (receipt.voidedAt) throw new ConvexError("This receipt has been voided.");
    // The receipt must belong to one of THIS parent's children.
    const guardian = await parentIdentity(ctx, schoolId, session.userId);
    const childLinks = await ctx.db
      .query("guardianStudents")
      .withIndex("by_guardian", (q) => q.eq("guardianId", guardian._id))
      .collect();
    if (!childLinks.some((l) => l.studentId === receipt.studentId)) {
      throw new ConvexError("This receipt does not belong to your child.");
    }
    const payment = await ctx.db.get(receipt.paymentId);
    const student = receipt.studentId ? await ctx.db.get(receipt.studentId) : null;
    const school = await ctx.db.get(schoolId);
    // Balance after this payment: invoice total minus all live settlements
    // recorded up to and including this payment.
    let balanceAfter: number | null = null;
    if (payment?.invoiceId) {
      const inv = await ctx.db.get(payment.invoiceId);
      const invPayments = await ctx.db
        .query("payments")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", payment.invoiceId!))
        .collect()
        .then((ps) => ps.filter((p) => p.status === "confirmed"));
      const invDiscounts = await ctx.db
        .query("discounts")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", payment.invoiceId!))
        .collect()
        .then((ds) => ds.filter((d) => d.status === "applied"));
      const paid = invPayments.reduce((s, p) => s + p.amount, 0);
      const discounted = invDiscounts.reduce((s, d) => s + d.computedAmount, 0);
      balanceAfter = inv ? Math.round((inv.totalAmount - paid - discounted) * 100) / 100 : null;
    }
    const receivedBy = payment ? await ctx.db.get(payment.receivedById) : null;
    return {
      receiptNumber: receipt.receiptNumber,
      issuedAt: receipt.issuedAt,
      amount: payment?.amount ?? null,
      method: payment?.method ?? null,
      referenceNumber: payment?.referenceNumber ?? null,
      paymentDate: payment?.paymentDate ?? null,
      paymentNumber: payment?.paymentNumber ?? null,
      student: student
        ? {
            name: [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" "),
            admissionNumber: student.admissionNumber,
          }
        : null,
      school: school
        ? {
            name: school.name, county: school.county ?? null, phone: school.phone ?? null,
            email: school.email ?? null, postalAddress: school.postalAddress ?? null,
          }
        : null,
      receivedBy: receivedBy ? receivedBy.name ?? null : null,
      balanceAfter,
    };
  },
});

/* ================================================================== */
/* Student portal                                                       */
/* ================================================================== */

export const studentOverview = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "portal.student");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await studentIdentity(ctx, schoolId, session.userId);
    const today = new Date().toISOString().slice(0, 10);
    const year = await ctx.db
      .query("academicYears")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ys) => ys.find((y) => y.isCurrent) ?? null);
    const term = year
      ? await ctx.db
          .query("terms")
          .withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id))
          .collect()
          .then((ts) => ts.find((t) => t.isCurrent) ?? null)
      : null;
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((es) => es.filter((e) => e.status === "active").pop());
    const classSection = enrollment ? await ctx.db.get(enrollment.classSectionId) : null;
    const grade = classSection ? await ctx.db.get(classSection.gradeLevelId) : null;

    let latestResults: { subject: string; percentage: number; gradeLabel: string | null }[] = [];
    if (term) {
      latestResults = await ctx.db
        .query("subjectResults")
        .withIndex("by_student_term", (q) => q.eq("studentId", student._id).eq("termId", term._id))
        .collect()
        .then(async (rs) => {
          const pub = rs.filter((r) => r.status === "published");
          const out = [];
          for (const r of pub.sort((a, b) => b.percentage - a.percentage).slice(0, 5)) {
            const subject = await ctx.db.get(r.subjectId);
            out.push({ subject: subject?.name ?? "Subject", percentage: r.percentage, gradeLabel: r.gradeLabel ?? null });
          }
          return out;
        });
    }

    let assignmentsDue = 0;
    let nextAssignments: { title: string; subject: string; dueDate: string }[] = [];
    if (enrollment && term) {
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_class_term", (q) => q.eq("classSectionId", enrollment.classSectionId).eq("termId", term._id))
        .collect()
        .then((as) => as.filter((a) => a.status === "published" && a.dueDate >= today));
      assignmentsDue = assignments.length;
      nextAssignments = [];
      for (const a of assignments.sort((x, y) => (x.dueDate < y.dueDate ? -1 : 1)).slice(0, 4)) {
        const subject = await ctx.db.get(a.subjectId);
        nextAssignments.push({ title: a.title, subject: subject?.name ?? "Subject", dueDate: a.dueDate });
      }
    }

    const unread = await ctx.db
      .query("appNotifications")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .collect()
      .then((ns) => ns.filter((n) => !n.readAt).length);

    return {
      student: {
        name: [student.firstName, student.lastName].filter(Boolean).join(" "),
        admissionNumber: student.admissionNumber,
        className: classSection ? `${grade?.name ?? "Grade"} ${classSection.streamName ?? ""}`.trim() : null,
      },
      term: term ? { name: term.name } : null,
      latestResults,
      assignmentsDue,
      nextAssignments,
      unreadNotifications: unread,
    };
  },
});

export const studentAssignments = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "portal.student");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await studentIdentity(ctx, schoolId, session.userId);
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((es) => es.filter((e) => e.status === "active").pop());
    if (!enrollment) return { assignments: [] };
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_class_term", (q) => q.eq("classSectionId", enrollment.classSectionId))
      .collect()
      .then((as) => as.filter((a) => a.status === "published"));
    const today = new Date().toISOString().slice(0, 10);
    const out = [];
    for (const a of assignments.sort((x, y) => (x.dueDate < y.dueDate ? 1 : -1))) {
      const subject = await ctx.db.get(a.subjectId);
      const staff = a.staffId ? await ctx.db.get(a.staffId) : null;
      out.push({
        title: a.title,
        instructions: a.instructions ?? null,
        subject: subject?.name ?? "Subject",
        teacher: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : null,
        issueDate: a.issueDate,
        dueDate: a.dueDate,
        overdue: a.dueDate < today,
      });
    }
    return { assignments: out };
  },
});

export const studentTimetable = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "portal.student");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await studentIdentity(ctx, schoolId, session.userId);
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((es) => es.filter((e) => e.status === "active").pop());
    if (!enrollment) return { days: [] };
    const yearId = enrollment.academicYearId;
    const entries = await ctx.db
      .query("timetableEntries")
      .withIndex("by_class_period", (q) => q.eq("classSectionId", enrollment.classSectionId))
      .collect()
      .then((es) => es.filter((e) => e.academicYearId === yearId && e.status === "published"));
    const out = [];
    for (const e of entries) {
      const period = await ctx.db.get(e.periodId);
      const subject = e.subjectId ? await ctx.db.get(e.subjectId) : null;
      const staff = e.staffId ? await ctx.db.get(e.staffId) : null;
      const room = e.roomId ? await ctx.db.get(e.roomId) : null;
      out.push({
        dayOfWeek: e.dayOfWeek,
        dayName: DAY_NAMES[e.dayOfWeek] ?? e.dayOfWeek,
        startTime: period?.startTime ?? null,
        endTime: period?.endTime ?? null,
        subject: subject?.name ?? null,
        teacher: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : null,
        room: room?.name ?? null,
      });
    }
    out.sort((a, b) =>
      a.dayOfWeek === b.dayOfWeek
        ? (a.startTime ?? "").localeCompare(b.startTime ?? "")
        : (DAY_ORDER[a.dayOfWeek ?? ""] ?? 9) - (DAY_ORDER[b.dayOfWeek ?? ""] ?? 9),
    );
    return { days: out };
  },
});

export const studentAttendance = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "portal.student");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await studentIdentity(ctx, schoolId, session.userId);
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ss) => ss.filter((s) => s.sessionType === "daily"));
    const records = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect();
    const bySession = new Map(records.map((r) => [r.sessionId, r]));
    const recent = sessions
      .map((s) => ({ session: s, record: bySession.get(s._id) }))
      .filter((r) => r.record)
      .sort((a, b) => (a.session.date < b.session.date ? 1 : -1))
      .slice(0, 60)
      .map((r) => ({ date: r.session.date, status: r.record!.status }));
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const r of records) {
      if (r.status in counts) counts[r.status as keyof typeof counts]++;
    }
    const total = counts.present + counts.absent + counts.late + counts.excused;
    return {
      summary: {
        ...counts,
        percentage: total > 0 ? Math.round(((counts.present + counts.late) / total) * 100) : null,
        totalDays: total,
      },
      recent,
    };
  },
});

export const studentResults = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "portal.student");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await studentIdentity(ctx, schoolId, session.userId);
    const results = await ctx.db
      .query("subjectResults")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((rs) => rs.filter((r) => r.studentId === student._id && r.status === "published"));
    const grouped = new Map<Id<"terms">, typeof results>();
    for (const r of results) {
      const list = grouped.get(r.termId) ?? [];
      list.push(r);
      grouped.set(r.termId, list);
    }
    const terms = [];
    for (const [termId, list] of grouped) {
      const term = await ctx.db.get(termId);
      const subjects = [];
      for (const r of list.sort((a, b) => b.percentage - a.percentage)) {
        const subject = await ctx.db.get(r.subjectId);
        subjects.push({
          subject: subject?.name ?? "Subject",
          totalScore: r.totalScore,
          percentage: r.percentage,
          gradeLabel: r.gradeLabel ?? null,
        });
      }
      terms.push({
        termId,
        term: term?.name ?? "Term",
        subjects,
        average: Math.round(list.reduce((s, r) => s + r.percentage, 0) / list.length),
      });
    }
    terms.sort((a, b) => (a.termId < b.termId ? 1 : -1));
    return { terms };
  },
});

export const studentReportCards = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "portal.student");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await studentIdentity(ctx, schoolId, session.userId);
    const cards = await ctx.db
      .query("reportCards")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect()
      .then((cs) => cs.filter((c) => c.status === "published"));
    const out = [];
    for (const c of cards.sort((a, b) => (a.termId < b.termId ? 1 : -1))) {
      const term = await ctx.db.get(c.termId);
      out.push({
        reportCardId: c._id,
        term: term?.name ?? "Term",
        overallAverage: c.overallAverage ?? null,
        overallGrade: c.overallGrade ?? null,
        rank: c.rank ?? null,
        classSize: c.classSize ?? null,
      });
    }
    return { reportCards: out };
  },
});

/* ================================================================== */
/* Announcements                                                        */
/* ================================================================== */

export const listAnnouncements = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "announcements.view");
    const schoolId = session.schoolId as Id<"schools">;
    const today = new Date().toISOString().slice(0, 10);
    const all = await ctx.db
      .query("announcements")
      .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "published"))
      .collect();
    const visible = all.filter(
      (a) => (!a.publishDate || a.publishDate <= today) && (!a.expiryDate || a.expiryDate >= today),
    );
    const out = [];
    for (const a of visible.sort((x, y) => (y.publishedAt ?? 0) - (x.publishedAt ?? 0))) {
      let targeted = false;
      if (a.audience === "class" || a.audience === "grade") {
        targeted = await announcementTargetsUser(ctx, a, session);
        if (!targeted) continue;
      }
      // school-wide audiences (all/parents/students/teachers) reach every
      // signed-in member of the school; role refinement happens client-side
      // from session.role for display purposes only.
      const creator = await ctx.db.get(a.createdById);
      out.push({
        _id: a._id,
        title: a.title,
        message: a.message,
        audience: a.audience,
        publishedAt: a.publishedAt ?? null,
        creator: creator ? creator.name ?? "School" : "School",
      });
    }
    return { announcements: out };
  },
});

async function announcementTargetsUser(
  ctx: QueryCtx,
  a: Doc<"announcements">,
  session: { userId: Id<"users"> },
): Promise<boolean> {
  const db = ctx.db;
  if (a.audience === "class" && a.classSectionId) {
    // Students/parents of that class; staff allocated to that class.
    const link = await db
      .query("studentPortalLinks")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (link) {
      const enrollment = await db
        .query("enrollments")
        .withIndex("by_student", (q) => q.eq("studentId", link.studentId))
        .collect()
        .then((es) => es.filter((e) => e.status === "active").pop());
      if (enrollment?.classSectionId === a.classSectionId) return true;
    }
    const guardianLink = await db
      .query("guardianPortalLinks")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (guardianLink) {
      const childLinks = await db
        .query("guardianStudents")
        .withIndex("by_guardian", (q) => q.eq("guardianId", guardianLink.guardianId))
        .collect();
      for (const cl of childLinks) {
        const enrollment = await db
          .query("enrollments")
          .withIndex("by_student", (q) => q.eq("studentId", cl.studentId))
          .collect()
          .then((es) => es.filter((e) => e.status === "active").pop());
        if (enrollment?.classSectionId === a.classSectionId) return true;
      }
    }
    return false;
  }
  if (a.audience === "grade" && a.gradeLevelId) {
    const link = await db
      .query("studentPortalLinks")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (link) {
      const enrollment = await db
        .query("enrollments")
        .withIndex("by_student", (q) => q.eq("studentId", link.studentId))
        .collect()
        .then((es) => es.filter((e) => e.status === "active").pop());
      if (enrollment) {
        const section = await db.get(enrollment.classSectionId);
        if (section?.gradeLevelId === a.gradeLevelId) return true;
      }
    }
    const guardianLink = await db
      .query("guardianPortalLinks")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (guardianLink) {
      const childLinks = await db
        .query("guardianStudents")
        .withIndex("by_guardian", (q) => q.eq("guardianId", guardianLink.guardianId))
        .collect();
      for (const cl of childLinks) {
        const enrollment = await db
          .query("enrollments")
          .withIndex("by_student", (q) => q.eq("studentId", cl.studentId))
          .collect()
          .then((es) => es.filter((e) => e.status === "active").pop());
        if (enrollment) {
          const section = await db.get(enrollment.classSectionId);
          if (section?.gradeLevelId === a.gradeLevelId) return true;
        }
      }
    }
    return false;
  }
  return false;
}

/* ================================================================== */
/* Notifications                                                        */
/* ================================================================== */

export const listNotifications = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const session = await requirePermission(ctx, "notifications.view");
    const all = await ctx.db
      .query("appNotifications")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .collect();
    const sorted = all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit ?? 50);
    return {
      unread: all.filter((n) => !n.readAt).length,
      notifications: sorted.map((n) => ({
        _id: n._id,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        link: n.link ?? null,
        readAt: n.readAt ?? null,
        createdAt: n.createdAt,
      })),
    };
  },
});

export const markNotificationRead = mutation({
  args: { notificationId: v.id("appNotifications") },
  handler: async (ctx, { notificationId }) => {
    const session = await requirePermission(ctx, "notifications.view");
    const n = await ctx.db.get(notificationId);
    if (!n || n.userId !== session.userId) {
      throw new ConvexError("Notification not found.");
    }
    if (!n.readAt) await ctx.db.patch(notificationId, { readAt: Date.now() });
    return { ok: true };
  },
});

export const markAllNotificationsRead = mutation({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "notifications.view");
    const all = await ctx.db
      .query("appNotifications")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .collect()
      .then((ns) => ns.filter((n) => !n.readAt));
    for (const n of all) await ctx.db.patch(n._id, { readAt: Date.now() });
    return { count: all.length };
  },
});

/* ================================================================== */
/* Profile (parents can update contact details)                         */
/* ================================================================== */

export const myProfile = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "profile.view");
    const schoolId = session.schoolId as Id<"schools">;
    const user = await ctx.db.get(session.userId);
    const guardianLink = await ctx.db
      .query("guardianPortalLinks")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    let guardian = null;
    if (guardianLink && guardianLink.schoolId === schoolId) {
      const g = await ctx.db.get(guardianLink.guardianId);
      if (g) {
        guardian = {
          guardianId: g._id,
          name: [g.firstName, g.middleName, g.lastName].filter(Boolean).join(" "),
          phone: g.phone ?? null,
          altPhone: g.altPhone ?? null,
          email: g.email ?? null,
          occupation: g.occupation ?? null,
          address: g.address ?? null,
          relationship: g.relationship ?? null,
        };
      }
    }
    return {
      name: user?.name ?? null,
      email: user?.email ?? null,
      role: session.role,
      guardian,
    };
  },
});

export const updateGuardianContact = mutation({
  args: {
    phone: v.optional(v.string()),
    altPhone: v.optional(v.string()),
    occupation: v.optional(v.string()),
    address: v.optional(v.string()),
  },
  handler: async (ctx, { phone, altPhone, occupation, address }) => {
    const session = await requirePermission(ctx, "profile.update");
    const schoolId = session.schoolId as Id<"schools">;
    const guardian = await parentIdentity(ctx, schoolId, session.userId);
    await ctx.db.patch(guardian._id, {
      phone: phone ?? guardian.phone,
      altPhone: altPhone ?? guardian.altPhone,
      occupation: occupation ?? guardian.occupation,
      address: address ?? guardian.address,
      updatedAt: Date.now(),
      updatedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "profile.updated",
      entityType: "guardians",
      entityId: guardian._id,
      description: "Parent updated own contact details via portal",
    });
    return { ok: true };
  },
});
