/** One-off: exercise timetable/assessment mutations as GF admin, then re-census. */
const url = process.env.SMOKE_CONVEX_URL;
if (!url) process.exit(1);
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
const yearId = years.find((y) => y.isCurrent)?._id ?? years[0]._id;
const entries = (await c.query(anyApi.timetable.listEntries, { includeDrafts: true })) as {
  _id: string; dayOfWeek: string; periodId: string; classSectionId: string; subjectId: string; staffId: string | null; roomId?: string | null;
}[];
const e = entries[0];
try {
  await c.mutation(anyApi.timetable.updateEntry, {
    entryId: e._id as never,
    academicYearId: yearId as never,
    dayOfWeek: e.dayOfWeek,
    periodId: e.periodId as never,
    classSectionId: e.classSectionId as never,
    subjectId: e.subjectId as never,
    staffId: (e.staffId ?? undefined) as never,
    roomId: (e.roomId ?? undefined) as never,
  });
  console.log("updateEntry OK");
} catch (err) {
  console.log("updateEntry ERR:", String(err).slice(0, 140));
}
const r = await c.action(anyApi.diagnostics.runInternal, { name: "auditCensus" });
console.log("timetable.entry_updated:", r["timetable.entry_updated"]);
c.close?.();
