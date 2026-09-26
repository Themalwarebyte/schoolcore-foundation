/**
 * TEMPORARY final-verification test wrapper (safe to delete).
 * Resolves the deployment URL from THIS process's runtime environment
 * (never printed) and injects it into the bun test child process env.
 */
const { spawnSync } = await import("node:child_process");
process.env.SMOKE_CONVEX_URL ||= process.env.VITE_CONVEX_URL || "";
if (!process.env.SMOKE_CONVEX_URL) {
  console.log("NO_CONVEX_URL_IN_RUNTIME_ENV");
  process.exit(2);
}
console.log("Deployment URL resolved (not echoed). Running bun test…");
const files = process.argv.slice(2);
const r = spawnSync("bun", ["test", ...files], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
