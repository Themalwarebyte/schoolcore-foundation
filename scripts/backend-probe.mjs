/**
 * Diagnostic probe: call public app queries against a deployment to verify the
 * backend functions are alive. No secrets printed.
 *
 * Usage: bun scripts/backend-probe.mjs <convexUrl>
 */
const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/backend-probe.mjs <convexUrl>");
  process.exit(1);
}

const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

const client = new ConvexHttpClient(url);

function describe(err) {
  const parts = [];
  let e = err;
  while (e) {
    parts.push(
      e.toString() +
        (e.data && typeof e.data === "object" ? ` :: ${JSON.stringify(e.data).slice(0, 300)}` : ""),
    );
    e = e.cause;
  }
  return parts.join("\n  caused by ");
}

for (const [label, ref, args] of [
  ["accounts:myMemberships (public query, null when signed out)", anyApi.accounts.myMemberships, {}],
  ["schools:platformStats (platform query)", anyApi.schools.platformStats, {}],
]) {
  try {
    const res = await client.query(ref, args);
    console.log(`${label} -> OK:`, JSON.stringify(res)?.slice(0, 200));
  } catch (err) {
    console.log(`${label} -> FAILED:`);
    console.log(describe(err));
  }
}
