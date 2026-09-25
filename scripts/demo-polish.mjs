/**
 * Demo polish + production safety for the live demo deployment.
 * Usage: bun scripts/demo-polish.mjs <convexUrl>
 *
 * 1. Publishes seeded subject results + report cards (parent/student portals
 *    demo real published results).
 * 2. Reverses SMOKE-* test payments left by verification harnesses.
 * 3. Purges harness-created SMOKE students (and their dependent rows).
 * 4. Prints a final portal-readiness summary for the demo parent.
 */
const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/demo-polish.mjs <convexUrl>");
  process.exit(1);
}
const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

const BR = async (name, args = {}) => {
  const c = new ConvexHttpClient(url);
  try {
    return await c.action(anyApi.diagnostics.runInternal6, { name, argsJson: JSON.stringify(args) });
  } finally { c.close?.(); }
};
const BR1 = async (name) => {
  const c = new ConvexHttpClient(url);
  try {
    return await c.action(anyApi.diagnostics.runInternal, { name });
  } finally { c.close?.(); }
};

async function signIn(email, password) {
  const c = new ConvexHttpClient(url);
  try {
    const res = await c.action(anyApi.auth.signIn, {
      provider: "password",
      params: { flow: "signIn", email, password },
    });
    return res?.tokens ? { jwt: res.tokens.token } : { error: "no tokens" };
  } catch (err) {
    return { error: err?.message ?? String(err) };
  } finally { c.close?.(); }
}

console.log("== 1. Fill demo data gaps (all classes) ==");
const gaps = await BR("fillDemoGaps");
console.log(`  attendance sessions added: ${gaps?.sessions ?? 0}`);
console.log(`  published results added:   ${gaps?.results ?? 0}`);
console.log(`  assignments published:     ${gaps?.assignments ?? 0}`);

console.log("\n== 2. Publish demo results & report cards ==");
const pub = await BR("publishDemoResults");
console.log(`  subject results published: ${pub?.resultsPublished ?? 0}`);
console.log(`  report cards published:    ${pub?.cardsPublished ?? 0}`);

console.log("\n== 3. Generate any missing report cards ==");
const gen = await BR("generateDemoReportCards");
console.log(`  report cards generated:    ${gen?.generated ?? 0}`);

console.log("\n== 4. Reverse SMOKE test payments ==");
const rev = await BR("reverseSmokePayment");
console.log(`  payments reversed:         ${rev?.reversed ?? 0}`);

console.log("\n== 5. Purge harness SMOKE students ==");
const purged = await BR1("purgeSmokeEnrollments");
console.log(`  students removed:          ${purged?.studentsRemoved ?? 0}`);
console.log(`  dependent rows removed:    ${(purged?.enrollmentsRemoved ?? 0) + (purged?.scoresRemoved ?? 0) + (purged?.guardiansRemoved ?? 0)}`);

console.log("\n== 6. Parent portal readiness ==");
const parent = await signIn("parent.wanjiku@greenfield.ac.ke", "Parent#2026");
if (!parent.jwt) {
  console.log(`  FAIL: parent sign-in (${parent.error})`);
} else {
  const c = new ConvexHttpClient(url);
  c.setAuth(parent.jwt);
  const kids = await c.query(anyApi.portal.parentChildren, {});
  console.log(`  children linked:           ${kids?.children?.length ?? 0}`);
  let withResults = 0, withFees = 0;
  for (const child of kids?.children ?? []) {
    const ov = await c.query(anyApi.portal.parentChildOverview, { studentId: child.studentId });
    const hasResult = ov?.latestResult != null;
    if (hasResult) withResults++;
    if (ov?.fees) withFees++;
    console.log(
      `   · ${child.name} (${child.className ?? "—"}): attendance=${ov?.attendance?.percentage ?? "—"}% ` +
      `latest=${ov?.latestResult ? `${ov.latestResult.percentage}% ${ov.latestResult.subject}` : "none"} ` +
      `balance=${ov?.fees?.balance ?? "—"}`,
    );
  }
  const ann = await c.query(anyApi.portal.listAnnouncements, {});
  console.log(`  announcements visible:     ${ann?.announcements?.length ?? 0}`);
  console.log(`  children with results:     ${withResults}`);
  console.log(`  children with fee data:    ${withFees}`);
  c.close?.();
}
console.log("\nDONE");
