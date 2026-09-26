/**
 * TEMPORARY final-verification wrapper (safe to delete).
 * Resolves the live deployment URL from the runtime environment without
 * echoing it, then imports the requested verification script. The wrapper
 * overwrites process.argv[2] with the URL so suites that take the URL as
 * argv[2] (demo-polish.mjs style) work unchanged.
 */
process.env.SMOKE_CONVEX_URL ||= process.env.VITE_CONVEX_URL || "";
if (!process.env.SMOKE_CONVEX_URL) {
  console.log("NO_CONVEX_URL_IN_RUNTIME_ENV");
  process.exit(2);
}
console.log("Deployment URL resolved (not echoed).");
const target = process.argv[2];
process.argv[2] = process.env.SMOKE_CONVEX_URL;
await import(`../${target}`);
