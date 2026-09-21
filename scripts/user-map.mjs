/**
 * Print the canonical authenticated userId (what sign-in resolves to) and the
 * active memberships for each documented demo account on a deployment.
 * Usage: bun scripts/user-map.mjs <convexUrl>
 */
const url = process.argv[2];
const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

const ACCOUNTS = [
  ["admin@schoolcore.dev", "ChangeMe!2026"],
  ["admin@greenfield.ac.ke", "Greenfield#2026"],
  ["principal@greenfield.ac.ke", "Greenfield#2026"],
  ["accounts@greenfield.ac.ke", "Greenfield#2026"],
  ["grace.wanjiku@greenfield.ac.ke", "Greenfield#2026"],
  ["admin@riverside.ac.ke", "Riverside#2026"],
];

for (const [email, password] of ACCOUNTS) {
  const c = new ConvexHttpClient(url);
  try {
    const res = await c.action(anyApi.auth.signIn, {
      provider: "password",
      params: { flow: "signIn", email, password },
    });
    c.setAuth(res.tokens.token);
    const me = await c.query(anyApi.accounts.myMemberships, {});
    const roles = (me?.memberships ?? [])
      .map((m) => `${m.role} @ ${m.schoolName ?? "platform"}`)
      .join("; ");
    console.log(`${email}\n  canonicalUser: ${me?.userId ?? "?"}  isSuperAdmin=${me?.isSuperAdmin}\n  memberships: ${roles || "none"}`);
  } catch (e) {
    console.log(`${email}\n  SIGN-IN FAILED: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    c.close?.();
  }
}
