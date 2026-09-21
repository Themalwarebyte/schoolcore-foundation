/**
 * Diagnostic probe: targeted calls that distinguish stale prod functions from
 * error-masking behavior. No secrets printed.
 *
 * Usage: bun scripts/diag-probe.mjs <convexUrl>
 */
const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/diag-probe.mjs <convexUrl>");
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

// 1. users:currentUser signed out — our code throws ConvexError("You are not signed in.")
try {
  const res = await client.query(anyApi.users.currentUser, {});
  console.log("users:currentUser ->", JSON.stringify(res)?.slice(0, 120));
} catch (err) {
  console.log("users:currentUser -> FAILED:");
  console.log(describe(err));
}

// 2. auth:signIn with empty params — Password provider validation should yield
//    a structured ConvexError before touching accounts.
try {
  const res = await client.action(anyApi.auth.signIn, {
    provider: "password",
    params: { flow: "signIn" },
  });
  console.log("auth:signIn(empty) ->", JSON.stringify(res)?.slice(0, 120));
} catch (err) {
  console.log("auth:signIn(empty) -> FAILED:");
  console.log(describe(err));
}

// 3. auth:signIn with an unknown provider id — should be a deterministic local
//    error path in the auth component.
try {
  const res = await client.action(anyApi.auth.signIn, {
    provider: "does-not-exist",
    params: { flow: "signIn" },
  });
  console.log("auth:signIn(bad provider) ->", JSON.stringify(res)?.slice(0, 120));
} catch (err) {
  console.log("auth:signIn(bad provider) -> FAILED:");
  console.log(describe(err));
}
