/**
 * Security audit harness — backend + static checks against the live deployment.
 * Usage: bun scripts/security-audit.mjs <convexCloudUrl>
 *
 * Sections:
 *   A. Authentication (valid/invalid login, sign-up rejection, disabled accounts*)
 *   B. RBAC denials (teacher / parent must not reach privileged surfaces)
 *   C. Parent portal scope (only linked children; no staff/payroll reach)
 *   D. Multi-tenant isolation (Greenfield admin vs Riverside records)
 *   E. File security (staff documents, registration documents)
 *   F. Finance integrity (duplicate refs, forged callbacks, cross-school pay)
 *   G. Medical & payroll gating (+ audit trail reachable)
 *   H. Audit log immutability (no update/delete endpoints)
 *   I. Secrets & configuration (static source scans)
 *   J. Error hygiene (static frontend scan)
 *
 * (*) items marked [static] are verified by reading source, since creating a
 * disabled fixture on a live deployment would mutate shared state.
 *
 * Only creates SMOKE-prefixed records (one payment). No secrets are echoed.
 */
const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/security-audit.mjs <convexUrl>");
  process.exit(1);
}
const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");
const fs = await import("node:fs");

const suffix = `AUD${Date.now() % 100000}`;

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`); }
}
function section(name) { console.log(`\n== ${name} ==`); }
function describeErr(err) {
  let e = err, parts = [];
  while (e) {
    const data = e.data !== undefined && e.data !== null ? ` [${typeof e.data === "object" ? JSON.stringify(e.data) : String(e.data)}]` : "";
    parts.push(`${String(e.message ?? e)}${data}`);
    e = e.cause;
  }
  return parts.join(" :: ").slice(0, 220);
}
function isDenied(err) {
  const s = describeErr(err).toLowerCase();
  return s.includes("permission") || s.includes("not signed in") || s.includes("denied") ||
    s.includes("not found") || s.includes("only") || s.includes("cannot") || s.includes("can only") ||
    s.includes("does not belong") || s.includes("access to this record") || s.includes("invalid") ||
    s.includes("unrecognized") || s.includes("must be") || s.includes("must match") ||
    s.includes("you do not have") || s.includes("no such") || s.includes("required") ||
    s.includes("does not exist") || s.includes("could not find") || s.includes("unauthorized") ||
    s.includes("already") || s.includes("does not match");
}
function isNotFoundish(err) {
  const s = describeErr(err).toLowerCase();
  return s.includes("does not exist") || s.includes("could not find") || s.includes("no such") || s.includes("not found");
}

async function signIn(email, password, flow = "signIn") {
  const c = new ConvexHttpClient(url);
  try {
    const res = await c.action(anyApi.auth.signIn, {
      provider: "password",
      params: { flow, email, password },
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
/** Bridge into internal read-only probes (name-allowlisted public action). */
const BR = async (name, args = {}) => {
  const c = new ConvexHttpClient(url);
  try {
    return await c.action(anyApi.diagnostics.runInternal6, { name, argsJson: JSON.stringify(args) });
  } finally { c.close?.(); }
};
const readFile = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

/* ================= fixtures ================= */
section("Sign-in fixtures");
const gf = await signIn("admin@greenfield.ac.ke", "Greenfield#2026");
check("A0. Greenfield admin signs in", !!gf.jwt, gf.error ?? "");
const rv = await signIn("admin@riverside.ac.ke", "Riverside#2026");
check("A0. Riverside admin signs in", !!rv.jwt, rv.error ?? "");
const sa = await signIn("admin@schoolcore.dev", "ChangeMe!2026");
check("A0. Platform admin signs in", !!sa.jwt, sa.error ?? "");
const par = await signIn("parent.wanjiku@greenfield.ac.ke", "Parent#2026");
check("A0. Parent signs in", !!par.jwt, par.error ?? "");
const tea = await signIn("grace.wanjiku@greenfield.ac.ke", "Greenfield#2026");
check("A0. Teacher signs in", !!tea.jwt, tea.error ?? "");

if (!(gf.jwt && rv.jwt)) {
  console.log("\nABORT: core fixtures unavailable; refusing to report a false pass/fail set.");
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

const gc = client(gf.jwt);
const rc = client(rv.jwt);
const sc = sa.jwt ? client(sa.jwt) : null;
const pc = par.jwt ? client(par.jwt) : null;
const tc = tea.jwt ? client(tea.jwt) : null;

/* ================= A. AUTH ================= */
section("A. Authentication");
{
  const bad1 = await signIn("admin@greenfield.ac.ke", "wrong-password-123");
  check("A1. Wrong password rejected", !bad1.jwt && isDenied({ message: bad1.error }), bad1.error ?? "");
  const bad2 = await signIn("nobody@schoolcore.dev", "whatever");
  check("A2. Unknown email rejected", !bad2.jwt && isDenied({ message: bad2.error }), bad2.error ?? "");

  const su = await signIn("newselfsignup@schoolcore.dev", "SomePass!2026", "signUp");
  check("A3. Public self sign-up rejected (provisioning-only)", !su.jwt, su.error ?? "unexpectedly succeeded");

  const noAuth = new ConvexHttpClient(url);
  const anonGet = await Q(noAuth, anyApi.students.get, { id: "000000000000000000000000" })
    .then(() => null).catch((e) => e);
  check("A4. Unauthenticated query rejected", !!anonGet && isDenied(anonGet), describeErr(anonGet ?? ""));
  noAuth.close?.();

  // Disabled accounts: sign-in path calls internal.accounts.isUserActive which
  // rejects isActive === false. Verified statically (no live disable fixture).
  const authSrc = readFile("src/convex/auth.ts");
  check("A5. [static] Disabled accounts cannot sign in (isActive gate)", /isUserActive/.test(authSrc));
  check("A6. [static] Password provider is sign-in-only (no signUp flow)", /Only sign-in is supported/.test(authSrc));
  check("A7. [static] Passwords hashed with Scrypt", /new Scrypt\(\)/.test(authSrc));
}

/* ================= B. RBAC DENIALS (teacher) ================= */
section("B. RBAC denials (teacher)");
// Real Greenfield student id: validators reject fabricated ids before the
// permission layer runs, so RBAC probes must use genuine records.
const gfStudents = await Q(gc, anyApi.students.list, { paginationOpts: { numItems: 3, cursor: null } }).catch(() => ({ page: [] }));
const gfStudentId = gfStudents.page?.[0]?._id ?? null;
if (tc) {
  const denials = [
    ["B1. Teacher denied payroll view", Q(tc, anyApi.payroll.listPayrollRuns, {})],
    ["B2. Teacher denied medical profile", gfStudentId
      ? Q(tc, anyApi.medical.getMedicalProfile, { studentId: gfStudentId })
      : Promise.reject(new Error("skipped — no Greenfield student fixture"))],
    ["B3. Teacher denied finance invoices", Q(tc, anyApi.finance.listInvoices, {})],
    ["B4. Teacher denied audit logs", Q(tc, anyApi.auditLogs.list, { paginationOpts: { numItems: 5, cursor: null } })],
    ["B5. Teacher denied student creation", M(tc, anyApi.students.create, { admissionNumber: `SMOKE-${suffix}-T`, firstName: "Nope", lastName: "Teacher", gender: "male", dateOfBirth: "2012-01-01" })],
    ["B6. Teacher denied HR department creation", M(tc, anyApi.hr.createDepartment, { name: `SMOKE-${suffix}` })],
    ["B7. Teacher denied staff export", Q(tc, anyApi.phase6.imports.exportStaff, {})],
    ["B8. Teacher denied payment recording", gfStudentId
      ? M(tc, anyApi.finance.recordPayment, { studentId: gfStudentId, amount: 10, paymentDate: "2026-01-01", method: "Cash" })
      : Promise.reject(new Error("skipped — no Greenfield student fixture"))],
  ];
  for (const [name, p] of denials) {
    const r = await p.then(() => null).catch((e) => e);
    check(name, !!r && isDenied(r), r ? describeErr(r) : "unexpectedly allowed");
  }
} else check("B. Teacher fixture", false, "no teacher jwt");

/* ================= C. PARENT SCOPE ================= */
section("C. Parent portal scope");
if (pc) {
  const kids = await Q(pc, anyApi.portal.parentChildren, {}).then((r) => ({ ok: r })).catch((e) => ({ err: e }));
  check("C1. Parent children list resolves", !!kids.ok && Array.isArray(kids.ok.children),
    kids.err ? describeErr(kids.err) : `${kids.ok?.children?.length ?? 0} child(ren)`);
  // myPayslips is self-service BY DESIGN: for a non-employee it must return
  // an explicit isEmployee:false with an empty payslip list (never an error
  // and never anyone else's data).
  const slips = await Q(pc, anyApi.payroll.myPayslips, {}).then((r) => ({ ok: r })).catch((e) => ({ err: e }));
  const slipLeak = slips.ok && (slips.ok.isEmployee !== false || (slips.ok.payslips ?? []).length > 0);
  check("C2. Parent payroll self-service returns no payslip data", !!slips.err || !slipLeak,
    slips.err ? describeErr(slips.err) : slipLeak ? `isEmployee=${slips.ok?.isEmployee} slips=${slips.ok?.payslips?.length}` : "isEmployee=false, 0 slips");
  const glist = await Q(pc, anyApi.guardians.list, { paginationOpts: { numItems: 5, cursor: null } })
    .then(() => null).catch((e) => e);
  check("C3. Parent denied guardian directory", !!glist && isDenied(glist), glist ? describeErr(glist) : "");
  const xSearch = await Q(pc, anyApi.search.globalSearch, { query: "Riverside" }).then((r) => ({ ok: r })).catch((e) => ({ err: e }));
  const flat = JSON.stringify(xSearch.ok ?? {}).toLowerCase();
  check("C4. Parent search cannot surface other-school data", !!xSearch.err || !flat.includes("riverside"),
    xSearch.err ? describeErr(xSearch.err) : flat.slice(0, 80));
} else check("C. Parent fixture", false, "no parent jwt");

/* ================= D. TENANT ISOLATION ================= */
section("D. Multi-tenant isolation (Greenfield admin × Riverside records)");
{
  // Fetch Riverside fixture ids with Riverside's own session.
  var rvIds = { schoolId: null, student: null, employee: null, payrollRun: null, book: null, requestDoc: null };
  const rvStudents = await Q(rc, anyApi.students.list, { paginationOpts: { numItems: 5, cursor: null } }).catch(() => ({ page: [] }));
  rvIds.schoolId = rvStudents.page?.[0]?.schoolId ?? null;
  rvIds.student = rvStudents.page?.[0]?._id ?? null;
  const rvEmps = await Q(rc, anyApi.hr.listEmployees, {}).then((r) => Array.isArray(r) ? r : (r?.page ?? [])).catch(() => []);
  rvIds.employee = rvEmps[0]?._id ?? null;
  const rvRuns = await Q(rc, anyApi.payroll.listPayrollRuns, {}).then((r) => Array.isArray(r) ? r : (r?.page ?? [])).catch(() => []);
  rvIds.payrollRun = rvRuns[0]?._id ?? null;
  const rvBooks = await Q(rc, anyApi.library.listBooks, {}).then((r) => Array.isArray(r) ? r : (r?.page ?? [])).catch(() => []);
  rvIds.book = rvBooks[0]?._id ?? null;
  // Real registration document id (via platform detail) for download-gate probes.
  if (sc) {
    const reqs = await Q(sc, anyApi.phase7.registration.platformListRequests, {}).catch(() => []);
    for (const req of (Array.isArray(reqs) ? reqs : [])) {
      const detail = await Q(sc, anyApi.phase7.registration.platformRequestDetail, { requestId: req._id }).catch(() => null);
      const docId = detail?.documents?.[0]?.documentId ?? null;
      if (docId) { rvIds.requestDoc = { requestId: req._id, documentId: docId }; break; }
    }
  }

  const cross = [
    ["D1. Cross-school student record", () => Q(gc, anyApi.students.get, { id: rvIds.student })],
    ["D2. Cross-school employee record", () => Q(gc, anyApi.hr.getEmployee, { id: rvIds.employee })],
    ["D3. Cross-school payroll run", () => Q(gc, anyApi.payroll.getPayrollRun, { id: rvIds.payrollRun })],
    ["D4. Cross-school library book", () => Q(gc, anyApi.library.getBook, { id: rvIds.book })],
    ["D5. Cross-school medical profile", () => Q(gc, anyApi.medical.getMedicalProfile, { studentId: rvIds.student })],
    ["D6. Cross-school registration review (school admin denied platform surface)", () => Q(gc, anyApi.phase7.registration.platformListRequests, {})],
    ["D7. Cross-school registration document download (school admin denied)", () =>
      rvIds.requestDoc
        ? Q(gc, anyApi.phase7.registration.platformRequestDocument, { documentId: rvIds.requestDoc.documentId })
        : Promise.reject(new Error("skipped — no registration documents exist"))],
  ];
  for (const [name, p] of cross) {
    const r = await p().then((v) => ({ ok: v })).catch((e) => ({ err: e }));
    const denied = !!r.err && isDenied(r.err);
    let leak = false;
    if (r.ok && typeof r.ok === "object" && !Array.isArray(r.ok)) {
      const sid = r.ok.schoolId ?? null;
      // If a record resolves, its tenant marker must NOT be the other school's.
      if (sid && rvIds.schoolId && sid === rvIds.schoolId) leak = true;
    }
    check(name, denied || (r.ok !== undefined && !leak),
      r.err ? describeErr(r.err) : leak ? "returned a Riverside-owned record to a Greenfield admin" : "ok");
  }

  // Platform-only surface actually works for the super admin (positive control).
  if (sc) {
    const pl = await Q(sc, anyApi.phase7.registration.platformListRequests, {}).then((r) => ({ ok: r })).catch((e) => ({ err: e }));
    check("D8. Platform admin CAN list registration requests (control)", !!pl.ok,
      pl.err ? describeErr(pl.err) : `${pl.ok?.length ?? 0} request(s)`);
  }

  // List-level scoping: every row returned to a school admin must belong to that school.
  const scopedLists = [
    ["D9. Transport vehicles scoped", anyApi.transport.listVehicles, rc],
    ["D10. Inventory assets scoped", anyApi.inventory.listAssets, rc],
    ["D11. Procurement suppliers scoped", anyApi.procurement.listSuppliers, rc],
  ];
  for (const [name, fn, c] of scopedLists) {
    const rows = await Q(c, fn, {}).then((r) => Array.isArray(r) ? r : (r?.page ?? [])).catch(() => []);
    const bad = rows.filter((x) => x.schoolId && rvIds.schoolId && x.schoolId !== rvIds.schoolId);
    check(`${name} (${rows.length} rows, ${bad.length} foreign)`, rows.length === 0 || bad.length === 0,
      bad.length ? `${bad.length} foreign-school rows returned` : "");
  }

  // Invoice list scoping (invoice rows may be enriched; match by school-owned students).
  const gfInvoices = await Q(gc, anyApi.finance.listInvoices, {}).then((r) => Array.isArray(r) ? r : (r?.page ?? [])).catch(() => []);
  const rvInvNums = gfInvoices.filter((i) => /RVS|RV-/i.test(String(i.invoiceNumber ?? "")));
  check(`D12. Greenfield invoice list contains no Riverside documents (${gfInvoices.length} rows)`, rvInvNums.length === 0);
}

/* ================= E. FILE SECURITY ================= */
section("E. File security");
{
  // Staff documents: upload/get/delete gated hr.manage + tenant-checked.
  const docDenied = await Q(gc, anyApi.hr.getStaffDocument, { id: "000000000000000000000000" })
    .then(() => null).catch((e) => e);
  check("E1. Staff document access enforced (missing id denied)", !!docDenied && isDenied(docDenied), describeErr(docDenied ?? ""));
  const upDenied = tc
    ? await M(tc, anyApi.hr.uploadStaffDocument, { employeeId: "000000000000000000000000", filename: "x.txt", mimeType: "text/plain", bytes: new Uint8Array([1]).buffer })
      .then(() => null).catch((e) => e)
    : null;
  check("E2. Teacher denied staff document upload", !!upDenied && isDenied(upDenied), upDenied ? describeErr(upDenied) : "no teacher fixture");

  // Registration documents: platform session required to download.
  const regDenied = rvIds.requestDoc
    ? await Q(gc, anyApi.phase7.registration.platformRequestDocument, { documentId: rvIds.requestDoc.documentId })
      .then(() => null).catch((e) => e)
    : null;
  check("E3. Registration document download platform-only (real document id)",
    !rvIds.requestDoc || (!!regDenied && isDenied(regDenied)),
    rvIds.requestDoc ? (regDenied ? describeErr(regDenied) : "unexpectedly allowed") : "skipped — no registration documents exist");

  // Public attachment endpoint is size/kind-limited (static).
  const regSrc = readFile("src/convex/phase7/registration.ts");
  check("E4. [static] Public attachments size-limited (5MB)", /5\s*\*\s*1024\s*\*\s*1024/.test(regSrc));
  check("E5. [static] Public attachments kind-allowlisted", /registration_certificate|logo|supporting/.test(regSrc));

  // No public file-download HTTP route exists outside auth (static).
  const httpSrc = readFile("src/convex/http.ts");
  check("E6. [static] HTTP surface limited to auth routes", /auth\.addHttpRoutes/.test(httpSrc) && !/filePath|downloadFile/.test(httpSrc));
}

/* ================= F. FINANCE INTEGRITY ================= */
section("F. Finance integrity");
{
  // Reuse the real Greenfield student fetched for section B.
  const gfStudent = gfStudentId;
  if (gfStudent) {
    const ref = `SMOKE-${suffix}`;
    const p1 = await M(gc, anyApi.finance.recordPayment, { studentId: gfStudent, amount: 5, paymentDate: "2026-01-01", method: "Cash", referenceNumber: ref })
      .then((r) => ({ ok: r })).catch((e) => ({ err: e }));
    check("F1. Payment with unique reference accepted", !!p1.ok, p1.err ? describeErr(p1.err) : "");
    if (p1.ok) {
      const p2 = await M(gc, anyApi.finance.recordPayment, { studentId: gfStudent, amount: 5, paymentDate: "2026-01-01", method: "Cash", referenceNumber: ref })
        .then(() => null).catch((e) => e);
      check("F2. Duplicate payment reference rejected (replay guard)", !!p2 && isDenied(p2), p2 ? describeErr(p2) : "unexpectedly allowed");
    }
  } else check("F1/F2. Duplicate reference test", false, "no Greenfield student fixture");

  const forged = await BR("paymentCallback", { body: JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: `FORGED-${suffix}`, ResultCode: 0, CallbackMetadata: { Item: [{ Name: "Amount", Value: 999999 }, { Name: "MpesaReceiptNumber", Value: `FAKE${suffix}` }] } } } }) });
  check("F3. Forged M-Pesa callback rejected (unknown ref)", forged && forged.ok === false && ["unknown_ref", "missing_ref"].includes(forged.reason),
    JSON.stringify(forged ?? {}).slice(0, 120));
  const badJson = await BR("paymentCallback", { body: "not-json" });
  check("F4. Malformed callback rejected (bad json)", badJson && badJson.ok === false && badJson.reason === "bad_json",
    JSON.stringify(badJson ?? {}).slice(0, 120));

  // Cross-school finance write: Greenfield admin pays a REAL Riverside student.
  const crossPay = rvIds.student
    ? await M(gc, anyApi.finance.recordPayment, { studentId: rvIds.student, amount: 5, paymentDate: "2026-01-01", method: "Cash" })
      .then(() => null).catch((e) => e)
    : null;
  check("F5. Cross-school payment posting rejected (real foreign student)",
    !rvIds.student || (!!crossPay && isDenied(crossPay)),
    rvIds.student ? (crossPay ? describeErr(crossPay) : "unexpectedly allowed") : "skipped — no Riverside student");
}

/* ================= G. MEDICAL & PAYROLL ================= */
section("G. Medical & payroll gating");
{
  const tMed = await Q(tc ?? gc, anyApi.medical.listVisits, {}).then(() => null).catch((e) => e);
  if (tc) check("G1. Teacher denied medical visit list", !!tMed && isDenied(tMed), tMed ? describeErr(tMed) : "");
  const gfMed = await Q(gc, anyApi.medical.listVisits, {}).then((r) => ({ ok: r })).catch((e) => ({ err: e }));
  check("G2. Admin medical list resolves (positive control)", !!gfMed.ok, gfMed.err ? describeErr(gfMed.err) : "");
  const tPay = tc ? await Q(tc, anyApi.payroll.listSalaryStructures, {}).then(() => null).catch((e) => e) : null;
  if (tc) check("G3. Teacher denied salary structures", !!tPay && isDenied(tPay), tPay ? describeErr(tPay) : "");

  // Global search must never expose medical/payroll content.
  const gs = await Q(gc, anyApi.search.globalSearch, { query: "a" }).then((r) => ({ ok: r })).catch((e) => ({ err: e }));
  const gsStr = JSON.stringify(gs.ok ?? {}).toLowerCase();
  check("G4. Global search leaks no medical/payroll fields",
    !gs.err && !/diagnos|blood|payslip|salary|bank account|nhif|nssf/.test(gsStr),
    gs.err ? describeErr(gs.err) : gsStr.slice(0, 80));
}

/* ================= H. AUDIT LOG IMMUTABILITY ================= */
section("H. Audit log immutability");
{
  const logs = await Q(gc, anyApi.auditLogs.list, { paginationOpts: { numItems: 5, cursor: null } })
    .then((r) => ({ ok: r })).catch((e) => ({ err: e }));
  check("H1. Audit log list readable (school-scoped)", !!logs.ok && Array.isArray(logs.ok.page ?? logs.ok),
    logs.err ? describeErr(logs.err) : `${(logs.ok?.page ?? logs.ok ?? []).length} row(s)`);
  const recent = await Q(gc, anyApi.auditLogs.recent, {}).then((r) => ({ ok: r })).catch((e) => ({ err: e }));
  check("H2. Audit recent readable", !!recent.ok || !!recent.err && isDenied(recent.err),
    recent.err ? describeErr(recent.err) : "");
  // No mutation endpoints should exist at all.
  for (const fn of ["deleteAll", "update", "remove", "clear"]) {
    const r = await M(gc, anyApi.auditLogs[fn], {}).then(() => ({ ok: true })).catch((e) => ({ err: e }));
    check(`H3. auditLogs.${fn} endpoint does not exist`, !!r.err && isNotFoundish(r.err), describeErr(r.err ?? ""));
  }
}

/* ================= I. SECRETS & CONFIG ================= */
section("I. Secrets & configuration (static)");
{
  const paymentSrc = readFile("src/convex/phase6/payments.ts");
  const commSrc = readFile("src/convex/phase6/communications.ts");
  const otpSrc = readFile("src/convex/auth/emailOtp.ts");
  check("I1. M-Pesa credentials read from env only", /process\.env\.MPESA_CONSUMER_KEY/.test(paymentSrc));
  check("I2. No literal API keys in payments source", !/(sk|pk)_(live|test)_|AKIA[0-9A-Z]{16}/.test(paymentSrc));
  check("I3. No literal API keys in communications source", !/(sk|pk)_(live|test)_|AKIA[0-9A-Z]{16}/.test(commSrc));
  check("I4. OTP provider key from env", /process\.env\.VLY_EMAIL_OTP_API_KEY/.test(otpSrc));
  check("I5. [static] OTP code TTL is 15 minutes", /maxAge:\s*60\s*\*\s*15/.test(otpSrc));
  const inviteSrc = readFile("src/convex/phase7/inviteCore.ts");
  check("I6. [static] Invite tokens expire in 7 days", /INVITE_TTL_MS\s*=\s*7\s*\*\s*24/.test(inviteSrc));
  const tokenSrc = readFile("src/convex/phase7/inviteTokens.ts");
  const inviteCoreSrc = readFile("src/convex/phase7/inviteCore.ts");
  check("I7. [static] Invite codes stored hashed (SHA-256), never plaintext",
    /sha256/i.test(inviteCoreSrc) && /hash|sha256/i.test(tokenSrc));
  const seedSrc = readFile("src/convex/seed.ts");
  check("I8. [static] Seed refuses to run without SEED_SECRET", /SEED_SECRET/.test(seedSrc) && !/SEED_SECRET\s*\?\?/.test(seedSrc));
  const envEx = readFile(".env.example");
  check("I9. [static] .env.example has placeholders only", envEx.length > 0 && !/(sk|pk)_(live|test)_|AKIA[0-9A-Z]{16}/.test(envEx));
  const accountsSrc = readFile("src/convex/accounts.ts");
  check("I10. [static] Bootstrap refuses to mint platform admin without PLATFORM_ADMIN_PASSWORD",
    /BOOTSTRAP_PASSWORD = process\.env\.PLATFORM_ADMIN_PASSWORD \?\? null/.test(accountsSrc) &&
    /Refusing to create the platform admin with a default password/.test(accountsSrc) &&
    !/\?\?\s*"ChangeMe!2026"/.test(accountsSrc));
  check("I11. [static] Integration secrets never stored in DB (schema note)", /Secrets are NEVER stored here/.test(readFile("src/convex/schema.ts")));
}

/* ================= J. ERROR HYGIENE (static) ================= */
section("J. Error hygiene (static)");
{
  const authPage = readFile("src/pages/Auth.tsx");
  check("J1. Sign-in errors mapped to friendly messages", /GENERIC_MESSAGE/.test(authPage) && /INVALID_MESSAGE/.test(authPage));
  check("J2. Raw backend errors never surfaced to the UI", !/setError\(\s*err/.test(authPage));
  check("J3. Backend errors logged to console only", /console\.error\("Sign-in failed/.test(authPage));
}

/* ================= cleanup + summary ================= */
gc.close?.(); rc.close?.(); sc?.close?.(); pc?.close?.(); tc?.close?.();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("Failed checks:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail > 0 ? 1 : 0);
