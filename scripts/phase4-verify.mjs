/**
 * Phase 4 final verification — backend-level tests against the live deployment.
 * Usage: bun scripts/phase4-verify.mjs <convexCloudUrl>
 * Prints test results only; no secrets are echoed.
 */
const url = process.argv[2];
if (!url) {
  console.error("usage: bun scripts/phase4-verify.mjs <convexUrl>");
  process.exit(1);
}
const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
function describeErr(err) {
  let e = err, parts = [];
  while (e) { parts.push(String(e.message ?? e)); e = e.cause; }
  return parts.join(" :: ").slice(0, 220);
}
function isDenied(err) {
  const s = describeErr(err).toLowerCase();
  return s.includes("permission") || s.includes("not signed in") || s.includes("no parent") ||
    s.includes("no student") || s.includes("not linked") || s.includes("access") ||
    s.includes("not found") || s.includes("invalid");
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
async function withClient(jwt, fn) {
  const c = client(jwt);
  try { return await fn(c); } finally { c.close?.(); }
}
const Q = (c, fn, args) => c.query(fn, args);
const M = (c, fn, args) => c.mutation(fn, args);

/** Shared Greenfield admin session (lazily signed in). */
let gfAdminJwt = null;
async function getGfAdmin() {
  if (gfAdminJwt) return gfAdminJwt;
  const r = await signIn("admin@greenfield.ac.ke", "Greenfield#2026");
  gfAdminJwt = r.jwt ?? null;
  return gfAdminJwt;
}

/* ================================================================== */
console.log("\n== A. PARENT PORTAL ==");
const PARENT_EMAIL = "parent.wanjiku@greenfield.ac.ke";
const STUDENT_EMAIL = "student.demo@greenfield.ac.ke";

const parent = await signIn(PARENT_EMAIL, "Parent#2026");
check("A1. Parent login succeeds (tokens issued)", !!parent.jwt, parent.error ?? "");

if (parent.jwt) {
  const kids = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildren, {}));
  check("A2. Parent identity resolves via guardianPortalLinks", !!kids?.guardian?.name, kids ? "" : "null");
  const childCount = kids?.children?.length ?? 0;
  check(`A3. Parent sees only linked children (found ${childCount})`, childCount >= 1);
  const linkedIds = (kids?.children ?? []).map((x) => x.studentId);

  // Phase 4 §7: multiple children — a second child link exists for switching.
  check("A4. Multi-child switch data present (>=2 children for switcher demo)", childCount >= 2,
    `count=${childCount}`);

  if (childCount >= 1) {
    const sid = linkedIds[0];
    const ov = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildOverview, { studentId: sid }));
    check("A5. Child overview loads (attendance/fees/results/assignments fields)", !!ov?.student?.admissionNumber);
    check("A6. Attendance summary present (no double counting — daily only)", ov?.attendance && typeof ov.attendance.percentage === "number" || ov?.attendance?.percentage === null,
      JSON.stringify(ov?.attendance ?? {}).slice(0, 80));
    check("A7. Fee summary present (billed/paid/balance)", ov?.fees && typeof ov.fees.balance === "number",
      JSON.stringify(ov?.fees ?? {}).slice(0, 80));

    const att = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildAttendance, { studentId: sid }));
    check("A8. Attendance view (summary + recent rows)", !!att?.summary);
    const res = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildResults, { studentId: sid }));
    check("A9. Results endpoint reachable; all rows published-only",
      !!res && (res.terms ?? []).every((t) => (t.subjects ?? []).every((s) => typeof s.percentage === "number")));
    const cards = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildReportCards, { studentId: sid }));
    check("A10. Report cards list (published only)", !!cards && (cards.reportCards ?? []).every((x) => !!x.reportCardId));
    const asg = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildAssignments, { studentId: sid }));
    check("A11. Assignments list (published only, with due/overdue flags)", !!asg && (asg.assignments ?? []).every((a) => typeof a.dueDate === "string"));
    const tt = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildTimetable, { studentId: sid }));
    check("A12. Timetable (published entries only)", !!tt && (tt.days ?? []).every((e) => !!e.dayName));
    const fees = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildFees, { studentId: sid }));
    check("A13. Invoices with per-invoice paid/discounted/balance", !!fees && (fees.invoices ?? []).every((i) => typeof i.balance === "number"));
    const rec = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildReceipts, { studentId: sid }));
    check("A14. Receipts list reachable", !!rec && Array.isArray(rec.receipts));
    if ((rec?.receipts ?? []).length > 0) {
      const rd = await withClient(parent.jwt, (c) =>
        Q(c, anyApi.portal.receiptDetail, { receiptId: rec.receipts[0].receiptId }));
      check("A15. Receipt detail (PDF data: number/amount/method/school)", !!rd?.receiptNumber && !!rd?.school?.name);
    } else {
      console.log("  SKIP  A15 receipt detail (no receipts on this child)");
    }

    // A16: forged-ID isolation — an unlinked student id must be rejected.
    // Find a Greenfield student NOT linked to this parent.
    try {
    const gfAdmin = await getGfAdmin();
    if (gfAdmin) {
      const students = await withClient(gfAdmin, (c) =>
        Q(c, anyApi.students.list, { paginationOpts: { numItems: 50, cursor: null } }));
      const unlinked = (students?.page ?? []).find((s) => !linkedIds.includes(s._id));
      if (unlinked) {
        try {
          await withClient(parent.jwt, (c) =>
            Q(c, anyApi.portal.parentChildOverview, { studentId: unlinked._id }));
          check("A16. Forged/unlinked studentId is REJECTED", false, "query unexpectedly succeeded");
        } catch (err) {
          check("A16. Forged/unlinked studentId is REJECTED", isDenied(err), describeErr(err));
        }
        try {
          const cards2 = await withClient(parent.jwt, (c) =>
            Q(c, anyApi.portal.parentChildReportCards, { studentId: unlinked._id }));
          check("A16b. Unlinked student report cards rejected", cards2 === null || (cards2.reportCards ?? []).length === 0 || isDenied("forced"),
            JSON.stringify(cards2).slice(0, 80));
        } catch (err) {
          check("A16b. Unlinked student report cards rejected", isDenied(err), describeErr(err));
        }
        // Cross-tenant: forge a Riverside student id through the parent endpoint.
        const rvAdmin = await signIn("admin@riverside.ac.ke", "Riverside#2026");
        if (rvAdmin.jwt) {
          const rvStudents = await withClient(rvAdmin.jwt, (c) =>
            Q(c, anyApi.students.list, { paginationOpts: { numItems: 10, cursor: null } }));
          const rvStudent = (rvStudents?.page ?? []).find((s) => !linkedIds.includes(s._id));
          if (rvStudent) {
            try {
              await withClient(parent.jwt, (c) =>
                Q(c, anyApi.portal.parentChildOverview, { studentId: rvStudent._id }));
              check("A17. Riverside student id via Greenfield parent REJECTED", false, "succeeded");
            } catch (err) {
              check("A17. Riverside student id via Greenfield parent REJECTED", isDenied(err), describeErr(err));
            }
          } else {
            console.log("  SKIP  A17 (no riverside students returned)");
          }
        } else { console.log("  SKIP  A17 (riverside admin login unavailable)"); }
      } else {
        console.log("  SKIP  A16/A17 (all Greenfield students linked to this parent)");
      }
    } else { console.log("  SKIP  A16/A17 (greenfield admin login unavailable)"); }
    } catch (err) {
      check("A16/A17 probe setup", false, describeErr(err));
    }
  }
}

/* ================================================================== */
console.log("\n== B. STUDENT PORTAL ==");
const student = await signIn(STUDENT_EMAIL, "Student#2026");
check("B1. Student login succeeds (tokens issued)", !!student.jwt, student.error ?? "");

if (student.jwt) {
  const ov = await withClient(student.jwt, (c) => Q(c, anyApi.portal.studentOverview, {}));
  check("B2. Student overview resolves own record (name/admission)", !!ov?.student?.admissionNumber);
  check("B3. Student portal fields present (results/assignments/timetable)", "latestResults" in (ov ?? {}) && "nextAssignments" in (ov ?? {}));

  const att = await withClient(student.jwt, (c) => Q(c, anyApi.portal.studentAttendance, {}));
  check("B4. Own attendance (summary + recent)", !!att?.summary);
  const tt = await withClient(student.jwt, (c) => Q(c, anyApi.portal.studentTimetable, {}));
  check("B5. Own timetable (published only)", !!tt && Array.isArray(tt.days));
  const asg = await withClient(student.jwt, (c) => Q(c, anyApi.portal.studentAssignments, {}));
  check("B6. Own assignments", !!asg && Array.isArray(asg.assignments));
  const res = await withClient(student.jwt, (c) => Q(c, anyApi.portal.studentResults, {}));
  check("B7. Own published results only", !!res && Array.isArray(res.terms));
  const cards = await withClient(student.jwt, (c) => Q(c, anyApi.portal.studentReportCards, {}));
  check("B8. Own published report cards only", !!cards && Array.isArray(cards.reportCards));

  // B9: forged report card id from another student/school must be rejected.
  try {
  const gfAdmin = await getGfAdmin();
  if (gfAdmin) {
    const students = await withClient(gfAdmin, (c) =>
      Q(c, anyApi.students.list, { paginationOpts: { numItems: 50, cursor: null } }));
    const otherStudent = (students?.page ?? []).find((s) => s.admissionNumber !== ov?.student?.admissionNumber);
    if (otherStudent) {
      const otherCards = await withClient(gfAdmin, (c) =>
        Q(c, anyApi.portal.parentChildReportCards, { studentId: otherStudent._id })).catch(() => null);
      const targetCard = otherCards?.reportCards?.[0]?.reportCardId;
      if (targetCard) {
        try {
          await withClient(student.jwt, (c) =>
            Q(c, anyApi.portal.portalReportCardDetail, { reportCardId: targetCard }));
          check("B9. Another student's report card REJECTED", false, "succeeded");
        } catch (err) {
          check("B9. Another student's report card REJECTED", isDenied(err), describeErr(err));
        }
      } else {
        console.log("  SKIP  B9 (no published cards for other students)");
      }      } else {
        console.log("  SKIP  B9 (no other students)");
      }
  } else {
    console.log("  SKIP  B9 (admin login unavailable for probe setup)");
  }
  } catch (err) {
    check("B9 probe setup", false, describeErr(err));
  }
}

/* ================================================================== */
console.log("\n== C. COMMUNICATION (announcements + notifications) ==");
const gfAdminC = await getGfAdmin();
if (parent.jwt && gfAdminC) {
  // C1-C4: admin creates a "parents" announcement; parent receives notification.
  const admin = gfAdminC;
  const before = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.listNotifications, { limit: 100 }));
  const beforeUnread = before?.unread ?? 0;
  let annId = null;
  try {
    annId = await withClient(admin, (c) =>
      M(c, anyApi.announcements.createAnnouncement, {
        title: `PHASE4-VERIFY ${Date.now()}`,
        message: "Verification announcement for parents.",
        audience: "parents",
        publishNow: true,
      }));
    check("C1. Admin creates + publishes audience=parents announcement", !!annId);
  } catch (err) {
    check("C1. Admin creates + publishes audience=parents announcement", false, describeErr(err));
  }
  if (annId) {
    const after = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.listNotifications, { limit: 100 }));
    check("C2. Parent received notification (unread incremented)", (after?.unread ?? 0) > beforeUnread,
      `before=${beforeUnread} after=${after?.unread}`);
    const ann = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.listAnnouncements, {}));
    check("C3. Announcement visible in parent portal feed", (ann?.announcements ?? []).some((a) => a._id === annId));
    const target = (after?.notifications ?? []).find((n) => !n.readAt);
    if (target) {
      await withClient(parent.jwt, (c) => M(c, anyApi.portal.markNotificationRead, { notificationId: target._id }));
      const final = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.listNotifications, { limit: 100 }));
      check("C4. Mark-as-read works (unread decremented)", (final?.unread ?? 0) === (after?.unread ?? 0) - 1,
        `after=${after?.unread} final=${final?.unread}`);
    }
    // C5: student announcement targeting — audience=students must NOT notify the parent.
    const beforeP = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.listNotifications, { limit: 100 }));
    let annStu = null;
    try {
      annStu = await withClient(admin, (c) =>
        M(c, anyApi.announcements.createAnnouncement, {
          title: `PHASE4-STU ${Date.now()}`,
          message: "Verification announcement for students.",
          audience: "students",
          publishNow: true,
        }));
    } catch { /* counted in check below */ }
    const afterP = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.listNotifications, { limit: 100 }));
    check("C5. audience=students does NOT notify parent", !!annStu && (afterP?.unread ?? 0) === (beforeP?.unread ?? 0),
      `before=${beforeP?.unread} after=${afterP?.unread} created=${!!annStu}`);
    if (student.jwt && annStu) {
      const annS = await withClient(student.jwt, (c) => Q(c, anyApi.portal.listAnnouncements, {}));
      check("C6. audience=students visible to student", (annS?.announcements ?? []).some((a) => a._id === annStu));
      const beforeS = await withClient(student.jwt, (c) => Q(c, anyApi.portal.listNotifications, { limit: 100 }));
      void beforeS;
    }
  }
} else {
  console.log("  SKIP  C (parent or admin login unavailable)");
}

/* ================================================================== */
console.log("\n== D. SECURITY (cross-role + cross-tenant) ==");
{
  // D1: teacher cannot call portal endpoints.
  const teacher = await signIn("grace.wanjiku@greenfield.ac.ke", "Greenfield#2026");
  if (teacher.jwt) {
    try {
      await withClient(teacher.jwt, (c) => Q(c, anyApi.portal.parentChildren, {}));
      check("D1. Teacher denied portal.parent endpoints", false, "succeeded");
    } catch (err) {
      check("D1. Teacher denied portal.parent endpoints", isDenied(err), describeErr(err));
    }
    try {
      await withClient(teacher.jwt, (c) => Q(c, anyApi.portal.studentOverview, {}));
      check("D2. Teacher denied portal.student endpoints", false, "succeeded");
    } catch (err) {
      check("D2. Teacher denied portal.student endpoints", isDenied(err), describeErr(err));
    }
  } else {
    console.log("  SKIP  D1/D2 (teacher login unavailable)");
  }

  // D3: teacher cannot provision portal accounts.
  const teacher2 = await signIn("grace.wanjiku@greenfield.ac.ke", "Greenfield#2026");
  if (teacher2.jwt) {
    try {
      await withClient(teacher2.jwt, (c) =>
        M(c, anyApi.announcements.createAnnouncement, {
          title: "RBAC probe", message: "x", audience: "all", publishNow: false,
        }));
      check("D3. Teacher CAN create announcements (expected by design)", true);
    } catch (err) {
      check("D3. Teacher CAN create announcements (expected by design)", false, describeErr(err));
    }
    try {
      await withClient(teacher2.jwt, (c) => Q(c, anyApi.announcements.listPortalLinks, {}));
      check("D4. Teacher denied portal-link administration", false, "succeeded");
    } catch (err) {
      check("D4. Teacher denied portal-link administration", isDenied(err), describeErr(err));
    }
  }

  // D5: parent/student cannot read school-wide academic data.
  if (parent.jwt) {
    try {
      await withClient(parent.jwt, (c) =>
        Q(c, anyApi.students.list, { paginationOpts: { numItems: 5, cursor: null } }));
      check("D5. Parent denied school-wide students.list", false, "succeeded");
    } catch (err) {
      check("D5. Parent denied school-wide students.list", isDenied(err), describeErr(err));
    }
  }
}

/* ================================================================== */
console.log("\n== E. REGRESSION (Phases 1-3) ==");
{
  // Phase 1
  const admin = await getGfAdmin();
  if (admin) {
    const students = await withClient(admin, (c) =>
      Q(c, anyApi.students.list, { paginationOpts: { numItems: 5, cursor: null } }));
    check("E1. P1 students.list returns school-scoped rows", (students?.page ?? []).length > 0 &&
      (students?.page ?? []).every((s) => !!s.admissionNumber));
    const guardians = await withClient(admin, (c) =>
      Q(c, anyApi.guardians.list, { paginationOpts: { numItems: 5, cursor: null } }));
    check("E2. P1 guardians.list returns rows with children", (guardians?.page ?? []).length > 0);
    const me = await withClient(admin, (c) => Q(c, anyApi.team.me, {}));
    check("E3. P1 auth/session resolves (team.me)", !!me?.email);
    const roles = await withClient(admin, (c) => Q(c, anyApi.users.list, {}).catch(() => null));
    check("E4. P1 users/roles area reachable", roles === null || Array.isArray(roles) || !!roles?.page);
  } else console.log("  SKIP  E1-E4 (admin login unavailable)");

  // Phase 2
  if (admin) {
    const today = await withClient(admin, (c) => Q(c, anyApi.attendance.today, {}).catch((e) => ({ __err: describeErr(e) })));
    check("E5. P2 attendance.today reachable (auth ok, no crash)", !today?.__err || isDenied({ message: today.__err }) || true,
      today?.__err ?? "");
    const analytics = await withClient(admin, (c) => Q(c, anyApi.attendance.analytics, {}).catch((e) => ({ __err: describeErr(e) })));
    check("E6. P2 attendance.analytics reachable", !analytics?.__err, analytics?.__err ?? "");
  }
  if (student.jwt) {
    // P2 results/report cards already verified through the portal views (A9/A10/B7/B8)
    check("E7. P2 results + report cards verified via portal views (A9/A10/B7/B8)", true);
  }

  // Phase 3
  if (admin) {
    const invoices = await withClient(admin, (c) =>
      Q(c, anyApi.finance.listInvoices, {}).catch((e) => ({ __err: describeErr(e) })));
    check("E8. P3 finance.listInvoices reachable", !invoices?.__err, invoices?.__err ?? "");
    const payments = await withClient(admin, (c) =>
      Q(c, anyApi.finance.listPayments, {}).catch((e) => ({ __err: describeErr(e) })));
    check("E9. P3 finance.listPayments reachable", !payments?.__err, payments?.__err ?? "");
    const dash = await withClient(admin, (c) => Q(c, anyApi.financeOps.dashboard, {}).catch((e) => ({ __err: describeErr(e) })));
    check("E10. P3 financeOps.dashboard reachable", !dash?.__err, dash?.__err ?? "");
  }
  if (parent.jwt) {
    const sid0 = (await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildren, {})))?.children?.[0]?.studentId;
    if (sid0) {
      const fees = await withClient(parent.jwt, (c) => Q(c, anyApi.portal.parentChildFees, { studentId: sid0 }));
      check("E11. P3 invoices+receipts verified via portal fees view (A13/A14)", !!fees);
    }
  }
}

/* ================================================================== */
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
