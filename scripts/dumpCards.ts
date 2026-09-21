/** One-off diagnostic: report card statuses for the workflow class/term. */
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

const terms = (await c.query(anyApi.academics.listTerms, {})) as { _id: string; isCurrent: boolean; name: string }[];
const termId = terms.find((x) => x.isCurrent)?._id ?? terms[0]._id;
const sections = (await c.query(anyApi.academics.listClassSections, {})) as { _id: string }[];
const students = (await c.query(anyApi.students.list, {
  paginationOpts: { numItems: 400, cursor: null },
})) as { page: { _id: string; admissionNumber: string }[] };
const byId = new Map(students.page.map((s) => [s._id, s.admissionNumber]));

for (const sec of sections) {
  try {
    const cards = (await c.query(anyApi.reportCards.listForClass, {
      termId: termId as never,
      classSectionId: sec._id as never,
    })) as { studentId: string; status: string; snapshotVersion: number }[] | null;
    if (cards && cards.length > 0) {
      const counts: Record<string, number> = {};
      for (const card of cards) counts[card.status] = (counts[card.status] ?? 0) + 1;
      console.log(
        `class ${sec._id}: total=${cards.length}`,
        Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" "),
        "versions:", [...new Set(cards.map((x) => x.snapshotVersion))].join(","),
        "students:", cards.slice(0, 3).map((x) => byId.get(x.studentId)?.slice(0, 14)).join(","),
      );
    }
  } catch {
    // skip
  }
}
c.close?.();
process.exit(0);
