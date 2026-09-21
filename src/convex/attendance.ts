import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { ATTENDANCE_STATUSES } from "./schema";

/** Read-only db handle accepted from both query and mutation contexts. */
type ReadCtx = { db: QueryCtx["db"] };

/** Resolve the current staff record for the caller (teachers are staff members). */
export async function myStaffId(
  ctx: ReadCtx,
  schoolId: Id<"schools">,
  userId: Id<"users">,
): Promise<Id<"staff"> | null> {
  const rows = await ctx.db
    .query("staff")
    .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
    .collect();
  const mine = rows.find((s) => s.userId === userId && s.employmentStatus === "active");
  return mine?._id ?? null;
}

/** Validate a YYYY-MM-DD string. */
export function validDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/** Days between two YYYY-MM-DD dates (a - b, calendar days). */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}

/** Today in the school's timezone (§69). */
export function todayInTz(timezone: string | undefined | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "Africa/Nairobi",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  }
}

/** Active enrollments for a class on a given date (§12 historical rule). */
export async function activeEnrollmentsOnDate(
  ctx: ReadCtx,
  classSectionId: Id<"classSections">,
  date: string,
): Promise<{ enrollmentId: Id<"enrollments">; studentId: Id<"students"> }[]> {
  const enrolls = await ctx.db
    .query("enrollments")
    .withIndex("by_class_section", (q) => q.eq("classSectionId", classSectionId))
    .collect();
  return enrolls
    .filter((e) => {
      if (e.status !== "active") return false;
      if (e.enrollmentDate > date) return false; // not yet enrolled on that date
      if (e.exitDate && e.exitDate < date) return false; // already exited
      return true;
    })
    .map((e) => ({ enrollmentId: e._id, studentId: e.studentId }));
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export const createSession = mutation({
  args: {
    date: v.string(),
    sessionType: v.string(), // daily | lesson
    classSectionId: v.id("classSections"),
    subjectId: v.optional(v.id("subjects")),
    timetableEntryId: v.optional(v.id("timetableEntries")),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "attendance.take");
    const schoolId = session.schoolId as Id<"schools">;
    if (!validDate(args.date)) throw new ConvexError("Invalid attendance date.");

    const section = await getSchoolRecord(ctx, schoolId, "classSections", args.classSectionId);
    const year = await ctx.db.get(section.academicYearId);
    if (!year) throw new ConvexError("Academic year not found for this class.");
    const term = await ctx.db
      .query("terms")
      .withIndex("by_academic_year", (q) => q.eq("academicYearId", section.academicYearId))
      .collect();
    const activeTerm = term.find((t) => t.isCurrent) ?? term[0];
    if (!activeTerm) throw new ConvexError("No term is configured for this academic year.");

    if (args.sessionType === "lesson" && !args.subjectId) {
      throw new ConvexError("Lesson attendance requires a subject.");
    }
    if (args.subjectId) {
      await getSchoolRecord(ctx, schoolId, "subjects", args.subjectId);
    }

    // Attendance mode policy (§63): daily / lesson / both.
    const settings = await ctx.db
      .query("schoolSettings")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    const mode = settings?.attendanceMode ?? "daily";
    if (mode === "daily" && args.sessionType === "lesson") {
      throw new ConvexError("This school only records daily attendance.");
    }
    if (mode === "lesson" && args.sessionType === "daily") {
      throw new ConvexError("This school records lesson attendance only.");
    }

    // Teacher authorization: teachers may only take attendance for their own class
    // (daily, as class teacher) or their allocated class+subject (lesson).
    if (session.role.role === "teacher") {
      const staffId = await myStaffId(ctx, schoolId, session.userId);
      if (!staffId) throw new ConvexError("Your staff record is not linked to your account.");
      const allocs = await ctx.db
        .query("teacherAllocations")
        .withIndex("by_staff", (q) => q.eq("staffId", staffId))
        .collect();
      const activeAllocs = allocs.filter(
        (a) => a.status === "active" && a.academicYearId === section.academicYearId,
      );
      const hasClass = activeAllocs.some((a) => a.classSectionId === args.classSectionId);
      const hasClassSubject =
        args.subjectId != null &&
        activeAllocs.some(
          (a) => a.classSectionId === args.classSectionId && a.subjectId === args.subjectId,
        );
      const isClassTeacher = section.classTeacherStaffId === staffId;
      if (args.sessionType === "lesson" ? !hasClassSubject : !(hasClass || isClassTeacher)) {
        throw new ConvexError(
          "You are not allocated to this class" + (args.sessionType === "lesson" ? " for this subject." : "."),
        );
      }
    }

    // Duplicate session protection (§11, §84).
    const existing = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_class_date", (q) => q.eq("classSectionId", args.classSectionId).eq("date", args.date))
      .collect();
    const dup = existing.find(
      (s) =>
        s.sessionType === args.sessionType &&
        (args.sessionType === "daily" || s.subjectId === args.subjectId),
    );
    if (dup) {
      throw new ConvexError(
        args.sessionType === "daily"
          ? "Daily attendance for this class on this date already exists."
          : "Lesson attendance for this class, subject and date already exists.",
      );
    }

    const sessionStaffId = await myStaffId(ctx, schoolId, session.userId);
    const sessionId = await ctx.db.insert("attendanceSessions", {
      schoolId,
      academicYearId: section.academicYearId,
      termId: activeTerm._id,
      classSectionId: args.classSectionId,
      sessionType: args.sessionType,
      subjectId: args.sessionType === "lesson" ? args.subjectId : undefined,
      timetableEntryId: args.timetableEntryId,
      staffId: sessionStaffId ?? undefined,
      date: args.date,
      status: "open",
      recordedById: session.userId,
      createdAt: Date.now(),
    });

    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "attendance.session_created",
      entityType: "attendanceSessions",
      entityId: sessionId,
      description: `${args.sessionType === "daily" ? "Daily" : "Lesson"} attendance session opened`,
      metadata: { date: args.date },
    });
    return sessionId;
  },
});

export const getSession = query({
  args: { sessionId: v.id("attendanceSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await requirePermission(ctx, "attendance.view");
    const s = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "attendanceSessions", sessionId);
    const section = await ctx.db.get(s.classSectionId);
    const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
    const subject = s.subjectId ? await ctx.db.get(s.subjectId) : null;
    return {
      ...s,
      classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
      subjectName: subject?.name ?? null,
    };
  },
});

/** Register for a session: enrolled students (historical rule) + existing marks. */
export const register = query({
  args: {
    classSectionId: v.id("classSections"),
    date: v.string(),
    sessionType: v.string(),
    subjectId: v.optional(v.id("subjects")),
    sessionId: v.optional(v.id("attendanceSessions")),
  },
  handler: async (ctx, { classSectionId, date, sessionType, subjectId, sessionId }) => {
    const session = await requirePermission(ctx, "attendance.view");
    const schoolId = session.schoolId as Id<"schools">;
    if (!validDate(date)) throw new ConvexError("Invalid attendance date.");
    const section = await getSchoolRecord(ctx, schoolId, "classSections", classSectionId);
    void section;

    const roster = await activeEnrollmentsOnDate(ctx, classSectionId, date);
    const students = await Promise.all(
      roster.map(async (r) => {
        const st = await ctx.db.get(r.studentId);
        return {
          studentId: r.studentId,
          enrollmentId: r.enrollmentId,
          admissionNumber: st?.admissionNumber ?? "",
          fullName: [st?.firstName, st?.middleName, st?.lastName].filter(Boolean).join(" "),
        };
      }),
    );
    students.sort((a, b) => a.fullName.localeCompare(b.fullName));

    let records: {
      studentId: Id<"students">;
      status: string;
      reason?: string;
      note?: string;
    }[] = [];
    if (sessionId) {
      const recs = await ctx.db
        .query("attendanceRecords")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect();
      records = recs.map((r) => ({
        studentId: r.studentId,
        status: r.status,
        reason: r.reason,
        note: r.note,
      }));
    } else {
      // No session yet — check for an existing one matching the natural key.
      const existing = await ctx.db
        .query("attendanceSessions")
        .withIndex("by_class_date", (q) => q.eq("classSectionId", classSectionId).eq("date", date))
        .collect();
      const match = existing.find(
        (s) => s.sessionType === sessionType && (sessionType === "daily" || s.subjectId === subjectId),
      );
      if (match) {
        const recs = await ctx.db
          .query("attendanceRecords")
          .withIndex("by_session", (q) => q.eq("sessionId", match._id))
          .collect();
        records = recs.map((r) => ({
          studentId: r.studentId,
          status: r.status,
          reason: r.reason,
          note: r.note,
        }));
        return {
          sessionId: match._id,
          status: match.status,
          students,
          records,
        };
      }
    }
    return {
      sessionId: sessionId ?? null,
      status: sessionId ? "open" : "new",
      students,
      records,
    };
  },
});

/** Save (create or update) attendance for a session in one atomic mutation. */
export const saveSession = mutation({
  args: {
    sessionId: v.optional(v.id("attendanceSessions")),
    date: v.string(),
    sessionType: v.string(),
    classSectionId: v.id("classSections"),
    subjectId: v.optional(v.id("subjects")),
    status: v.optional(v.union(v.literal("open"), v.literal("completed"))),
    records: v.array(
      v.object({
        studentId: v.id("students"),
        enrollmentId: v.id("enrollments"),
        status: v.string(),
        reason: v.optional(v.string()),
        note: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "attendance.take");
    const schoolId = session.schoolId as Id<"schools">;
    if (!validDate(args.date)) throw new ConvexError("Invalid attendance date.");

    // Resolve or create the session (dup protection re-checked here).
    let sessionId = args.sessionId;
    if (!sessionId) {
      const existing = await ctx.db
        .query("attendanceSessions")
        .withIndex("by_class_date", (q) => q.eq("classSectionId", args.classSectionId).eq("date", args.date))
        .collect();
      const dup = existing.find(
        (s) => s.sessionType === args.sessionType && (args.sessionType === "daily" || s.subjectId === args.subjectId),
      );
      if (dup) {
        sessionId = dup._id;
      } else {
        sessionId = await createSessionInternal(ctx, session, args);
      }
    } else {
      const s = await getSchoolRecord(ctx, schoolId, "attendanceSessions", sessionId);
      // Editable window + completed-session policy (§63, §15).
      const settings = await ctx.db
        .query("schoolSettings")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .first();
      const windowDays = settings?.editableWindowDays ?? 7;
      const tz = await ctx.db.get(s.schoolId);
      const today = todayInTz(tz?.timezone);
      if (s.date < today && dayDiff(s.date, today) > windowDays) {
        throw new ConvexError(
          `Attendance older than ${windowDays} days is locked. Ask an administrator to reopen it.`,
        );
      }
      if (s.status === "completed" && session.role.role === "teacher") {
        throw new ConvexError("This attendance session is completed. Ask an administrator to reopen it.");
      }
    }

    const settings = await ctx.db
      .query("schoolSettings")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    void settings;

    // Validate records: students must be enrolled in this class (historical rule §12/§74).
    const roster = new Map(
      (await activeEnrollmentsOnDate(ctx, args.classSectionId, args.date)).map((r) => [r.studentId, r.enrollmentId]),
    );
    for (const r of args.records) {
      if (!ATTENDANCE_STATUSES.includes(r.status as (typeof ATTENDANCE_STATUSES)[number])) {
        throw new ConvexError("Unknown attendance status.");
      }
      const enrollmentId = roster.get(r.studentId);
      if (!enrollmentId) {
        throw new ConvexError("One of the students is not enrolled in this class for this date.");
      }
      if (enrollmentId !== r.enrollmentId) {
        throw new ConvexError("Enrollment mismatch for one of the students.");
      }
    }

    const prev = sessionId
      ? await ctx.db.query("attendanceRecords").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect()
      : [];
    const prevByStudent = new Map(prev.map((p) => [p.studentId, p]));

    for (const r of args.records) {
      const existing = prevByStudent.get(r.studentId);
      if (existing) {
        if (
          existing.status !== r.status ||
          existing.reason !== r.reason ||
          existing.note !== r.note
        ) {
          await ctx.db.patch(existing._id, {
            status: r.status,
            reason: r.reason,
            note: r.note,
            recordedById: session.userId,
            updatedAt: Date.now(),
          });
          if (existing.status !== r.status) {
            await recordAudit(ctx, {
              userId: session.userId,
              schoolId,
              action: "attendance.record_edited",
              entityType: "attendanceRecords",
              entityId: existing._id,
              description: `Attendance changed ${existing.status} → ${r.status}`,
              metadata: { date: args.date, from: existing.status, to: r.status },
            });
          }
        }
      } else {
        const id = await ctx.db.insert("attendanceRecords", {
          schoolId,
          sessionId: sessionId as Id<"attendanceSessions">,
          studentId: r.studentId,
          enrollmentId: r.enrollmentId,
          status: r.status,
          reason: r.reason,
          note: r.note,
          recordedById: session.userId,
          updatedAt: Date.now(),
        });
        await recordAudit(ctx, {
          userId: session.userId,
          schoolId,
          action: "attendance.recorded",
          entityType: "attendanceRecords",
          entityId: id,
          metadata: { date: args.date, status: r.status },
        });
      }
    }

    await ctx.db.patch(sessionId, {
      status: args.status ?? "completed",
      updatedAt: Date.now(),
    });
    return sessionId;
  },
});

async function createSessionInternal(
  ctx: MutationCtx,
  session: Awaited<ReturnType<typeof import("./session").requirePermission>>,
  args: {
    date: string;
    sessionType: string;
    classSectionId: Id<"classSections">;
    subjectId?: Id<"subjects">;
  },
): Promise<Id<"attendanceSessions">> {
  // Reuse createSession's authorization by calling the exported handler logic
  // through an internal shim is not possible in a mutation; inline the same
  // checks (kept in sync — both run within saveSession's transaction).
  const schoolId = session.schoolId as Id<"schools">;
  const section = await getSchoolRecord(ctx, schoolId, "classSections", args.classSectionId);
  const year = await ctx.db.get(section.academicYearId);
  if (!year) throw new ConvexError("Academic year not found for this class.");
  const terms = await ctx.db
    .query("terms")
    .withIndex("by_academic_year", (q) => q.eq("academicYearId", section.academicYearId))
    .collect();
  const activeTerm = terms.find((t) => t.isCurrent) ?? terms[0];
  if (!activeTerm) throw new ConvexError("No term is configured for this academic year.");
  const settings = await ctx.db
    .query("schoolSettings")
    .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
    .first();
  const mode = settings?.attendanceMode ?? "daily";
  if (mode === "daily" && args.sessionType === "lesson") {
    throw new ConvexError("This school only records daily attendance.");
  }
  if (mode === "lesson" && args.sessionType === "daily") {
    throw new ConvexError("This school records lesson attendance only.");
  }
  if (session.role.role === "teacher") {
    const staffId = await myStaffId(ctx, schoolId, session.userId);
    if (!staffId) throw new ConvexError("Your staff record is not linked to your account.");
    const allocs = await ctx.db
      .query("teacherAllocations")
      .withIndex("by_staff", (q) => q.eq("staffId", staffId))
      .collect();
    const activeAllocs = allocs.filter(
      (a) => a.status === "active" && a.academicYearId === section.academicYearId,
    );
    const hasClass = activeAllocs.some((a) => a.classSectionId === args.classSectionId);
    const hasClassSubject =
      args.subjectId != null &&
      activeAllocs.some(
        (a) => a.classSectionId === args.classSectionId && a.subjectId === args.subjectId,
      );
    const isClassTeacher = section.classTeacherStaffId === staffId;
    if (args.sessionType === "lesson" ? !hasClassSubject : !(hasClass || isClassTeacher)) {
      throw new ConvexError(
        "You are not allocated to this class" + (args.sessionType === "lesson" ? " for this subject." : "."),
      );
    }
  }
  const sessionStaffId = await myStaffId(ctx, schoolId, session.userId);
  const sessionId = await ctx.db.insert("attendanceSessions", {
    schoolId,
    academicYearId: section.academicYearId,
    termId: activeTerm._id,
    classSectionId: args.classSectionId,
    sessionType: args.sessionType,
    subjectId: args.sessionType === "lesson" ? args.subjectId : undefined,
    staffId: sessionStaffId ?? undefined,
    date: args.date,
    status: "open",
    recordedById: session.userId,
    createdAt: Date.now(),
  });
  await recordAudit(ctx, {
    userId: session.userId,
    schoolId,
    action: "attendance.session_created",
    entityType: "attendanceSessions",
    entityId: sessionId,
    description: `${args.sessionType === "daily" ? "Daily" : "Lesson"} attendance session opened`,
    metadata: { date: args.date },
  });
  return sessionId;
}

export const reopenSession = mutation({
  args: { sessionId: v.id("attendanceSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await requirePermission(ctx, "attendance.manage");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "attendanceSessions", sessionId);
    await ctx.db.patch(sessionId, { status: "open", updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "attendance.session_reopened",
      entityType: "attendanceSessions",
      entityId: sessionId,
    });
  },
});

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export const today = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "attendance.view");
    const schoolId = session.schoolId as Id<"schools">;
    const school = await ctx.db.get(schoolId);
    const date = todayInTz(school?.timezone);
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_school_date", (q) => q.eq("schoolId", schoolId).eq("date", date))
      .collect();

    const sections = await ctx.db
      .query("classSections")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const yearId = sessions[0]?.academicYearId;
    const activeYear = yearId
      ? await ctx.db.get(yearId)
      : await ctx.db
          .query("academicYears")
          .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
          .first();
    const activeSections = sections.filter((s) => s.status === "active" && s.academicYearId === activeYear?._id);

    const enriched = await Promise.all(
      sessions.map(async (s) => {
        const records = await ctx.db
          .query("attendanceRecords")
          .withIndex("by_session", (q) => q.eq("sessionId", s._id))
          .collect();
        const section = sections.find((c) => c._id === s.classSectionId);
        const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
        const subject = s.subjectId ? await ctx.db.get(s.subjectId) : null;
        const present = records.filter((r) => r.status === "present" || r.status === "late").length;
        return {
          _id: s._id,
          sessionType: s.sessionType,
          date: s.date,
          status: s.status,
          classSectionId: s.classSectionId,
          classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
          subjectName: subject?.name ?? null,
          recorded: records.length,
          present,
          absent: records.filter((r) => r.status === "absent").length,
          late: records.filter((r) => r.status === "late").length,
          excused: records.filter((r) => r.status === "excused").length,
        };
      }),
    );

    const notTaken = activeSections
      .filter((c) => !sessions.some((s) => s.classSectionId === c._id && s.sessionType === "daily"))
      .map(async (c) => {
        const grade = await ctx.db.get(c.gradeLevelId);
        return {
          classSectionId: c._id,
          classLabel: `${grade?.name ?? ""} ${c.streamName}`.trim(),
        };
      });

    return {
      date,
      sessions: enriched,
      notTaken: await Promise.all(notTaken),
      settings: {
        mode: (await ctx.db.query("schoolSettings").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).first())
          ?.attendanceMode ?? "daily",
      },
    };
  },
});

/** Class attendance history over a date range (§13). */
export const classHistory = query({
  args: {
    classSectionId: v.id("classSections"),
    fromDate: v.string(),
    toDate: v.string(),
  },
  handler: async (ctx, { classSectionId, fromDate, toDate }) => {
    const session = await requirePermission(ctx, "attendance.view");
    const schoolId = session.schoolId as Id<"schools">;
    const section = await getSchoolRecord(ctx, schoolId, "classSections", classSectionId);
    const grade = await ctx.db.get(section.gradeLevelId);
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_class_date", (q) => q.eq("classSectionId", classSectionId))
      .collect();
    const inRange = sessions.filter((s) => s.date >= fromDate && s.date <= toDate && s.sessionType === "daily");
    const rows = await Promise.all(
      inRange.map(async (s) => {
        const records = await ctx.db
          .query("attendanceRecords")
          .withIndex("by_session", (q) => q.eq("sessionId", s._id))
          .collect();
        return {
          sessionId: s._id,
          date: s.date,
          sessionType: s.sessionType,
          status: s.status,
          present: records.filter((r) => r.status === "present").length,
          absent: records.filter((r) => r.status === "absent").length,
          late: records.filter((r) => r.status === "late").length,
          excused: records.filter((r) => r.status === "excused").length,
          recorded: records.length,
        };
      }),
    );
    return {
      classLabel: `${grade?.name ?? ""} ${section.streamName}`.trim(),
      sessions: rows.sort((a, b) => b.date.localeCompare(a.date)),
    };
  },
});

/** Per-student attendance summary over a session set (§13 Student Attendance). */
export const studentSummary = query({
  args: {
    studentId: v.id("students"),
    termId: v.optional(v.id("terms")),
  },
  handler: async (ctx, { studentId, termId }) => {
    const session = await requirePermission(ctx, "attendance.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "students", studentId);
    const recs = await ctx.db
      .query("attendanceRecords")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    let filtered = recs;
    if (termId) {
      const sessionIds = new Set(
        (
          await ctx.db
            .query("attendanceSessions")
            .withIndex("by_school_term", (q) => q.eq("schoolId", schoolId).eq("termId", termId))
            .collect()
        ).map((s) => s._id),
      );
      filtered = recs.filter((r) => sessionIds.has(r.sessionId));
    }
    const count = (s: string) => filtered.filter((r) => r.status === s).length;
    const present = count("present");
    const late = count("late");
    const absent = count("absent");
    const excused = count("excused");
    const total = filtered.length;
    return {
      present,
      late,
      absent,
      excused,
      total,
      percentage: total > 0 ? Math.round(((present + late) / total) * 1000) / 10 : null,
    };
  },
});

/** School-wide analytics over a term (§14). */
export const analytics = query({
  args: { termId: v.optional(v.id("terms")) },
  handler: async (ctx, { termId }) => {
    const session = await requirePermission(ctx, "attendance.view");
    const schoolId = session.schoolId as Id<"schools">;
    let effectiveTermId = termId;
    if (!effectiveTermId) {
      const term = await ctx.db
        .query("terms")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      effectiveTermId = term?._id;
    }
    if (!effectiveTermId) return null;
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_school_term", (q) => q.eq("schoolId", schoolId).eq("termId", effectiveTermId as Id<"terms">))
      .collect();
    const daily = sessions.filter((s) => s.sessionType === "daily"); // avoid double-counting (§8)
    const records: { status: string; classSectionId: Id<"classSections">; studentId: Id<"students"> }[] = [];
    for (const s of daily) {
      const recs = await ctx.db
        .query("attendanceRecords")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const r of recs) {
        records.push({ status: r.status, classSectionId: s.classSectionId, studentId: r.studentId });
      }
    }
    const total = records.length;
    const presentish = records.filter((r) => r.status === "present" || r.status === "late").length;
    const byClass = new Map<Id<"classSections">, { present: number; total: number; absent: number; late: number }>();
    for (const r of records) {
      const agg = byClass.get(r.classSectionId) ?? { present: 0, total: 0, absent: 0, late: 0 };
      agg.total++;
      if (r.status === "present" || r.status === "late") agg.present++;
      if (r.status === "absent") agg.absent++;
      if (r.status === "late") agg.late++;
      byClass.set(r.classSectionId, agg);
    }
    // chronic absenteeism indicator: students below 75% attendance (descriptive only)
    const byStudent = new Map<string, { present: number; total: number }>();
    for (const r of records) {
      const agg = byStudent.get(r.studentId) ?? { present: 0, total: 0 };
      agg.total++;
      if (r.status === "present" || r.status === "late") agg.present++;
      byStudent.set(r.studentId, agg);
    }
    const chronic = [...byStudent.entries()]
      .filter(([, v]) => v.total >= 10 && v.present / v.total < 0.75)
      .map(([studentId, v]) => ({ studentId, percentage: Math.round((v.present / v.total) * 1000) / 10 }));
    const sections = await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const label = async (id: Id<"classSections">) => {
      const s = sections.find((x) => x._id === id);
      if (!s) return "—";
      const g = await ctx.db.get(s.gradeLevelId);
      return `${g?.name ?? ""} ${s.streamName}`.trim();
    };
    const classRows = await Promise.all(
      [...byClass.entries()].map(async ([classSectionId, v]) => ({
        classSectionId,
        classLabel: await label(classSectionId),
        percentage: v.total > 0 ? Math.round((v.present / v.total) * 1000) / 10 : 0,
        absent: v.absent,
        late: v.late,
        recorded: v.total,
      })),
    );
    return {
      termId: effectiveTermId,
      overallPercentage: total > 0 ? Math.round((presentish / total) * 1000) / 10 : null,
      totalRecorded: total,
      absences: records.filter((r) => r.status === "absent").length,
      lateArrivals: records.filter((r) => r.status === "late").length,
      byClass: classRows.sort((a, b) => a.classLabel.localeCompare(b.classLabel)),
      chronicAbsenteeism: chronic,
    };
  },
});
