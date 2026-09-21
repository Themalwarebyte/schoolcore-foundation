/** One-off diagnostic: who is blocking the results completeness gate? */
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
      params: {
        flow: "signIn",
        email: "admin@greenfield.ac.ke",
        password: "Greenfield#2026",
      },
    })
  ).tokens.token,
);

const terms = (await c.query(anyApi.academics.listTerms, {})) as { _id: string; isCurrent: boolean }[];
const termId = terms.find((x) => x.isCurrent)?._id ?? terms[0]._id;
const subjects = (await c.query(anyApi.academics.listSubjects, {})) as { _id: string; name: string; code: string }[];
const math = subjects.find((s) => s.code === "MAT");
const students = (await c.query(anyApi.students.list, {
  paginationOpts: { numItems: 400, cursor: null },
})) as { page: { _id: string; admissionNumber: string; firstName: string; lastName: string; studentStatus: string }[] };
const byId = new Map(students.page.map((s) => [s._id, s]));
const sections = (await c.query(anyApi.academics.listClassSections, {})) as { _id: string }[];

for (const sec of sections) {
  try {
    const preview = (await c.query(anyApi.results.preview, {
      termId: termId as never,
      classSectionId: sec._id as never,
      subjectId: math!._id as never,
    })) as {
      rows: { studentId: string; missingCount: number }[];
    } | null;
    const blockers = (preview?.rows ?? []).filter((r) => r.missingCount > 0);
    if (blockers.length > 0) {
      console.log(`\nClass ${sec._id}:`);
      for (const b of blockers) {
        const st = byId.get(b.studentId);
        console.log(
          `  ${st?.admissionNumber ?? b.studentId} ${st?.firstName ?? "?"} ${st?.lastName ?? ""} status=${st?.studentStatus} — ${b.missingCount} missing`,
        );
      }
    }
  } catch {
    // skip
  }
}
c.close?.();
process.exit(0);
