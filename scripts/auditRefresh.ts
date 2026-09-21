/**
 * One-off audit refresh for the verification environment: exercises the few
 * audit-producing paths that the phase2 verification run does not naturally
 * trigger (timetable entry delete+create, timetable publish, attendance
 * session create, assessment status transitions) against the seeded demo
 * school. Idempotent in effect: it deletes and recreates the same entry.
 */
const url = process.env.SMOKE_CONVEX_URL;
if (!url) {
  console.error("SMOKE_CONVEX_URL required");
  process.exit(1);
}
const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");
const c = new ConvexHttpClient(url);
c.setAuth(
  (
    await c.action(anyApi.auth.signIn, {
      provider: "password",
      params: { flow: "signIn", email: "admin@greenfield.ac.ke", password: "Greenfield#2026" },
    })
  ).tokens.token,
);

const years = (await c.query(anyApi.academics.listYears, {})) as { _id: string; isCurrent: boolean }[];
const yearId = (years.find((y) => y.isCurrent) ?? years[0])._id;

// 1. Timetable entry: delete + recreate the same slot (audits both actions).
const entries = (await c.query(anyApi.timetable.listEntries, {
  includeDrafts: true,
  academicYearId: yearId as never,
})) as { _id: string; dayOfWeek: string; periodId: string; classSectionId: string; subjectId: string; staffId: string | null; roomId?: string | null }[];
const e = entries[5];
await c.mutation(anyApi.timetable.deleteEntry, { entryId: e._id as never });
await c.mutation(anyApi.timetable.createEntry, {
  academicYearId: yearId as never,
  dayOfWeek: e.dayOfWeek,
  periodId: e.periodId as never,
  classSectionId: e.classSectionId as never,
  subjectId: e.subjectId as never,
  staffId: (e.staffId ?? undefined) as never,
  roomId: (e.roomId ?? undefined) as never,
});
console.log("timetable entry recreated");

// 2. Timetable publish (idempotent for already-published entries).
await c.mutation(anyApi.timetable.publishTimetable, { academicYearId: yearId as never });
console.log("timetable published");

// 3. Attendance session creation for a fresh date (creates an open session).
const sections = (await c.query(anyApi.academics.listClassSections, {})) as { _id: string; status: string }[];
const active = sections.find((s) => s.status === "active")!;
const d = new Date().toISOString().slice(0, 10);
await c.mutation(anyApi.attendance.createSession, {
  date: d,
  sessionType: "daily",
  classSectionId: active._id as never,
});
console.log("attendance session created for", d);

// 4. Assessment status transition (marking → submitted if any available).
const assessments = (await c.query(anyApi.assessments.list, {})) as { _id: string; status: string }[];
const marking = assessments.find((a) => a.status === "marking");
if (marking) {
  await c.mutation(anyApi.assessments.setStatus, {
    assessmentId: marking._id as never,
    status: "submitted",
  });
  console.log("assessment transitioned marking → submitted");
} else {
  console.log("no marking assessment available for transition");
}

const census = (await c.action(anyApi.diagnostics.runInternal, { name: "auditCensus" })) as Record<string, number>;
console.log("census now has:", {
  "timetable.entry_created": census["timetable.entry_created"],
  "timetable.entry_deleted": census["timetable.entry_deleted"],
  "timetable.published": census["timetable.published"],
  "attendance.session_created": census["attendance.session_created"],
  "assessment.status_submitted": census["assessment.status_submitted"],
});
c.close?.();
