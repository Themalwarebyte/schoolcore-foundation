/**
 * End-to-end authentication test suite against a deployed Convex backend.
 *
 * Covers:
 *  1. Idempotent production seeding (public seed:seedAll with secret)
 *  2. Valid super-admin sign-in → tokens issued
 *  3. Authenticated session resolves (team:me) with super-admin role
 *  4. Session survives a fresh client (JWT persists → refresh retains session)
 *  5. Invalid credentials rejected (checkCredentials + raw auth:signIn)
 *  6. Admin-created user can sign in (controlled workflow, no public signup)
 *  7. Disabled users cannot authenticate (checkCredentials → disabled)
 *  8. Logout invalidates the session server-side
 *  9. Tenant isolation: cross-school reads are rejected
 *
 * Usage: bun scripts/e2e-auth.mjs <convexUrl>
 * No secrets are printed.
 */
const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/e2e-auth.mjs <convexUrl>");
  process.exit(1);
}

const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

const SUPER_ADMIN_EMAIL = "admin@schoolcore.dev";
const SUPER_ADMIN_PASSWORD = "ChangeMe!2026";
const GREENFIELD_ADMIN_EMAIL = "admin@greenfield.ac.ke";
const GREENFIELD_ADMIN_PASSWORD = "Greenfield#2026";
const SEED_SECRET = process.env.SEED_SECRET;
if (!SEED_SECRET) {
  console.error("SEED_SECRET is required (must match the deployment's configured seed secret).");
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function describeErr(err) {
  return err instanceof Error ? err.message : String(err);
}

const authSignIn = anyApi.auth.signIn;
const authSignOut = anyApi.auth.signOut;

/** Sign in via the exact flow the browser uses and return { jwt, refreshToken }. */
async function signIn(email, password) {
  const c = new ConvexHttpClient(url);
  try {
    const res = await c.action(authSignIn, {
      provider: "password",
      params: { flow: "signIn", email, password },
    });
    if (!res || !res.tokens) return { jwt: null, refreshToken: null };
    return { jwt: res.tokens.token, refreshToken: res.tokens.refreshToken };
  } catch (err) {
    return { error: describeErr(err) };
  } finally {
    c.close?.();
  }
}

async function signOutRaw(jwt) {
  const c = new ConvexHttpClient(url);
  try {
    c.setAuth(jwt);
    try {
      await c.mutation(authSignOut, {});
    } catch {
      await c.action(authSignOut, {});
    }
    return true;
  } catch (err) {
    return { error: describeErr(err) };
  } finally {
    c.clearAuth();
    c.close?.();
  }
}

console.log("== 0. Production seeding (idempotent) ==");
{
  const c = new ConvexHttpClient(url);
  try {
    const res = await c.action(anyApi.seed.seedAll, { secret: SEED_SECRET });
    if (res?.skipped) {
      console.log(`  Seed already present — skipped (no duplicates created).`);
    } else {
      console.log(`  Seed created: ${JSON.stringify(res)}`);
    }
    check("seed action completed", true);
  } catch (err) {
    check("seed action completed", false, describeErr(err));
  } finally {
    c.close?.();
  }
}

console.log("== 1. Valid super-admin sign-in ==");
const sa = await signIn(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
check("auth:signIn issues tokens", !!sa.jwt, sa.error ?? "no tokens");
if (!sa.jwt) {
  console.log(`\nCannot continue without a valid super-admin session. ${fail} failure(s).`);
  process.exit(1);
}

const saClient = new ConvexHttpClient(url);
saClient.setAuth(sa.jwt);

console.log("== 2. Authenticated session resolves ==");
{
  const me = await saClient.query(anyApi.team.me, {});
  check(
    "team:me returns the signed-in super admin",
    !!me && me.email === SUPER_ADMIN_EMAIL && me.isSuperAdmin === true,
    me ? `email=${me.email} isSuperAdmin=${me.isSuperAdmin}` : "null",
  );
  check("super admin has no school membership (platform area)", !me || (me.memberships ?? []).every((m) => !m.schoolId));
}

console.log("== 3. Session retained by a fresh client (refresh persistence) ==");
{
  const fresh = new ConvexHttpClient(url);
  try {
    fresh.setAuth(sa.jwt);
    const me = await fresh.query(anyApi.team.me, {});
    check("fresh client with stored JWT resolves the same user", !!me && me.email === SUPER_ADMIN_EMAIL);
  } finally {
    fresh.close?.();
  }
}

console.log("== 4. Invalid credentials are rejected ==");
{
  const c = new ConvexHttpClient(url);
  try {
    const check1 = await c.action(anyApi.accounts.checkCredentials, {
      email: SUPER_ADMIN_EMAIL,
      password: "definitely-wrong-password",
    });
    check("checkCredentials → invalid", check1 && check1.ok === false && check1.reason === "invalid", JSON.stringify(check1));
  } catch (err) {
    check("checkCredentials → invalid", false, describeErr(err));
  } finally {
    c.close?.();
  }
  const bad = await signIn(SUPER_ADMIN_EMAIL, "definitely-wrong-password");
  check("raw auth:signIn with wrong password fails", !!bad.error || !bad.jwt);
  const ghost = await signIn("no-such-user@schoolcore.dev", "whatever-pass-123");
  check("unknown user cannot sign in", !!ghost.error || !ghost.jwt);
}

console.log("== 5. Platform context: list schools (for tenant tests) ==");
let greenfieldId, riversideId, riversideStudentId;
{
  try {
    const schools = await saClient.query(anyApi.schools.listSchools, {});
    const gf = (schools ?? []).find((s) => s.code === "GRN-001");
    const rv = (schools ?? []).find((s) => s.code === "RVS-002");
    check("seeded schools exist (Greenfield + Riverside)", !!gf && !!rv);
    greenfieldId = gf?._id;
    riversideId = rv?._id;
    if (riversideId) {
      const rvStudents = await saClient.query(anyApi.students.list, {
        schoolId: riversideId,
        paginationOpts: { numItems: 1, cursor: null },
      });
      riversideStudentId = rvStudents?.page?.[0]?._id;
      check("riverside student fetched via super-admin school context", !!riversideStudentId);
    }
  } catch (err) {
    check("seeded schools exist (Greenfield + Riverside)", false, describeErr(err));
  }
}

console.log("== 6. Greenfield admin sign-in + own-school access ==");
const gfAdmin = await signIn(GREENFIELD_ADMIN_EMAIL, GREENFIELD_ADMIN_PASSWORD);
check("greenfield admin sign-in", !!gfAdmin.jwt, gfAdmin.error ?? "no tokens");
const gfClient = new ConvexHttpClient(url);
if (gfAdmin.jwt) {
  gfClient.setAuth(gfAdmin.jwt);
  try {
    const me = await gfClient.query(anyApi.team.me, {});
    check(
      "greenfield admin session resolves with school membership",
      !!me && me.email === GREENFIELD_ADMIN_EMAIL && (me.memberships ?? []).some((m) => m.schoolId === greenfieldId),
      me ? JSON.stringify(me.memberships) : "null",
    );
    const students = await gfClient.query(anyApi.students.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    const allOwned = (students?.page ?? []).every((s) => s.schoolId === greenfieldId);
    check("greenfield admin sees only own students", (students?.page?.length ?? 0) > 0 && allOwned);
  } catch (err) {
    check("greenfield admin session resolves with school membership", false, describeErr(err));
  }
}

console.log("== 6b. Remaining documented demo accounts sign in ==");
let principalTokens, accountantTokens, teacherTokens, rvAdminTokens;
{
  principalTokens = await signIn("principal@greenfield.ac.ke", "Greenfield#2026");
  const principal = principalTokens;
  check("principal sign-in", !!principal.jwt, principal.error ?? "no tokens");
  if (principal.jwt) {
    const c = new ConvexHttpClient(url);
    try {
      c.setAuth(principal.jwt);
      const me = await c.query(anyApi.team.me, {});
      check(
        "principal session resolves with greenfield membership",
        !!me && me.email === "principal@greenfield.ac.ke" && (me.memberships ?? []).some((m) => m.schoolId === greenfieldId),
        me ? JSON.stringify(me.memberships) : "null",
      );
    } finally {
      c.close?.();
    }
  }
  accountantTokens = await signIn("accounts@greenfield.ac.ke", "Greenfield#2026");
  const accountant = accountantTokens;
  check("accountant sign-in", !!accountant.jwt, accountant.error ?? "no tokens");
  teacherTokens = await signIn("grace.wanjiku@greenfield.ac.ke", "Greenfield#2026");
  const teacher = teacherTokens;
  check("teacher sign-in", !!teacher.jwt, teacher.error ?? "no tokens");
  rvAdminTokens = await signIn("admin@riverside.ac.ke", "Riverside#2026");
  const rvAdmin = rvAdminTokens;
  check("riverside admin sign-in", !!rvAdmin.jwt, rvAdmin.error ?? "no tokens");
  if (rvAdmin.jwt && riversideId) {
    const c = new ConvexHttpClient(url);
    try {
      c.setAuth(rvAdmin.jwt);
      const rvStudents = await c.query(anyApi.students.list, {
        paginationOpts: { numItems: 10, cursor: null },
      });
      check(
        "riverside admin sees only riverside students",
        (rvStudents?.page ?? []).length > 0 && (rvStudents?.page ?? []).every((s) => s.schoolId === riversideId),
      );
    } finally {
      c.close?.();
    }
  }
}

console.log("== 7. Tenant isolation: cross-school access rejected ==");
{
  let rejected = false;
  let detail = "";
  try {
    await gfClient.query(anyApi.students.list, {
      schoolId: riversideId,
      paginationOpts: { numItems: 5, cursor: null },
    });
    detail = "cross-school list unexpectedly succeeded";
  } catch (err) {
    rejected = true;
    detail = describeErr(err);
  }
  check("greenfield admin cannot list riverside students", rejected, detail);
}
{
  let rejected = false;
  let detail = "";
  try {
    await gfClient.query(anyApi.students.get, { studentId: riversideStudentId });
    detail = "cross-school get unexpectedly succeeded";
  } catch (err) {
    rejected = true;
    detail = describeErr(err);
  }
  check("greenfield admin cannot read a riverside student by ID", rejected, detail);
}

console.log("== 8. Admin-created user can sign in (controlled provisioning) ==");
const createdEmail = `e2e-teacher-${Date.now()}@schoolcore.dev`;
const createdPassword = "E2eTeacher!2026";
let createdUserId;
{
  try {
    createdUserId = await saClient.action(anyApi.team.createUser, {
      email: createdEmail,
      name: "E2E Teacher",
      role: "teacher",
      password: createdPassword,
    });
    check("super admin created a user via team:createUser", !!createdUserId);
  } catch (err) {
    check("super admin created a user via team:createUser", false, describeErr(err));
  }
}
if (createdUserId) {
  const created = await signIn(createdEmail, createdPassword);
  check("admin-created user can sign in", !!created.jwt, created.error ?? "no tokens");
  if (created.jwt) {
    const c = new ConvexHttpClient(url);
    try {
      c.setAuth(created.jwt);
      const me = await c.query(anyApi.team.me, {});
      check("created user's session resolves", !!me && me.email === createdEmail);
    } finally {
      c.close?.();
    }
  }

  console.log("== 9. Disabled users cannot authenticate ==");
  try {
    await saClient.mutation(anyApi.platform.setUserActive, {
      userId: createdUserId,
      isActive: false,
    });
    check("platform admin disabled the test user", true);
  } catch (err) {
    check("platform admin disabled the test user", false, describeErr(err));
  }
  {
    const c = new ConvexHttpClient(url);
    try {
      const check2 = await c.action(anyApi.accounts.checkCredentials, {
        email: createdEmail,
        password: createdPassword,
      });
      check(
        "checkCredentials → disabled",
        check2 && check2.ok === false && check2.reason === "disabled",
        JSON.stringify(check2),
      );
    } catch (err) {
      check("checkCredentials → disabled", false, describeErr(err));
    } finally {
      c.close?.();
    }
    const disabled = await signIn(createdEmail, createdPassword);
    check("disabled user's raw auth:signIn fails", !!disabled.error || !disabled.jwt);
  }
}

console.log("== 6c. RBAC: restricted roles cannot administer users ==");
{
  for (const [label, tokens] of [
    ["teacher", teacherTokens?.jwt],
    ["accountant", accountantTokens?.jwt],
  ]) {
    if (!tokens) continue;
    const c = new ConvexHttpClient(url);
    try {
      c.setAuth(tokens);
      let rejected = false;
      let detail = "";
      try {
        await c.action(anyApi.team.createUser, {
          email: `rbac-probe-${Date.now()}@schoolcore.dev`,
          name: "RBAC Probe",
          role: "teacher",
          password: "Probe#2026x",
        });
        detail = "createUser unexpectedly succeeded";
      } catch (err) {
        rejected = true;
        detail = describeErr(err);
      }
      check(`${label} cannot create users (users.create denied)`, rejected, detail);
    } finally {
      c.close?.();
    }
  }
}

console.log("== 7b. Tenant isolation across every module ==");
{
  const c = new ConvexHttpClient(url);
  try {
    c.setAuth(gfAdmin.jwt);
    const guardians = await c.query(anyApi.guardians.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    check(
      "greenfield admin sees only greenfield guardians",
      (guardians?.page ?? []).length > 0 && (guardians?.page ?? []).every((g) => g.schoolId === greenfieldId),
    );
    const staff = await c.query(anyApi.staff.list, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    check(
      "greenfield admin sees only greenfield staff",
      (staff?.page ?? []).length > 0 && (staff?.page ?? []).every((s) => s.schoolId === greenfieldId),
    );
    const subjects = await c.query(anyApi.academics.listSubjects, {});
    check(
      "greenfield admin sees only greenfield subjects",
      (subjects ?? []).length > 0 && (subjects ?? []).every((s) => s.schoolId === greenfieldId),
    );
    // Sections are scoped server-side to the caller's school's academic year
    // and return enriched rows without schoolId; Riverside's unique "Sun"
    // stream section must therefore never appear in Greenfield's list.
    const sections = await c.query(anyApi.academics.listClassSections, {});
    check(
      "greenfield admin sees only greenfield class sections (no riverside Sun section)",
      (sections ?? []).length > 0 && (sections ?? []).every((s) => s.streamName !== "Sun"),
      JSON.stringify((sections ?? []).map((s) => s.streamName)),
    );
    const mySchool = await c.query(anyApi.schools.getMySchool, {});
    check(
      "greenfield admin's school context is greenfield (not riverside)",
      !!mySchool && mySchool._id === greenfieldId && mySchool.code === "GRN-001",
      mySchool ? `${mySchool.name} (${mySchool.code})` : "null",
    );
  } catch (err) {
    check("tenant isolation across modules", false, describeErr(err));
  } finally {
    c.close?.();
  }
}

console.log("== 8b. School admin creates a user (controlled provisioning) ==");
const gfCreatedEmail = `e2e-gf-${Date.now()}@schoolcore.dev`;
let gfCreatedUserId;
{
  try {
    gfCreatedUserId = await gfClient.action(anyApi.team.createUser, {
      email: gfCreatedEmail,
      name: "GF E2E Teacher",
      role: "teacher",
      password: "GfTeacher#2026",
    });
    check("greenfield admin created a user", !!gfCreatedUserId);
  } catch (err) {
    check("greenfield admin created a user", false, describeErr(err));
  }
  if (gfCreatedUserId) {
    const created = await signIn(gfCreatedEmail, "GfTeacher#2026");
    check("school-admin-created user can sign in", !!created.jwt, created.error ?? "no tokens");
    if (created.jwt) {
      const c = new ConvexHttpClient(url);
      try {
        c.setAuth(created.jwt);
        const me = await c.query(anyApi.team.me, {});
        check(
          "created user resolves into greenfield school context",
          !!me && me.email === gfCreatedEmail && (me.memberships ?? []).some((m) => m.schoolId === greenfieldId),
          me ? JSON.stringify(me.memberships) : "null",
        );
        const students = await c.query(anyApi.students.list, {
          paginationOpts: { numItems: 5, cursor: null },
        });
        check(
          "created user sees greenfield students only",
          (students?.page ?? []).length > 0 && (students?.page ?? []).every((s) => s.schoolId === greenfieldId),
        );
      } finally {
        c.close?.();
      }
    }
    // Remove the temporary test account (deactivate: user rows are referenced
    // by memberships/audit logs, so deactivation is the safe removal).
    try {
      await gfClient.mutation(anyApi.team.setActive, { userId: gfCreatedUserId, isActive: false });
      const recheck = await signIn(gfCreatedEmail, "GfTeacher#2026");
      check("deactivated test user can no longer sign in", !!recheck.error || !recheck.jwt);
    } catch (err) {
      check("deactivated test user can no longer sign in", false, describeErr(err));
    }
  }
}

console.log("== 11. Canonical membership map (sign-in → userId → memberships) ==");
{
  const expectations = [
    [SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, { isSuperAdmin: true }],
    [GREENFIELD_ADMIN_EMAIL, GREENFIELD_ADMIN_PASSWORD, { schoolId: () => greenfieldId, role: "school_admin" }],
    ["principal@greenfield.ac.ke", "Greenfield#2026", { schoolId: () => greenfieldId, role: "principal" }],
    ["accounts@greenfield.ac.ke", "Greenfield#2026", { schoolId: () => greenfieldId, role: "accountant" }],
    ["grace.wanjiku@greenfield.ac.ke", "Greenfield#2026", { schoolId: () => greenfieldId, role: "teacher" }],
    ["admin@riverside.ac.ke", "Riverside#2026", { schoolId: () => riversideId, role: "school_admin" }],
  ];
  for (const [email, password, want] of expectations) {
    const tokens = await signIn(email, password);
    if (!tokens.jwt) {
      check(`membership map: ${email}`, false, tokens.error ?? "no tokens");
      continue;
    }
    const c = new ConvexHttpClient(url);
    try {
      c.setAuth(tokens.jwt);
      const me = await c.query(anyApi.accounts.myMemberships, {});
      const expectedSchoolId = typeof want.schoolId === "function" ? want.schoolId() : want.schoolId;
      // myMemberships only lists ACTIVE memberships (filtered server-side),
      // so presence of the expected school/role pair proves active status.
      const ok =
        !!me &&
        me.email === email &&
        (want.isSuperAdmin ? me.isSuperAdmin === true : true) &&
        (expectedSchoolId
          ? (me.memberships ?? []).some((m) => m.schoolId === expectedSchoolId && m.role === want.role)
          : !(me.memberships ?? []).some((m) => m.schoolId !== null));
      check(
        `membership map: ${email}`,
        ok,
        me ? `userId=${me.userId} memberships=${JSON.stringify(me.memberships)}` : "null",
      );
    } catch (err) {
      check(`membership map: ${email}`, false, describeErr(err));
    } finally {
      c.close?.();
    }
  }
}

console.log("== 10. Logout invalidates the session ==");
{
  const out = await signOutRaw(sa.jwt);
  check("auth:signOut succeeds", out === true, typeof out === "object" ? out.error : "");
  // JWTs are stateless; the authoritative logout semantic is that the stored
  // refresh token can no longer mint new access tokens (auth:signIn with only
  // a refreshToken routes to refreshSession, which returns tokens: null and
  // deletes the session once the token has been invalidated by signOut).
  const c = new ConvexHttpClient(url);
  try {
    const refreshed = await c.action(anyApi.auth.signIn, { refreshToken: sa.refreshToken });
    check("refresh token invalidated after logout", refreshed?.tokens == null, refreshed?.tokens ? "still refreshable" : "");
  } catch (err) {
    check("refresh token invalidated after logout", false, describeErr(err));
  } finally {
    c.close?.();
  }
}

saClient.close?.();
gfClient.close?.();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
