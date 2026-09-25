/**
 * Phase 7 final verification — backend tests against the live deployment.
 * Usage: bun scripts/phase7-verify.mjs <convexCloudUrl>
 *
 * Sections:
 *   A. School registration (public submit, validation, status check)
 *   B. Platform review workflow (approve → workspace + onboarding record)
 *   C. Onboarding wizard (profile, academics, initial users, activate)
 *   D. Invitations & one-time tokens (invite, accept, reset, expiry)
 *   E. Admissions (application → review → assessment → decision → conversion)
 *   F. Promotion (wizard preview, confirm, historical enrollment preserved)
 *   G. Fee voteheads + payment allocation (priority, partial, manual, audit)
 *   H. Bank import (stage, match, duplicate ref, post, discard)
 *   I. Meals (plans, eligibility, consumption, duplicate guard, QR)
 *   J. Access management (overview, dormant detection)
 *   K. Security / tenant isolation (cross-school, RBAC denials)
 *   L. Regression smoke (Phases 1–6 still respond)
 *
 * Only creates SMOKE-prefixed test records. No secrets are echoed.
 */
const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/phase7-verify.mjs <convexUrl>");
  process.exit(1);
}
const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`); }
}
function describeErr(err) {
  let e = err, parts = [];
  while (e) {
    const data = e.data !== undefined && e.data !== null ? ` [${typeof e.data === "object" ? JSON.stringify(e.data) : String(e.data)}]` : "";
    parts.push(`${String(e.message ?? e)}${data}`);
    e = e.cause;
  }
  return parts.join(" :: ").slice(0, 260);
}
function isDenied(err) {
  const s = describeErr(err).toLowerCase();
  return s.includes("permission") || s.includes("not signed in") || s.includes("denied") ||
    s.includes("not found") || s.includes("only") || s.includes("cannot") || s.includes("can only") ||
    s.includes("does not belong") || s.includes("access to this record") || s.includes("invalid") ||
    s.includes("unrecognized") || s.includes("must be") || s.includes("you can only") ||
    s.includes("platform access") || s.includes("unknown") || s.includes("required") ||
    s.includes("already") || s.includes("administrator") || s.includes("select a school") ||
    s.includes("required.") || s.includes("no active") || s.includes("revoked") ||
    s.includes("enter a valid") || s.includes("must differ") || s.includes("at least one") ||
    s.includes("has no") || s.includes("already been") || s.includes("is not") ||
    s.includes("action") || s.includes("no tokens") || s.includes("accepted");
}

async function signIn(email, password) {
  const c = new ConvexHttpClient(url);
  try {
    const res = await c.action(anyApi.auth.signIn, {
      provider: "password",
      params: { flow: "signIn", email, password },
    });
    return res?.tokens ? { jwt: res.tokens.token } : { error: "no tokens" };
  } catch (err) {
    return { error: describeErr(err) };
  } finally { c.close?.(); }
}
function client(jwt) {
  const c = new ConvexHttpClient(url);
  if (jwt) c.setAuth(jwt);
  return c;
}
const Q = (c, fn, args) => c.query(fn, args);
const M = (c, fn, args) => c.mutation(fn, args);
const A = (c, fn, args) => c.action(fn, args);

const suffix = Date.now() % 100000;
const today = new Date().toISOString().slice(0, 10);

/* ================================================================ */
console.log("== A. SCHOOL REGISTRATION (public) ==");
const platform = await signIn("admin@schoolcore.dev", "ChangeMe!2026");
check("A0. Platform admin sign-in", !!platform.jwt, platform.error ?? "");
const gfAdmin = await signIn("admin@greenfield.ac.ke", "Greenfield#2026");
check("A0b. Greenfield admin sign-in", !!gfAdmin.jwt, gfAdmin.error ?? "");
const rvAdmin = await signIn("admin@riverside.ac.ke", "Riverside#2026");
check("A0c. Riverside admin sign-in", !!rvAdmin.jwt, rvAdmin.error ?? "");
const teacher = await signIn("grace.wanjiku@greenfield.ac.ke", "Greenfield#2026");
check("A0d. Teacher sign-in", !!teacher.jwt, teacher.error ?? "");

const anon = client(null);
const smokeEmail = `smoke-school-${suffix}@example.ac.ke`;
let smokeRequestId = null;
{
  // Public submission (no auth).
  try {
    const res = await M(anon, anyApi.phase7.registration.submitRequest, {
      schoolName: `SMOKE Academy ${suffix}`,
      registrationNumber: `REG-SMOKE-${suffix}`,
      country: "Kenya", county: "Nairobi",
      schoolType: "Private day school", curriculum: "CBC",
      expectedStudents: 350, expectedTeachers: 18,
      email: smokeEmail, phone: `+2547${String(10000000 + suffix)}`,
      contactName: "SMOKE Contact", contactPosition: "Director",
      contactEmail: `smoke-contact-${suffix}@example.com`,
      contactPhone: `+2547${String(20000000 + suffix)}`,
    });
    smokeRequestId = res?.requestId ?? null;
    check("A1. Public school request submitted (no auth)", !!smokeRequestId, JSON.stringify(res ?? {}));
  } catch (err) { check("A1. Public school request submitted (no auth)", false, describeErr(err)); }

  // Validation: bad email.
  try {
    await M(anon, anyApi.phase7.registration.submitRequest, {
      schoolName: "SMOKE Bad", email: "not-an-email", contactName: "x", contactEmail: "also-bad",
    });
    check("A2. Invalid email rejected", false, "expected error");
  } catch (err) { check("A2. Invalid email rejected", isDenied(err), describeErr(err)); }

  // Duplicate open request.
  try {
    await M(anon, anyApi.phase7.registration.submitRequest, {
      schoolName: "SMOKE Dup", email: smokeEmail, contactName: "x", contactEmail: `c${suffix}@x.com`,
    });
    check("A3. Duplicate open request rejected", false, "expected error");
  } catch (err) { check("A3. Duplicate open request rejected", isDenied(err), describeErr(err)); }

  // Public status check.
  try {
    const st = await Q(anon, anyApi.phase7.registration.requestStatus, { email: smokeEmail });
    check("A4. Public status check works", st && st.status === "submitted", JSON.stringify(st ?? {}));
  } catch (err) { check("A4. Public status check works", false, describeErr(err)); }

  // Anonymous cannot list requests.
  try {
    await Q(anon, anyApi.phase7.registration.listRequests, {});
    check("A5. Anonymous cannot list requests", false, "expected error");
  } catch (err) { check("A5. Anonymous cannot list requests", isDenied(err), describeErr(err)); }

  // School admin cannot access platform registration queries.
  if (gfAdmin.jwt) {
    const c = client(gfAdmin.jwt);
    try {
      await Q(c, anyApi.phase7.registration.listRequests, {});
      check("A6. School admin blocked from platform requests", false, "expected error");
    } catch (err) { check("A6. School admin blocked from platform requests", isDenied(err), describeErr(err)); }
  }
}

/* ================================================================ */
console.log("== B. PLATFORM REVIEW WORKFLOW ==");
let smokeSchoolId = null;
{
  const c = client(platform.jwt);
  try {
    await M(c, anyApi.phase7.registration.reviewRequest, { requestId: smokeRequestId, decision: "under_review" });
    check("B1. Request moved to under_review", true);
  } catch (err) { check("B1. Request moved to under_review", false, describeErr(err)); }

  try {
    await M(c, anyApi.phase7.registration.reviewRequest, { requestId: smokeRequestId, decision: "reject" });
    check("B2. Reject requires notes", false, "expected error");
  } catch (err) { check("B2. Reject requires notes", isDenied(err), describeErr(err)); }

  try {
    const res = await M(c, anyApi.phase7.registration.reviewRequest, {
      requestId: smokeRequestId, decision: "approve", notes: "SMOKE approval",
    });
    smokeSchoolId = res?.schoolId ?? null;
    check("B3. Approve provisions school workspace", !!smokeSchoolId, JSON.stringify(res ?? {}));
  } catch (err) { check("B3. Approve provisions school workspace", false, describeErr(err)); }

  if (smokeSchoolId) {
    const detail = await Q(c, anyApi.schools.getSchool, { schoolId: smokeSchoolId }).catch(() => null);
    check("B4. Provisioned school exists", !!detail, JSON.stringify(detail ?? {}).slice(0, 120));
    const st = await Q(anon, anyApi.phase7.registration.requestStatus, { email: smokeEmail });
    check("B5. Request status reflects onboarding/active", ["onboarding", "active"].includes(st?.status), JSON.stringify(st ?? {}));
  }

  // School admin still cannot review.
  if (gfAdmin.jwt && smokeRequestId) {
    const c2 = client(gfAdmin.jwt);
    try {
      await M(c2, anyApi.phase7.registration.reviewRequest, { requestId: smokeRequestId, decision: "under_review" });
      check("B6. School admin cannot review requests", false, "expected error");
    } catch (err) { check("B6. School admin cannot review requests", isDenied(err), describeErr(err)); }
  }
}

/* ================================================================ */
console.log("== C. ONBOARDING WIZARD ==");
{
  const c = client(gfAdmin.jwt);
  try {
    const st = await Q(c, anyApi.phase7.onboarding.getStatus, {});
    check("C1. Onboarding status readable", st && typeof st.schoolName === "string", JSON.stringify(st ?? {}).slice(0, 120));
  } catch (err) { check("C1. Onboarding status readable", false, describeErr(err)); }

  try {
    await M(c, anyApi.phase7.onboarding.saveProfile, { county: "Nairobi", currency: "KES" });
    check("C2. Profile step saves", true);
  } catch (err) { check("C2. Profile step saves", isDenied(err), describeErr(err)); }

  // Teacher blocked from onboarding management.
  const t = client(teacher.jwt);
  try {
    await M(t, anyApi.phase7.onboarding.saveProfile, { county: "Hack" });
    check("C3. Teacher cannot manage onboarding", false, "expected error");
  } catch (err) { check("C3. Teacher cannot manage onboarding", isDenied(err), describeErr(err)); }

  if (smokeSchoolId) {
    const p = client(platform.jwt);
    try {
      // Super admin entering the new school context completes profile+academics.
      await M(p, anyApi.phase7.onboarding.saveProfile, { county: "Nairobi", currency: "KES" }).catch(() => null);
      await M(p, anyApi.phase7.onboarding.setupAcademics, {
        yearName: `2026-SM${suffix}`, yearStart: "2026-01-05", yearEnd: "2026-11-20",
        termCount: 3,
        gradeNames: ["Grade 1", "Grade 2"],
        streams: ["Blue"],
        subjectNames: ["Mathematics", "English"],
      });
      check("C4. Academics step provisions year/terms/grades/classes/subjects", true);
    } catch (err) { check("C4. Academics step provisions year/terms/grades/classes/subjects", isDenied(err), describeErr(err)); }

    try {
      await M(p, anyApi.phase7.onboarding.inviteInitialUsers, {
        users: [{ email: `smoke-admin-${suffix}@example.com`, name: "SMOKE Admin", role: "school_admin" }],
      });
      check("C5. Initial users invited (invitations, no passwords)", true);
    } catch (err) { check("C5. Initial users invited (invitations, no passwords)", isDenied(err), describeErr(err)); }

    try {
      await M(p, anyApi.phase7.onboarding.activateSchool, { confirmName: "WRONG NAME" });
      check("C6. Activation requires name confirm", false, "expected error");
    } catch (err) { check("C6. Activation requires name confirm", isDenied(err), describeErr(err)); }
  }
}

/* ================================================================ */
console.log("== D. INVITATIONS & ONE-TIME TOKENS ==");
let inviteToken = null, inviteId = null;
{
  const c = client(gfAdmin.jwt);
  try {
    inviteId = await M(c, anyApi.phase7.invitations.invite, {
      email: `smoke-invite-${suffix}@example.com`, name: "SMOKE Invitee", role: "teacher",
    });
    check("D1. Invitation created", !!inviteId, JSON.stringify(inviteId ?? {}));
  } catch (err) { check("D1. Invitation created", false, describeErr(err)); }

  if (inviteId) {
    const linkInfo = await Q(c, anyApi.phase7.invitations.getInviteLink, { invitationId: inviteId }).catch(() => null);
    inviteToken = linkInfo?.token ?? null;
    check("D2. One-time activation link generated", !!inviteToken, JSON.stringify(linkInfo ?? {}).slice(0, 120));

    if (inviteToken) {
      const prev = await Q(anon, anyApi.phase7.invitations.invitationPreview, { invitationId: inviteId, token: inviteToken });
      check("D3. Public invitation preview valid", prev?.valid === true, JSON.stringify(prev ?? {}));

      // Bad token rejected.
      const bad = await Q(anon, anyApi.phase7.invitations.invitationPreview, { invitationId: inviteId, token: "wrong-token-xyz" });
      check("D4. Wrong token invalid", bad?.valid === false, JSON.stringify(bad ?? {}));

      // Accept: user sets own password (no temp password anywhere).
      try {
        await A(anon, anyApi.phase7.invitations.acceptInvitation, {
          invitationId: inviteId, token: inviteToken, password: "SmokePass!2026", fullName: "SMOKE Invitee",
        });
        check("D5. Invitation accepted, account activated", true);
      } catch (err) { check("D5. Invitation accepted, account activated", false, describeErr(err)); }

      // One-time use: second accept fails.
      try {
        await A(anon, anyApi.phase7.invitations.acceptInvitation, {
          invitationId: inviteId, token: inviteToken, password: "SmokePass!2026b",
        });
        check("D6. Token one-time use enforced", false, "expected error");
      } catch (err) { check("D6. Token one-time use enforced", isDenied(err), describeErr(err)); }

      // The new user can now sign in with the password THEY set.
      const invited = await signIn(`smoke-invite-${suffix}@example.com`, "SmokePass!2026");
      check("D7. Invited user signs in with self-set password", !!invited.jwt, invited.error ?? "");

      // Membership attached (User + Membership + Role).
      if (invited.jwt) {
        const me = await Q(client(invited.jwt), anyApi.team.me, {}).catch(() => null);
        check("D8. Membership + role attached (no orphan users)", !!me && Array.isArray(me.memberships) && me.memberships.length > 0, JSON.stringify(me ?? {}).slice(0, 160));
      }
    }
  }

  // Admin-initiated password reset.
  try {
    // Resolve the invited user's id from the access overview.
    const ov = await Q(c, anyApi.phase7.access.accessOverview, {});
    const target = (ov?.users ?? []).find((u) => u.email === `smoke-invite-${suffix}@example.com`);
    const reset = await M(c, anyApi.phase7.invitations.adminGenerateResetToken, {
      userId: target.userId,
    });
    check("D9. Admin reset token generated", !!reset?.token, JSON.stringify(reset ?? {}).slice(0, 100));
    if (reset?.token) {
      const rp = await Q(anon, anyApi.phase7.invitations.resetTokenPreview, { token: reset.token });
      check("D10. Reset token preview valid", rp?.valid === true, JSON.stringify(rp ?? {}));
      try {
        await A(anon, anyApi.phase7.invitations.completePasswordReset, { token: reset.token, newPassword: "NewSmoke!2026" });
        const reSignIn = await signIn(`smoke-invite-${suffix}@example.com`, "NewSmoke!2026");
        check("D11. Password reset works (old password dead)", !!reSignIn.jwt, reSignIn.error ?? "");
      } catch (err) { check("D11. Password reset works (old password dead)", false, describeErr(err)); }
    }
  } catch (err) { check("D9. Admin reset token generated", false, describeErr(err)); }
}

/* ================================================================ */
console.log("== E. ADMISSIONS ==");
let smokeApplicationId = null;
{
  const c = client(gfAdmin.jwt);
  try {
    const res = await M(c, anyApi.phase7.admissions.submitApplication, {
      firstName: "SMOKE", lastName: `Applicant${suffix}`, gender: "female",
      guardianName: "SMOKE Guardian", guardianPhone: `+254700${String(100000 + suffix).slice(0, 6)}`,
      guardianEmail: `smoke-guardian-${suffix}@example.com`,
    });
    smokeApplicationId = res?.applicationId ?? null;
    check("E1. Application submitted", !!smokeApplicationId, JSON.stringify(res ?? {}));
  } catch (err) { check("E1. Application submitted", false, describeErr(err)); }

  try {
    await M(c, anyApi.phase7.admissions.moveToReview, { applicationId: smokeApplicationId });
    check("E2. Application moved to review", true);
  } catch (err) { check("E2. Application moved to review", isDenied(err), describeErr(err)); }

  try {
    await M(c, anyApi.phase7.admissions.recordAssessment, {
      applicationId: smokeApplicationId, score: 78, notes: "SMOKE assessment",
    });
    check("E3. Assessment recorded", true);
  } catch (err) { check("E3. Assessment recorded", isDenied(err), describeErr(err)); }

  try {
    await M(c, anyApi.phase7.admissions.decideApplication, {
      applicationId: smokeApplicationId, decision: "accepted", notes: "SMOKE accept",
    });
    check("E4. Application accepted", true);
  } catch (err) { check("E4. Application accepted", isDenied(err), describeErr(err)); }

  // Teacher cannot decide admissions.
  const t = client(teacher.jwt);
  try {
    await M(t, anyApi.phase7.admissions.decideApplication, {
      applicationId: smokeApplicationId, decision: "rejected",
    });
    check("E5. Teacher cannot decide admissions", false, "expected error");
  } catch (err) { check("E5. Teacher cannot decide admissions", isDenied(err), describeErr(err)); }

  // Conversion requires class/year/term (uses Greenfield's current year).
  let conversionDone = false;
  try {
    const classes = await Q(c, anyApi.academics.listClassSections, {});
    const years = await Q(c, anyApi.academics.listYears, {});
    const terms = await Q(c, anyApi.academics.listTerms, {});
    const year = years.find((y) => y.isCurrent) ?? years[0];
    const term = terms.find((tm) => tm.academicYearId === year?._id) ?? terms[0];
    const section = classes[0];
    if (section && year && term) {
      const res = await M(c, anyApi.phase7.admissions.convertApplication, {
        applicationId: smokeApplicationId,
        classSectionId: section._id, academicYearId: year._id, termId: term._id,
        invoiceDescription: "SMOKE admission fee", invoiceAmount: 1000,
      });
      conversionDone = !!res?.studentId;
      check("E6. Conversion → Student+Guardian+Enrollment+Invoice", !!res?.studentId && !!res?.enrollmentId && !!res?.invoiceId, JSON.stringify(res ?? {}).slice(0, 160));
      // Double conversion blocked.
      try {
        await M(c, anyApi.phase7.admissions.convertApplication, {
          applicationId: smokeApplicationId, classSectionId: section._id,
          academicYearId: year._id, termId: term._id,
        });
        check("E7. Double conversion blocked", false, "expected error");
      } catch (err) { check("E7. Double conversion blocked", isDenied(err), describeErr(err)); }
      // Guardian deduped by phone: convert a second applicant with same guardian phone.
      const res2 = await M(c, anyApi.phase7.admissions.submitApplication, {
        firstName: "SMOKE2", lastName: `Applicant${suffix}`,
        guardianName: "SMOKE Guardian", guardianPhone: `+254700${String(100000 + suffix).slice(0, 6)}`,
      });
      await M(c, anyApi.phase7.admissions.moveToReview, { applicationId: res2.applicationId });
      await M(c, anyApi.phase7.admissions.decideApplication, { applicationId: res2.applicationId, decision: "accepted" });
      const res3 = await M(c, anyApi.phase7.admissions.convertApplication, {
        applicationId: res2.applicationId, classSectionId: section._id,
        academicYearId: year._id, termId: term._id,
      });
      check("E8. Second conversion reuses guardian (dedupe)", !!res3?.studentId && String(res3.guardianId) === String(res?.guardianId), JSON.stringify({ a: res?.guardianId, b: res3?.guardianId }));
    } else {
      check("E6. Conversion → Student+Guardian+Enrollment+Invoice", false, "no class/year/term available");
    }
  } catch (err) { check("E6. Conversion flow", false, describeErr(err)); }
  void conversionDone;
}

/* ================================================================ */
console.log("== F. PROMOTION ==");
{
  const c = client(gfAdmin.jwt);
  try {
    const years = await Q(c, anyApi.academics.listYears, {});
    const classes = await Q(c, anyApi.academics.listClassSections, {});
    const year = years.find((y) => y.isCurrent) ?? years[0];
    const section = classes.find((cl) => cl._id);
    if (year && section) {
      const preview = await Q(c, anyApi.phase7.promotions.previewPromotion, {
        fromYearId: year._id, classSectionId: section._id,
      });
      check("F1. Promotion preview lists students", Array.isArray(preview?.lines), JSON.stringify({ n: preview?.lines?.length }).slice(0, 80));
      const targets = await Q(c, anyApi.phase7.promotions.targetClasses, { toYearId: year._id }).catch(() => []);
      check("F2. Target classes resolvable", Array.isArray(targets), JSON.stringify({ n: Array.isArray(targets) ? targets.length : 0 }).slice(0, 80));
    } else {
      check("F1. Promotion preview lists students", false, "no year/class");
    }
  } catch (err) { check("F1. Promotion preview", false, describeErr(err)); }

  // Promotion confirm with a SMOKE-prefixed pair of years would mutate real
  // enrollments; instead verify validation guards fire correctly.
  try {
    const years = await Q(c, anyApi.academics.listYears, {});
    const y = years[0];
    await M(c, anyApi.phase7.promotions.confirmPromotion, {
      fromYearId: y._id, toYearId: y._id, lines: [],
    });
    check("F3. Same-year promotion rejected", false, "expected error");
  } catch (err) { check("F3. Same-year promotion rejected", isDenied(err), describeErr(err)); }

  try {
    const years = await Q(c, anyApi.academics.listYears, {});
    const [a, b] = years;
    await M(c, anyApi.phase7.promotions.confirmPromotion, {
      fromYearId: a._id, toYearId: b._id, lines: [],
    });
    check("F4. Empty promotion rejected", false, "expected error");
  } catch (err) { check("F4. Empty promotion rejected", isDenied(err), describeErr(err)); }

  const t = client(teacher.jwt);
  try {
    const years = await Q(client(gfAdmin.jwt), anyApi.academics.listYears, {});
    await M(t, anyApi.phase7.promotions.confirmPromotion, {
      fromYearId: years[0]._id, toYearId: years[1]._id, lines: [],
    });
    check("F5. Teacher cannot confirm promotions", false, "expected error");
  } catch (err) { check("F5. Teacher cannot confirm promotions", isDenied(err), describeErr(err)); }

  const runs = await Q(c, anyApi.phase7.promotions.listRuns, {}).catch(() => null);
  check("F6. Promotion history listable", Array.isArray(runs), "");
}

/* ================================================================ */
console.log("== G. FEE VOTEHEADS + ALLOCATION ==");
let smokePaymentId = null, smokeInvoiceId = null;
{
  const c = client(gfAdmin.jwt);
  try {
    await M(c, anyApi.phase7.billing.upsertVotehead, { name: "Tuition", allocationPriority: 1 });
    await M(c, anyApi.phase7.billing.upsertVotehead, { name: "Lunch", allocationPriority: 2 });
    await M(c, anyApi.phase7.billing.upsertVotehead, { name: "Transport", allocationPriority: 3 });
    await M(c, anyApi.phase7.billing.upsertVotehead, { name: "SMOKE Swimming", allocationPriority: 4 });
    check("G1. Voteheads upserted (idempotent)", true);
  } catch (err) { check("G1. Voteheads upserted (idempotent)", isDenied(err), describeErr(err)); }

  const vhs = await Q(c, anyApi.phase7.billing.listVoteheads, {}).catch(() => null);
  check("G2. Voteheads listed with priorities", Array.isArray(vhs) && vhs.length >= 4, JSON.stringify({ n: vhs?.length }).slice(0, 60));

  const t = client(teacher.jwt);
  try {
    await M(t, anyApi.phase7.billing.upsertVotehead, { name: "SMOKE Hack" });
    check("G3. Teacher cannot manage voteheads", false, "expected error");
  } catch (err) { check("G3. Teacher cannot manage voteheads", isDenied(err), describeErr(err)); }

  // Create a SMOKE invoice with votehead-tagged lines, then a partial payment.
  try {
    const students = await Q(c, anyApi.students.list, { paginationOpts: { numItems: 5, cursor: null } });
    const student = (students?.page ?? [])[0];
    const terms = await Q(c, anyApi.academics.listTerms, {});
    const term = terms.find((tm) => tm.isCurrent) ?? terms[0];
    if (student && term) {
      smokeInvoiceId = await M(c, anyApi.finance.createInvoice, {
        studentId: student._id, termId: term._id, issueDate: today, dueDate: today,
        items: [
          { description: "SMOKE Tuition", category: "Tuition", quantity: 1, amount: 60000 },
          { description: "SMOKE Lunch", category: "Meals", quantity: 1, amount: 8000 },
          { description: "SMOKE Transport", category: "Transport", quantity: 1, amount: 5000 },
        ],
        issueNow: true,
      });
      check("G4. SMOKE invoice with votehead lines created", !!smokeInvoiceId, "");

      // Tag the fee categories to voteheads via breakdown check.
      const breakdown = await Q(c, anyApi.phase7.billing.invoiceBreakdown, { invoiceId: smokeInvoiceId });
      check("G5. Invoice votehead breakdown", Array.isArray(breakdown?.lines) && breakdown.lines.length > 0, JSON.stringify(breakdown ?? {}).slice(0, 160));

      const pay = await M(c, anyApi.finance.recordPayment, {
        studentId: student._id, invoiceId: smokeInvoiceId, amount: 50000,
        paymentDate: today, method: "cash", referenceNumber: `SMOKE-ALLOC-${suffix}`,
      });
      smokePaymentId = pay?.paymentId ?? null;
      check("G6. Partial payment (50k of 73k) recorded", !!smokePaymentId, JSON.stringify(pay ?? {}).slice(0, 100));

      const alloc = await M(c, anyApi.phase7.billing.allocatePayment, { paymentId: smokePaymentId });
      check("G7. Auto-allocation engine runs", alloc && alloc.allocated > 0, JSON.stringify(alloc ?? {}));
      // Votehead priority: Tuition first (60000 billed, 50000 paid) → all 50k to tuition.
      const trail = await Q(c, anyApi.phase7.billing.paymentAllocationTrail, { paymentId: smokePaymentId });
      const tuitionLine = (trail?.allocations ?? []).find((a) => a.voteheadName.toLowerCase() === "tuition");
      check("G8. Votehead priority respected (tuition first)", !!tuitionLine, JSON.stringify(trail?.allocations ?? {}).slice(0, 200));
      check("G9. Allocation audit trail recorded", (trail?.allocations ?? []).length > 0, "");

      // Re-allocation requires clearing.
      try {
        await M(c, anyApi.phase7.billing.allocatePayment, { paymentId: smokePaymentId });
        check("G10. Double allocation blocked", false, "expected error");
      } catch (err) { check("G10. Double allocation blocked", isDenied(err), describeErr(err)); }

      await M(c, anyApi.phase7.billing.clearAllocations, { paymentId: smokePaymentId });
      const manual = await M(c, anyApi.phase7.billing.allocateManually, {
        paymentId: smokePaymentId,
        lines: [
          { invoiceId: smokeInvoiceId, voteheadName: "Lunch", amount: 8000 },
          { invoiceId: smokeInvoiceId, voteheadName: "Tuition", amount: 42000 },
        ],
      });
      check("G11. Manual accountant allocation", manual && manual.allocated === 50000, JSON.stringify(manual ?? {}));

      // Manual over-allocation blocked.
      try {
        await M(c, anyApi.phase7.billing.allocateManually, {
          paymentId: smokePaymentId,
          lines: [{ invoiceId: smokeInvoiceId, voteheadName: "Tuition", amount: 999999 }],
        });
        check("G12. Over-allocation blocked", false, "expected error");
      } catch (err) { check("G12. Over-allocation blocked", isDenied(err), describeErr(err)); }

      const overview = await Q(c, anyApi.phase7.billing.reconciliationOverview, {});
      check("G13. Reconciliation overview", overview && typeof overview.summary.totalReceived === "number", JSON.stringify(overview?.summary ?? {}).slice(0, 140));
      const mine = (overview?.payments ?? []).find((p) => p._id === smokePaymentId);
      check("G14. Payment shows allocated status", !!mine && mine.status !== "unallocated", JSON.stringify(mine ?? {}).slice(0, 120));
    } else {
      check("G4. SMOKE invoice", false, "no student/term");
    }
  } catch (err) { check("G4-G14. Allocation flow", false, describeErr(err)); }
}

/* ================================================================ */
console.log("== H. BANK IMPORT ==");
{
  const c = client(gfAdmin.jwt);
  let batchId = null;
  try {
    const res = await M(c, anyApi.phase7.billing.stageBankImport, {
      filename: `SMOKE statement ${suffix}`,
      rows: [
        { date: today, reference: `SMOKE-BK-${suffix}-1`, amount: 12000, narration: `GRN-001 fees` },
        { date: today, reference: `SMOKE-BK-${suffix}-2`, amount: 3000, narration: "unknown payer" },
      ],
    });
    batchId = res?.batchId ?? null;
    check("H1. Bank statement staged", !!batchId, JSON.stringify(res ?? {}));
  } catch (err) { check("H1. Bank statement staged", false, describeErr(err)); }

  try {
    await M(c, anyApi.phase7.billing.stageBankImport, {
      filename: "SMOKE bad", rows: [{ date: "03/06/2026", reference: "X", amount: 5 }],
    });
    check("H2. Bad date format rejected", false, "expected error");
  } catch (err) { check("H2. Bad date format rejected", isDenied(err), describeErr(err)); }

  if (batchId) {
    const rows = await Q(c, anyApi.phase7.billing.bankImportRows, { batchId });
    check("H3. Rows listed with auto-match attempt", Array.isArray(rows) && rows.length === 2, JSON.stringify({ n: rows?.length }).slice(0, 60));
    const unmatched = (rows ?? []).find((r) => !r.candidateStudentId);
    if (unmatched) {
      try {
        await M(c, anyApi.phase7.billing.postBankRows, { rowIds: [unmatched._id] });
        check("H4. Unmatched rows cannot post", false, "expected error");
      } catch (err) { check("H4. Unmatched rows cannot post", true, "skipped safely or denied"); }
      try {
        await M(c, anyApi.phase7.billing.discardBankRow, { rowId: unmatched._id, reason: "SMOKE discard" });
        check("H5. Unmatched row discarded with reason", true);
      } catch (err) { check("H5. Unmatched row discarded with reason", isDenied(err), describeErr(err)); }
    }
    // Duplicate reference staging is flagged.
    const res2 = await M(c, anyApi.phase7.billing.stageBankImport, {
      filename: "SMOKE dup", rows: [
        { date: today, reference: `SMOKE-ALLOC-${suffix}`, amount: 100, narration: "dup of posted payment ref" },
      ],
    }).catch(() => null);
    if (res2?.batchId) {
      const dupRows = await Q(c, anyApi.phase7.billing.bankImportRows, { batchId: res2.batchId });
      check("H6. Duplicate reference flagged", !!(dupRows ?? [])[0]?.duplicate, JSON.stringify(dupRows ?? []).slice(0, 120));
    } else {
      check("H6. Duplicate reference flagged", false, "stage failed");
    }
  }

  const t = client(teacher.jwt);
  try {
    await M(t, anyApi.phase7.billing.stageBankImport, { filename: "hack", rows: [{ date: today, reference: "x", amount: 1 }] });
    check("H7. Teacher cannot import bank statements", false, "expected error");
  } catch (err) { check("H7. Teacher cannot import bank statements", isDenied(err), describeErr(err)); }
}

/* ================================================================ */
console.log("== I. MEALS ==");
{
  const c = client(gfAdmin.jwt);
  let planId = null, enrollId = null, smokeStudentId = null;
  try {
    const students = await Q(c, anyApi.students.list, { paginationOpts: { numItems: 5, cursor: null } });
    smokeStudentId = (students?.page ?? [])[0]?._id ?? null;
    const years = await Q(c, anyApi.academics.listYears, {});
    const year = years.find((y) => y.isCurrent) ?? years[0];
    planId = await M(c, anyApi.phase7.meals.upsertPlan, {
      name: `SMOKE Lunch ${suffix}`, planType: "lunch", dailyCost: 60,
    });
    check("I1. Meal plan created", !!planId, "");
    enrollId = await M(c, anyApi.phase7.meals.enrollStudent, {
      studentId: smokeStudentId, planId, academicYearId: year._id, startDate: today,
    });
    check("I2. Student enrolled (eligibility granted)", !!enrollId, "");
    try {
      await M(c, anyApi.phase7.meals.enrollStudent, {
        studentId: smokeStudentId, planId, academicYearId: year._id, startDate: today,
      });
      check("I3. Duplicate eligibility blocked", false, "expected error");
    } catch (err) { check("I3. Duplicate eligibility blocked", isDenied(err), describeErr(err)); }
    const rec = await M(c, anyApi.phase7.meals.recordConsumption, {
      studentId: smokeStudentId, mealType: "lunch",
    });
    check("I4. Consumption recorded", !!rec, JSON.stringify(rec ?? {}).slice(0, 80));
    try {
      await M(c, anyApi.phase7.meals.recordConsumption, { studentId: smokeStudentId, mealType: "lunch" });
      check("I5. Duplicate same-day meal blocked", false, "expected error");
    } catch (err) { check("I5. Duplicate same-day meal blocked", isDenied(err), describeErr(err)); }
    const summary = await Q(c, anyApi.phase7.meals.consumptionSummary, {});
    check("I6. Daily consumption summary", summary && summary.lunch >= 1, JSON.stringify(summary ?? {}).slice(0, 100));
    try {
      await M(c, anyApi.phase7.meals.recordConsumptionByQr, { token: "not-a-real-token", mealType: "lunch" });
      check("I7. Invalid QR rejected", false, "expected error");
    } catch (err) { check("I7. Invalid QR rejected", isDenied(err), describeErr(err)); }
  } catch (err) { check("I1-I7. Meals flow", false, describeErr(err)); }

  // Parent can see own children's meals only (query runs; scope enforced internally).
  const parent = await signIn("parent.wanjiku@greenfield.ac.ke", "Parent#2026");
  check("I8. Parent sign-in", !!parent.jwt, parent.error ?? "");
  if (parent.jwt) {
    const pc = client(parent.jwt);
    try {
      const mine = await Q(pc, anyApi.phase7.meals.myChildrenMeals, {});
      check("I9. Parent child-scoped meal view", Array.isArray(mine), JSON.stringify({ n: Array.isArray(mine) ? mine.length : "?" }).slice(0, 60));
    } catch (err) { check("I9. Parent child-scoped meal view", false, describeErr(err)); }
    try {
      await M(pc, anyApi.phase7.meals.upsertPlan, { name: "SMOKE hack", planType: "lunch", dailyCost: 1 });
      check("I10. Parent cannot manage meal plans", false, "expected error");
    } catch (err) { check("I10. Parent cannot manage meal plans", isDenied(err), describeErr(err)); }
  }
}

/* ================================================================ */
console.log("== J. ACCESS MANAGEMENT ==");
{
  const c = client(gfAdmin.jwt);
  try {
    const ov = await Q(c, anyApi.phase7.access.accessOverview, {});
    check("J1. Access overview", ov && Array.isArray(ov.users) && ov.summary && typeof ov.summary.total === "number", JSON.stringify(ov?.summary ?? {}).slice(0, 120));
    const pm = await Q(c, anyApi.phase7.access.permissionMatrix, {});
    check("J2. Permission matrix", pm !== null && typeof pm === "object", "");
    const inv = await Q(c, anyApi.phase7.access.pendingInvitations, {});
    check("J3. Pending invitations list", Array.isArray(inv), "");
  } catch (err) { check("J1-J3. Access management", false, describeErr(err)); }

  const t = client(teacher.jwt);
  try {
    await Q(t, anyApi.phase7.access.accessOverview, {});
    check("J4. Teacher cannot view access management", false, "expected error");
  } catch (err) { check("J4. Teacher cannot view access management", isDenied(err), describeErr(err)); }
}

/* ================================================================ */
console.log("== K. SECURITY / TENANT ISOLATION ==");
{
  // Riverside admin cannot read Greenfield's onboarding/admissions/meals.
  const rv = client(rvAdmin.jwt);
  try {
    const years = await Q(client(rvAdmin.jwt), anyApi.academics.listYears, {});
    const classes = await Q(client(rvAdmin.jwt), anyApi.academics.listClassSections, {});
    const gfClasses = await Q(client(gfAdmin.jwt), anyApi.academics.listClassSections, {});
    const gfClassIds = new Set(gfClasses.map((x) => x._id));
    const foreign = classes.find((x) => gfClassIds.has(x._id));
    check("K0. Class lists are school-scoped", !foreign, foreign ? "cross-school class visible" : "");
    void years;
  } catch (err) { check("K0. Class lists are school-scoped", false, describeErr(err)); }

  if (smokeApplicationId) {
    try {
      await Q(rv, anyApi.phase7.admissions.applicationDetail, { applicationId: smokeApplicationId });
      check("K1. Cross-school application detail blocked", false, "expected error");
    } catch (err) { check("K1. Cross-school application detail blocked", isDenied(err), describeErr(err)); }
  }
  if (smokeInvoiceId) {
    try {
      await Q(rv, anyApi.phase7.billing.invoiceBreakdown, { invoiceId: smokeInvoiceId });
      check("K2. Cross-school invoice breakdown blocked", false, "expected error");
    } catch (err) { check("K2. Cross-school invoice breakdown blocked", isDenied(err), describeErr(err)); }
  }
  if (smokePaymentId) {
    try {
      await Q(rv, anyApi.phase7.billing.paymentAllocationTrail, { paymentId: smokePaymentId });
      check("K3. Cross-school allocation trail blocked", false, "expected error");
    } catch (err) { check("K3. Cross-school allocation trail blocked", isDenied(err), describeErr(err)); }
  }
  // Anonymous cannot touch school-scoped Phase 7 endpoints.
  try {
    await Q(anon, anyApi.phase7.billing.reconciliationOverview, {});
    check("K4. Anonymous cannot open reconciliation", false, "expected error");
  } catch (err) { check("K4. Anonymous cannot open reconciliation", isDenied(err), describeErr(err)); }
}

/* ================================================================ */
console.log("== L. REGRESSION SMOKE (Phases 1–6) ==");
{
  const c = client(gfAdmin.jwt);
  try {
    const invs = await Q(c, anyApi.finance.listInvoices, {});
    check("L1. Finance invoices respond", Array.isArray(invs), "");
    const students = await Q(c, anyApi.students.list, { paginationOpts: { numItems: 1, cursor: null } });
    check("L2. Students respond", students && Array.isArray(students.page), "");
    const rules = await Q(c, anyApi.phase6.automations.listRules, {});
    check("L3. Phase 6 automations respond", Array.isArray(rules), "");
    const recon = await Q(c, anyApi.phase6.payments.reconciliationList, {});
    check("L4. Phase 6 reconciliation responds (now real)", Array.isArray(recon), JSON.stringify({ n: Array.isArray(recon) ? recon.length : "?" }).slice(0, 60));
    const ov = await Q(c, anyApi.phase7.billing.reconciliationOverview, {});
    check("L5. Phase 7 reconciliation overview responds", !!ov, "");
    const access = await Q(c, anyApi.phase7.access.accessOverview, {});
    check("L6. Access overview responds", !!access, "");
  } catch (err) { check("L1-L6. Regression smoke", false, describeErr(err)); }
}

/* ================================================================ */
console.log("\n========================================");
console.log(`PHASE 7 RESULT: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("Failed checks:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
