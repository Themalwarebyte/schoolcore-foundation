/**
 * TEMPORARY probe (safe to delete): checks every term for the teacher's
 * workflow class-subject. Prints counts only — never credentials or URLs.
 */
process.env.SMOKE_CONVEX_URL ||= process.env.VITE_CONVEX_URL || "";
if (!process.env.SMOKE_CONVEX_URL) {
  console.log("NO_CONVEX_URL_IN_RUNTIME_ENV");
  process.exit(2);
}
const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");
const url = process.env.SMOKE_CONVEX_URL;

async function signIn(email, password) {
  const c = new ConvexHttpClient(url);
  const res = await c.action(anyApi.auth.signIn, {
    provider: "password",
    params: { flow: "signIn", email, password },
  });
  c.setAuth(res?.tokens?.token ?? "");
  return c;
}

const gf = await signIn("admin@greenfield.ac.ke", "Greenfield#2026");
const t = await signIn("grace.wanjiku@greenfield.ac.ke", "Greenfield#2026");

const allocs = await t.query(anyApi.assignments.myAllocationOptions, {});
const a0 = (allocs ?? [])[0];
const years = await gf.query(anyApi.academics.listYears, {});
const year = (years ?? []).find((y) => y.isCurrent) ?? (years ?? [])[0];
// Replicate phase2's EXACT selection: listTerms with NO year filter.
const allTerms = await gf.query(anyApi.academics.listTerms, {});
const term = (allTerms ?? []).find((x) => x.isCurrent) ?? (allTerms ?? [])[0];
console.log("phase2-style pick: term", term?.name, term?._id, "· year-filtered current term differs:", term?._id !== ((await gf.query(anyApi.academics.listTerms, { academicYearId: year._id })) ?? []).find((x) => x.isCurrent)?._id);

for (const pickedTerm of [term]) {
  const sheet = await t.query(anyApi.results.sheet, {
    termId: pickedTerm._id, classSectionId: a0.classSectionId, subjectId: a0.subjectId,
  });
  const rows = sheet?.rows ?? [];
  const missing = rows.filter((r) => (r.missingCount ?? 0) > 0);
  console.log(`\n== ${pickedTerm.name} ${term.isCurrent ? "(current)" : ""} — rows=${rows.length} missing=${missing.length}`);
  console.log("  statusCounts:", JSON.stringify(sheet?.statusCounts ?? {}));
  const comps = rows[0]?.components ?? [];
  for (const c of comps) {
    const missingThis = rows.filter((r) => {
      const comp = (r.components ?? []).find((x) => x.assessmentId === c.assessmentId);
      return comp && comp.status === "missing";
    }).length;
    console.log(`  "${c.title}" missing=${missingThis} statusSample=${rows[0]?.components?.find((x) => x.assessmentId === c.assessmentId)?.status}`);
  }
}
gf.close?.(); t.close?.();
