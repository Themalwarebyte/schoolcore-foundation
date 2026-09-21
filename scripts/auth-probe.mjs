/**
 * Diagnostic probe: reproduce the exact client → server call the login form makes
 * (auth:signIn with the Password provider) against a deployment and print the
 * raw server error. Used to diagnose production sign-in failures. No secrets printed.
 *
 * Usage: bun scripts/auth-probe.mjs <convexUrl> <email> <password>
 */
const url = process.argv[2];
const email = process.argv[3];
const password = process.argv[4];
if (!url || !email || !password) {
  console.error("usage: bun scripts/auth-probe.mjs <convexUrl> <email> <password>");
  process.exit(1);
}

const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

const authSignIn = anyApi.auth.signIn; // { provider, params, verifier }

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

try {
  const res = await client.action(authSignIn, {
    provider: "password",
    params: { flow: "signIn", email, password },
  });
  console.log("SIGN-IN OK (tokens issued)");
} catch (err) {
  console.log("SIGN-IN FAILED:");
  console.log(describe(err));
}
