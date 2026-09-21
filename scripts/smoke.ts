/**
 * SchoolCore Phase 1 smoke test.
 *
 * Verifies authentication, RBAC, tenant isolation and CRUD against a seeded
 * Convex deployment. Safe by construction: it only creates records prefixed
 * `SMOKE-` / `smoke-` (a test student, guardian, staff member and allocation,
 * plus one temporary test user which is deactivated at the end) and never
 * modifies or deletes seeded demo data.
 *
 * Required environment:
 *   SMOKE_CONVEX_URL  – deployment URL to test (e.g. https://<name>.convex.cloud)
 *   SEED_SECRET       – the deployment's configured seed secret (runs the
 *                       idempotent seed/repair first; refuses if unset)
 *
 * Run: SMOKE_CONVEX_URL=https://<name>.convex.cloud SEED_SECRET=… bun scripts/smoke.ts
 */
const url = process.env.SMOKE_CONVEX_URL;
if (!url) {
  console.error("SMOKE_CONVEX_URL is required, e.g. SMOKE_CONVEX_URL=https://<name>.convex.cloud bun scripts/smoke.ts");
  process.exit(1);
}
const SEED_SECRET = process.env.SEED_SECRET;
if (!SEED_SECRET) {
  console.error("SEED_SECRET is required (must match the deployment's configured seed secret).");
  process.exit(1);
}

const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

const SUPER_ADMIN_EMAIL = "admin@schoolcore.dev";
const SUPER_ADMIN_PASSWORD = "ChangeMe!2026";
const GREENFIELD_ADMIN_EMAIL = "admin@greenfield.ac.ke";
const GREENFIELD_ADMIN_PASSWORD = "Greenfield#2026";
const TEACHER_EMAIL = "grace.wanjiku@greenfield.ac.ke";
const TEACHER_PASSWORD = "Greenfield#2026";
const RIVERSIDE_ADMIN_EMAIL = "admin@riverside.ac.ke";
const RIVERSIDE_ADMIN_PASSWORD = "Riverside#2026";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const authSignIn = anyApi.auth.signIn;

async function signIn(email: string, password: string) {
  const c = new ConvexHttpClient(url);
  try {
    const res = await c.action(authSignIn, {
      provider: "password",
      params: { flow: "signIn", email, password },
    });
    if (!res?.tokens) return { jwt: null, refreshToken: null };
    return { jwt: res.tokens.token as string, refreshToken: res.tokens.refreshToken as string };
  } catch (err) {
    return { error: describeErr(err), jwt: null, refreshToken: null };
  } finally {
    c.close?.();
  }
}

function authedClient(jwt: string | null) {
  const c = new ConvexHttpClient(url);
  if (jwt) c.setAuth(jwt);
  return c;
}

/* ------------------------------------------------------------------ */
/* 0. Idempotent seed / repair (self-heals account memberships)        */
/* ------------------------------------------------------------------ */
console.log("== 0. Idempotent seed/repair ==");
{
  const c = new ConvexHttpClient(url);
  try {
    const res = await c.action(anyApi.seed.seedAll, { secret: SEED_SECRET });
    if (res?.skipped) {
      console.log("  Seed already present — memberships self-healed, nothing duplicated.");
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

/* ------------------------------------------------------------------ */
/* 1. Authentication                                                   */
/* ------------------------------------------------------------------ */
console.log("== 1. Authentication ==");
const sa = await signIn(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
check("valid demo authentication issues tokens (super admin)", !!sa.jwt, sa.error ?? "no tokens");
const gf = await signIn(GREENFIELD_ADMIN_EMAIL, GREENFIELD_ADMIN_PASSWORD);
check("valid demo authentication issues tokens (greenfield admin)", !!gf.jwt, gf.error ?? "no tokens");
const teacher = await signIn(TEACHER_EMAIL, TEACHER_PASSWORD);
check("valid demo authentication issues tokens (teacher)", !!teacher.jwt, teacher.error ?? "no tokens");
const rv = await signIn(RIVERSIDE_ADMIN_EMAIL, RIVERSIDE_ADMIN_PASSWORD);
check("valid demo authentication issues tokens (riverside admin)", !!rv.jwt, rv.error ?? "no tokens");

{
  const bad = await signIn(SUPER_ADMIN_EMAIL, "definitely-wrong-password");
  check("invalid password rejected", !!bad.error || !bad.jwt);
  const ghost = await signIn("no-such-user@schoolcore.dev", "whatever-pass-123");
  check("unknown user rejected (no account auto-created)", !!ghost.error || !ghost.jwt);
}

/* ------------------------------------------------------------------ */
/* 2. Sessions / platform & school access                              */
/* ------------------------------------------------------------------ */
console.log("== 2. Sessions, platform and school access ==");
const saClient = authedClient(sa.jwt);
const gfClient = authedClient(gf.jwt);
const teacherClient = authedClient(teacher.jwt);
const rvClient = authedClient(rv.jwt);

let greenfieldId: string | undefined;
let riversideId: string | undefined;
let gfCurrentYearId: string | undefined;
let riversideStudentId: string | undefined;
try {
  const me = await saClient.query(anyApi.accounts.myMemberships, {});
  check("super admin session resolves", !!me && me.email === SUPER_ADMIN_EMAIL);
  check("super admin recognized as platform super admin", !!me && me.isSuperAdmin === true);
  check("super admin has no school membership (routes to /platform)", !!me && (me.memberships ?? []).every((m) => !m.schoolId));

  const schools = await saClient.query(anyApi.schools.listSchools, {});
  const gfSchool = (schools ?? []).find((s) => s.code === "GRN-001");
  const rvSchool = (schools ?? []).find((s) => s.code === "RVS-002");
  check("super admin can list platform schools (both seeded schools visible)", !!gfSchool && !!rvSchool);
  greenfieldId = gfSchool?._id;
  riversideId = rvSchool?._id;

  const gfMe = await gfClient.query(anyApi.accounts.myMemberships, {});
  check(
    "greenfield admin membership resolves to Greenfield Academy",
    !!gfMe && (gfMe.memberships ?? []).some((m) => m.schoolId === greenfieldId && m.role === "school_admin"),
    gfMe ? JSON.stringify(gfMe.memberships) : "null",
  );
  check("greenfield admin is not a super admin", !!gfMe && gfMe.isSuperAdmin === false);

  const years = await gfClient.query(anyApi.academics.listYears, {});
  gfCurrentYearId = (years ?? []).find((y) => y.isCurrent)?._id;
  check("greenfield admin reads own academic structure", !!gfCurrentYearId);

  const gfSections = await gfClient.query(anyApi.academics.listClassSections, {});
  check("greenfield admin reads own class sections", (gfSections ?? []).length > 0);

  const rvMe = await rvClient.query(anyApi.accounts.myMemberships, {});
  check(
    "riverside admin membership resolves to Riverside School",
    !!rvMe && (rvMe.memberships ?? []).some((m) => m.schoolId === riversideId && m.role === "school_admin"),
    rvMe ? JSON.stringify(rvMe.memberships) : "null",
  );
  if (riversideId) {
    const rvStudents = await rvClient.query(anyApi.students.list, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    riversideStudentId = rvStudents?.page?.[0]?._id;
    check("riverside admin reads own students", !!riversideStudentId);
  }
} catch (err) {
  check("sessions / platform / school access", false, describeErr(err));
}

if (!sa.jwt || !gf.jwt || !greenfieldId || !riversideId) {
  console.log(`\nCannot continue without core sessions and school ids. ${pass} passed, ${fail} failed.`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 3. RBAC restrictions                                                */
/* ------------------------------------------------------------------ */
console.log("== 3. RBAC restrictions ==");
{
  let rejected = false;
  try {
    await teacherClient.mutation(anyApi.students.create, {
      admissionNumber: `SMOKE-RBAC-${Date.now()}`,
      firstName: "No", lastName: "Permission",
      studentStatus: "active",
    });
  } catch { rejected = true; }
  check("teacher cannot create students (students.create denied)", rejected);

  rejected = false;
  try {
    await teacherClient.mutation(anyApi.staff.create, {
      employeeNumber: `SMOKE-${Date.now()}`,
      firstName: "No", lastName: "Permission",
      employmentStatus: "active",
    });
  } catch { rejected = true; }
  check("teacher cannot create staff (staff.create denied)", rejected);

  rejected = false;
  try {
    await teacherClient.query(anyApi.schools.listSchools, {});
  } catch { rejected = true; }
  check("teacher cannot list platform schools (platform.schools.view denied)", rejected);
}

/* ------------------------------------------------------------------ */
/* 4. Tenant isolation (Riverside ↔ Greenfield)                        */
/* ------------------------------------------------------------------ */
console.log("== 4. Tenant isolation ==");
{
  try {
    const rvStudents = await rvClient.query(anyApi.students.list, {
      paginationOpts: { numItems: 20, cursor: null },
    });
    check(
      "riverside admin sees only riverside students",
      (rvStudents?.page ?? []).length > 0 && (rvStudents?.page ?? []).every((s) => s.schoolId === riversideId),
    );
  } catch (err) {
    check("riverside admin sees only riverside students", false, describeErr(err));
  }

  // Forged cross-school record IDs must be rejected.
  let rejected = false;
  try {
    await rvClient.query(anyApi.students.get, { studentId: (await gfClient.query(anyApi.students.list, { paginationOpts: { numItems: 1, cursor: null } }))?.page?.[0]?._id });
  } catch { rejected = true; }
  check("riverside admin cannot read a greenfield student by forged ID", rejected);

  rejected = false;
  try {
    const rvForced = await rvClient.query(anyApi.students.list, { paginationOpts: { numItems: 50, cursor: null } });
    rejected = !(rvForced?.page ?? []).every((s) => s.schoolId === riversideId);
  } catch { rejected = true; }
  check("riverside admin's school queries never return greenfield data", !rejected);

  rejected = false;
  try {
    await rvClient.query(anyApi.schools.getMySchool, {});
  } catch { rejected = true; }
  check("riverside admin resolves their own school context", !rejected);

  const gfStudents = await gfClient.query(anyApi.students.list, { paginationOpts: { numItems: 5, cursor: null } });
  check(
    "greenfield admin sees only greenfield students",
    (gfStudents?.page ?? []).length > 0 && (gfStudents?.page ?? []).every((s) => s.schoolId === greenfieldId),
  );
}

/* ------------------------------------------------------------------ */
/* 5. Student CRUD lifecycle (SMOKE- prefixed, archived at the end)    */
/* ------------------------------------------------------------------ */
console.log("== 5. Student CRUD lifecycle ==");
const stamp = Date.now();
const smokeAdmission = `SMOKE-${stamp}`;
let smokeStudentId: string | undefined;
{
  try {
    smokeStudentId = await gfClient.mutation(anyApi.students.create, {
      admissionNumber: smokeAdmission,
      firstName: "Smoke",
      lastName: `Test${stamp}`,
      gender: "female",
      dateOfBirth: "2012-05-10",
      nationality: "Kenyan",
      admissionDate: "2026-01-06",
      studentStatus: "active",
      boardingStatus: "day",
    });
    check("student creation", !!smokeStudentId);
  } catch (err) {
    check("student creation", false, describeErr(err));
  }

  try {
    await gfClient.mutation(anyApi.students.create, {
      admissionNumber: smokeAdmission,
      firstName: "Duplicate", lastName: "Admission",
      studentStatus: "active",
    });
    check("duplicate admission number rejected", false, "second create unexpectedly succeeded");
  } catch {
    check("duplicate admission number rejected", true);
  }

  if (smokeStudentId) {
    try {
      await gfClient.mutation(anyApi.students.update, {
        studentId: smokeStudentId as never,
        firstName: "Smoke",
        lastName: `Test${stamp}-Updated`,
        preferredName: "Smokey",
        gender: "female",
        dateOfBirth: "2012-05-10",
        nationality: "Kenyan",
        admissionDate: "2026-01-06",
        studentStatus: "active",
        boardingStatus: "day",
      });
      const after = await gfClient.query(anyApi.students.get, { studentId: smokeStudentId as never });
      check("student update persists", !!after && after.lastName === `Test${stamp}-Updated`);
    } catch (err) {
      check("student update persists", false, describeErr(err));
    }
  }
}

/* ------------------------------------------------------------------ */
/* 6. Guardian linking                                                 */
/* ------------------------------------------------------------------ */
console.log("== 6. Guardian linking ==");
let smokeGuardianId: string | undefined;
{
  try {
    smokeGuardianId = await gfClient.mutation(anyApi.guardians.create, {
      firstName: "Smoke", lastName: `Guardian${stamp}`,
      relationship: "mother", phone: "+254 700 000 000",
    });
    check("guardian creation", !!smokeGuardianId);
  } catch (err) {
    check("guardian creation", false, describeErr(err));
  }
  if (smokeGuardianId && smokeStudentId) {
    try {
      await gfClient.mutation(anyApi.guardians.linkStudent, {
        guardianId: smokeGuardianId as never,
        studentId: smokeStudentId as never,
        relationship: "mother",
        isPrimary: true,
        isEmergencyContact: true,
      });
      const links = await gfClient.query(anyApi.guardians.forStudentGuardians, { studentId: smokeStudentId as never });
      check("guardian linked to student", (links ?? []).length >= 1);
    } catch (err) {
      check("guardian linked to student", false, describeErr(err));
    }
  }
}

/* ------------------------------------------------------------------ */
/* 7. Enrollment history                                               */
/* ------------------------------------------------------------------ */
console.log("== 7. Academic-year enrollment history ==");
{
  if (smokeStudentId && gfCurrentYearId) {
    const sections = await gfClient.query(anyApi.academics.listClassSections, {});
    const section = (sections ?? [])[0];
    try {
      await gfClient.mutation(anyApi.enrollments.enroll, {
        studentId: smokeStudentId as never,
        academicYearId: gfCurrentYearId as never,
        classSectionId: section._id as never,
        enrollmentDate: "2026-01-06",
      });
      const history = await gfClient.query(anyApi.enrollments.forStudent, { studentId: smokeStudentId as never });
      check("student enrolled for the academic year (history recorded)", (history ?? []).length >= 1);
    } catch (err) {
      check("student enrolled for the academic year (history recorded)", false, describeErr(err));
    }
  }
}

/* ------------------------------------------------------------------ */
/* 8. Staff creation + teacher allocation uniqueness                   */
/* ------------------------------------------------------------------ */
console.log("== 8. Staff & teacher allocations ==");
let smokeStaffId: string | undefined;
let smokeAllocationId: string | undefined;
{
  try {
    smokeStaffId = await gfClient.mutation(anyApi.staff.create, {
      employeeNumber: `SMOKE-${stamp}`,
      firstName: "Smoke", lastName: `Teacher${stamp}`,
      gender: "male",
      email: `smoke.teacher.${stamp}@example.com`,
      jobTitle: "Teacher", department: "Mathematics",
      employmentType: "contract", employmentStatus: "active",
      hireDate: "2026-01-06",
    });
    check("staff creation", !!smokeStaffId);
  } catch (err) {
    check("staff creation", false, describeErr(err));
  }
  if (smokeStaffId && gfCurrentYearId) {
    const subjects = await gfClient.query(anyApi.academics.listSubjects, {});
    const sections = await gfClient.query(anyApi.academics.listClassSections, {});
    const subject = (subjects ?? [])[0];
    const section = (sections ?? [])[0];
    try {
      smokeAllocationId = await gfClient.mutation(anyApi.allocations.create, {
        staffId: smokeStaffId as never,
        subjectId: subject._id as never,
        classSectionId: section._id as never,
        academicYearId: gfCurrentYearId as never,
      });
      check("teacher allocation created", !!smokeAllocationId);
    } catch (err) {
      check("teacher allocation created", false, describeErr(err));
    }
    try {
      await gfClient.mutation(anyApi.allocations.create, {
        staffId: smokeStaffId as never,
        subjectId: subject._id as never,
        classSectionId: section._id as never,
        academicYearId: gfCurrentYearId as never,
      });
      check("duplicate allocation rejected (same teacher/subject/class/year)", false, "second create unexpectedly succeeded");
    } catch {
      check("duplicate allocation rejected (same teacher/subject/class/year)", true);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 9. Admin-created user lifecycle (orphan-user regression test)       */
/* ------------------------------------------------------------------ */
console.log("== 9. Admin-created user lifecycle ==");
const createdEmail = `smoke-user-${stamp}@schoolcore.dev`;
let createdUserId: string | undefined;
{
  try {
    createdUserId = await gfClient.action(anyApi.team.createUser, {
      email: createdEmail,
      name: "Smoke Test User",
      role: "teacher",
      password: "SmokeUser#2026",
    });
    check("school admin created a user via team:createUser", !!createdUserId);
  } catch (err) {
    check("school admin created a user via team:createUser", false, describeErr(err));
  }
  if (createdUserId) {
    const created = await signIn(createdEmail, "SmokeUser#2026");
    check("admin-created user can authenticate", !!created.jwt, created.error ?? "no tokens");
    if (created.jwt) {
      const c = authedClient(created.jwt);
      try {
        const me = await c.query(anyApi.accounts.myMemberships, {});
        check(
          "admin-created user resolves the correct school membership (no orphan user)",
          !!me && me.email === createdEmail && (me.memberships ?? []).some((m) => m.schoolId === greenfieldId),
          me ? JSON.stringify(me.memberships) : "null",
        );
      } finally {
        c.close?.();
      }
    }
    try {
      await gfClient.mutation(anyApi.team.setActive, { userId: createdUserId as never, isActive: false });
      const recheck = await signIn(createdEmail, "SmokeUser#2026");
      check("disabled user cannot authenticate", !!recheck.error || !recheck.jwt);
    } catch (err) {
      check("disabled user cannot authenticate", false, describeErr(err));
    }
  }
}

/* ------------------------------------------------------------------ */
/* 10. Archive smoke student + end smoke allocation (cleanup)          */
/* ------------------------------------------------------------------ */
console.log("== 10. Archive / cleanup ==");
{
  if (smokeStudentId) {
    try {
      await gfClient.mutation(anyApi.students.archive, { studentId: smokeStudentId as never, status: "archived" });
      const after = await gfClient.query(anyApi.students.get, { studentId: smokeStudentId as never });
      check("student archived", !!after && after.studentStatus === "archived");
    } catch (err) {
      check("student archived", false, describeErr(err));
    }
  }
  if (smokeStaffId) {
    try {
      await gfClient.mutation(anyApi.staff.archive, { staffId: smokeStaffId as never, status: "archived" });
      check("smoke staff member archived", true);
    } catch (err) {
      check("smoke staff member archived", false, describeErr(err));
    }
  }
  if (smokeAllocationId) {
    try {
      await gfClient.mutation(anyApi.allocations.end, { allocationId: smokeAllocationId as never });
      check("smoke allocation ended", true);
    } catch (err) {
      check("smoke allocation ended", false, describeErr(err));
    }
  }
}

saClient.close?.();
gfClient.close?.();
teacherClient.close?.();
rvClient.close?.();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
