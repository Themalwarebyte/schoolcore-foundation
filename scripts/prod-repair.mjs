/**
 * Run the idempotent seed/self-heal repair against a deployment, then print
 * the account audit for every documented demo account.
 *
 * Usage: bun scripts/prod-repair.mjs <convexUrl>
 * No secrets are printed (demo credentials are documented in the README).
 */
const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/prod-repair.mjs <convexUrl>");
  process.exit(1);
}

const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

const SEED_SECRET = "schoolcore-dev-seed"; // documented demo guard, not a production secret
const DEMO_ACCOUNTS = [
  "admin@schoolcore.dev",
  "admin@greenfield.ac.ke",
  "principal@greenfield.ac.ke",
  "accounts@greenfield.ac.ke",
  "grace.wanjiku@greenfield.ac.ke",
  "admin@riverside.ac.ke",
];

const c = new ConvexHttpClient(url);
try {
  console.log("== Repair (idempotent seed + self-heal) ==");
  const res = await c.action(anyApi.seed.seedAll, { secret: SEED_SECRET });
  console.log(JSON.stringify(res));

  console.log("\n== Account audits ==");
  for (const email of DEMO_ACCOUNTS) {
    const audit = await c.action(anyApi.diagnostics.accountAudit, { email });
    const canonical = audit.canonicalUserId ?? "(no password account)";
    const roles = audit.membershipsOnCanonicalUser
      .map((m) => `${m.role}@${m.schoolName ?? "platform"}:${m.status}`)
      .join(", ");
    console.log(
      `${email}\n  canonicalUser: ${canonical}  active=${audit.canonicalUserActive}\n` +
      `  usersRows=${audit.usersRowCount}  membershipsOnCanonical=[${roles || "NONE"}]` +
      (audit.usersRowCount > 1
        ? `\n  allRows: ${audit.allUserRows
            .map(
              (r) =>
                `${r.userId}${r.isCanonical ? " (canonical)" : ""} -> ${r.memberships
                  .map((m) => `${m.role}@${m.schoolName ?? "platform"}:${m.status}`)
                  .join(", ") || "no memberships"}`,
            )
            .join(" | ")}`
        : ""),
    );
  }
} catch (e) {
  console.log("FAILED:", e instanceof Error ? e.message : String(e));
} finally {
  c.close?.();
}
