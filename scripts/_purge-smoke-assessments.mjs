/**
 * TEMPORARY cleanup runner (safe to delete): invokes the SMOKE-assessment
 * purge once on the deployment resolved from the runtime environment.
 */
process.env.SMOKE_CONVEX_URL ||= process.env.VITE_CONVEX_URL || "";
if (!process.env.SMOKE_CONVEX_URL) {
  console.log("NO_CONVEX_URL_IN_RUNTIME_ENV");
  process.exit(2);
}
const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");
const c = new ConvexHttpClient(process.env.SMOKE_CONVEX_URL);
try {
  const res = await c.action(anyApi.diagnostics.runInternal, { name: "purgeSmokeAssessments" });
  console.log("purgeSmokeAssessments:", JSON.stringify(res));
} finally {
  c.close?.();
}
