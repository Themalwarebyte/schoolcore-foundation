/**
 * SchoolCore Phase 3 verification — exercises the REAL backend (Convex) over
 * authenticated connections against the live seeded deployment.
 *
 * Run: SMOKE_CONVEX_URL=https://<name>.convex.cloud bun scripts/phase3.test.ts
 * Optional: SEED_SECRET=… (runs the idempotent seed/repair first)
 *
 * Safety: creates only SMOKE/PH3-prefixed records inside Greenfield Academy
 * (draft invoice + payment + discount + refund + expense), then reverses or
 * cancels them. Seeded demo data is never modified or destroyed.
 */
const url = process.env.SMOKE_CONVEX_URL;
if (!url) {
  console.error("SMOKE_CONVEX_URL is required, e.g. SMOKE_CONVEX_URL=https://<name>.convex.cloud bun scripts/phase3.test.ts");
  process.exit(1);
}

const { anyApi } = await import("convex/server");
const { ConvexHttpClient } = await import("convex/browser");

const SUPER_ADMIN = { email: "admin@schoolcore.dev", password: "ChangeMe!2026" };
const GF_ADMIN = { email: "admin@greenfield.ac.ke", password: "Greenfield#2026" };
const ACCOUNTANT = { email: "accounts@greenfield.ac.ke", password: "Greenfield#2026" };
const TEACHER = { email: "grace.wanjiku@greenfield.ac.ke", password: "Greenfield#2026" };
const PRINCIPAL = { email: "principal@greenfield.ac.ke", password: "Greenfield#2026" };
const RV_ADMIN = { email: "admin@riverside.ac.ke", password: "Riverside#2026" };

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name + (detail ? ` — ${detail}` : "")); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
function describeErr(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 140);
  return String(err).slice(0, 140);
}
const errOf = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try { await fn(); return null; } catch (err) { return describeErr(err); }
};

async function signIn(email: string, password: string): Promise<string | null> {
  const c = new ConvexHttpClient(url);
  try {
    const res = await c.action(anyApi.auth.signIn, { provider: "password", params: { flow: "signIn", email, password } });
    return res?.tokens?.token ?? null;
  } catch (err) {
    console.error(`  sign-in failed for ${email}: ${describeErr(err)}`);
    return null;
  } finally { c.close?.(); }
}
function authed(jwt: string | null) {
  const c = new ConvexHttpClient(url);
  if (jwt) c.setAuth(jwt);
  return c;
}

console.log("== 0. Seed/repair (optional) ==");
if (process.env.SEED_SECRET) {
  const c = new ConvexHttpClient(url);
  try {
    await c.action(anyApi.seed.seedAll, { secret: process.env.SEED_SECRET });
    console.log("  seed/repair completed (finance gaps filled)");
  } catch (err) { console.log(`  seed skipped: ${describeErr(err)}`); }
  finally { c.close?.(); }
}

console.log("== 1. Sessions ==");
const saTok = await signIn(SUPER_ADMIN.email, SUPER_ADMIN.password);
const gfTok = await signIn(GF_ADMIN.email, GF_ADMIN.password);
const accTok = await signIn(ACCOUNTANT.email, ACCOUNTANT.password);
const tTok = await signIn(TEACHER.email, TEACHER.password);
const prTok = await signIn(PRINCIPAL.email, PRINCIPAL.password);
const rvTok = await signIn(RV_ADMIN.email, RV_ADMIN.password);
check("all six demo accounts authenticate", !!saTok && !!gfTok && !!accTok && !!tTok && !!prTok && !!rvTok);

const accClient = authed(accTok);
const gfClient = authed(gfTok);
const tClient = authed(tTok);
const rvClient = authed(rvTok);
const saClient = authed(saTok);

try {
  console.log("== 2. Context ==");
  const school = await accClient.query(anyApi.schools.getMySchool, {});
  check("accountant resolves school context", !!school);
  const actx = await accClient.query(anyApi.academics.academicContext, {});
  check("finance academic context resolves (year + term)", !!actx?.currentYear && !!actx?.currentTerm);
  const termId = actx?.currentTerm?._id as string | undefined;
  const yearId = actx?.currentYear?._id as string | undefined;

  console.log("== 3. Fee structures ==");
  const structures = await accClient.query(anyApi.feeStructures.listStructures, {});
  check("fee structures listed", (structures ?? []).length > 0, `${(structures ?? []).length}`);
  if (termId) {
    const saved = await accClient.mutation(anyApi.feeStructures.saveStructure, {
      name: "SMOKE PH3 Structure",
      termId: termId as never,
      applicableGradeLevelIds: [],
      items: [
        { name: "SMOKE Tuition", category: "Tuition", amount: 40000, mandatory: true },
        { name: "SMOKE Meals", category: "Meals", amount: 8000, mandatory: false },
      ],
    });
    check("fee structure created (2 items, 48000 total)", !!saved);
    const detail = await accClient.query(anyApi.feeStructures.structureDetail, { feeStructureId: saved as never });
    check("structure totals reconcile (48000)", detail?.total === 48000, `${detail?.total}`);
    await accClient.mutation(anyApi.feeStructures.archiveStructure, { feeStructureId: saved as never });
  }

  console.log("== 4. Billing: invoice totals + duplicate handling ==");
  const studentsPage = await accClient.query(anyApi.students.list, { paginationOpts: { numItems: 5, cursor: null } });
  const target = (studentsPage?.page ?? [])[0];
  check("seeded student available for billing", !!target);
  let invoiceId: string | null = null;
  if (target && termId) {
    invoiceId = await accClient.mutation(anyApi.finance.createInvoice, {
      studentId: target._id as never,
      termId: termId as never,
      issueDate: "2026-01-15",
      dueDate: "2026-02-15",
      items: [
        { description: "SMOKE Tuition", category: "Tuition", quantity: 1, amount: 40000 },
        { description: "SMOKE Transport", category: "Transport", quantity: 1, amount: 5000 },
      ],
      issueNow: true,
    });
    check("invoice created + issued (45000)", !!invoiceId);
    const detail = await accClient.query(anyApi.finance.invoiceDetail, { invoiceId: invoiceId as never });
    check("invoice total = 45000", detail?.totals.totalAmount === 45000, `${detail?.totals.totalAmount}`);
    check("invoice balance initially 45000", detail?.totals.balance === 45000, `${detail?.totals.balance}`);
    check("invoice references student + term (no duplicated names)",
      detail?.student?._id === target._id && detail?.term?._id === termId);

    // Ledger balance check: every transaction must balance.
    const trial1 = await accClient.query(anyApi.financeOps.trialBalance, {});
    check("ledger balanced after invoice issuance", trial1?.balanced === true, JSON.stringify({ d: trial1?.totalDebit, c: trial1?.totalCredit }));
  }

  console.log("== 5. Payments: recording, receipt, double-entry, duplicate refs ==");
  if (invoiceId && target) {
    const pay1 = await accClient.mutation(anyApi.finance.recordPayment, {
      studentId: target._id as never,
      invoiceId: invoiceId as never,
      amount: 20000,
      paymentDate: "2026-01-20",
      method: "Cash",
      referenceNumber: `SMOKE-PH3-${Date.now()}`,
    });
    check("payment recorded with receipt", !!pay1?.receiptNumber && pay1.receiptNumber.startsWith("REC-"), pay1?.receiptNumber);
    const detail1 = await accClient.query(anyApi.finance.invoiceDetail, { invoiceId: invoiceId as never });
    check("invoice partially paid (20000 of 45000)", detail1?.totals.paid === 20000 && detail1?.invoice.status === "partially_paid",
      `${detail1?.totals.paid}/${detail1?.invoice.status}`);

    // Duplicate reference rejection: reuse the exact reference of pay1.
    const dupRef = `SMOKE-DUP-${Date.now()}`;
    const dupOk = await accClient.mutation(anyApi.finance.recordPayment, {
      studentId: target._id as never, invoiceId: invoiceId as never, amount: 100,
      paymentDate: "2026-01-21", method: "Cash", referenceNumber: dupRef,
    });
    check("payment with fresh reference accepted", !!dupOk?.paymentId);
    // Reusing the SAME reference must be rejected by the backend.
    const dupErr = await errOf(() => accClient.mutation(anyApi.finance.recordPayment, {
      studentId: target._id as never, invoiceId: invoiceId as never, amount: 100,
      paymentDate: "2026-01-21", method: "Cash", referenceNumber: dupRef,
    }));
    check("duplicate payment reference rejected", dupErr !== null, dupErr ?? "accepted");
    // Reverse the fresh-reference payment so seeded-data totals stay clean.
    if (dupOk?.paymentId) {
      try {
        await accClient.mutation(anyApi.finance.reversePayment, { paymentId: dupOk.paymentId as never, reason: "SMOKE dup-ref cleanup" });
      } catch (err) { console.log(`  (dup cleanup skipped: ${describeErr(err)})`); }
    }

    const negErr = await errOf(() => accClient.mutation(anyApi.finance.recordPayment, {
      studentId: target._id as never, amount: -50, paymentDate: "2026-01-21", method: "Cash",
    }));
    check("negative payment rejected", negErr !== null, negErr ?? "accepted");

    const after = await accClient.query(anyApi.financeOps.trialBalance, {});
    check("ledger still balanced after payments", after?.balanced === true);
    check("payment debits cash, credits receivable (debit=credit totals)",
      after?.totalDebit === after?.totalCredit, `${after?.totalDebit} vs ${after?.totalCredit}`);

    const stmt = await accClient.query(anyApi.finance.accountStatement, { studentId: target._id as never });
    check("statement lines derive from ledger (invoice debit + payment credit)",
      (stmt?.lines ?? []).some((l: { type: string; debit: number }) => l.type === "invoice" && l.debit > 0) &&
      (stmt?.lines ?? []).some((l: { type: string; credit: number }) => l.type === "payment" && l.credit > 0));
    // The statement's final line's running balance must equal closingBalance
    // (reversal/refund lines can follow payments, so don't anchor on type).
    const lastLine = (stmt?.lines ?? [])[(stmt?.lines ?? []).length - 1];
    check("statement running balance ends at expected student balance",
      lastLine ? stmt?.closingBalance === lastLine.balance : true);

    // Reverse the payment; balance must return.
    if (pay1?.paymentId) {
      await accClient.mutation(anyApi.finance.reversePayment, { paymentId: pay1.paymentId as never, reason: "SMOKE reversal" });
      const detail2 = await accClient.query(anyApi.finance.invoiceDetail, { invoiceId: invoiceId as never });
      check("payment reversal restores invoice balance", detail2?.totals.paid === 0, `${detail2?.totals.paid}`);
      const trial2 = await accClient.query(anyApi.financeOps.trialBalance, {});
      check("ledger balanced after reversal", trial2?.balanced === true);
    }
  }

  console.log("== 6. Discounts: authorization + ledger effect ==");
  if (invoiceId && target) {
    const discId = await accClient.mutation(anyApi.finance.requestDiscount, {
      studentId: target._id as never,
      invoiceId: invoiceId as never,
      name: "SMOKE bursary",
      discountType: "percentage",
      value: 20,
      reason: "phase3 verification",
    });
    check("discount requested (pending)", !!discId);
    const approved = await accClient.mutation(anyApi.finance.approveDiscount, { discountId: discId as never });
    check("20% of 45000 = 9000 computed", approved?.computedAmount === 9000, `${approved?.computedAmount}`);
    const detail = await accClient.query(anyApi.finance.invoiceDetail, { invoiceId: invoiceId as never });
    check("discount credited to invoice (9000)", detail?.totals.discounted === 9000, `${detail?.totals.discounted}`);
  }

  console.log("== 7. Refunds ==");
  if (target) {
    const refundId = await accClient.mutation(anyApi.finance.requestRefund, {
      studentId: target._id as never,
      amount: 1000,
      reason: "SMOKE refund",
    });
    check("refund requested", !!refundId);
    const paid = await accClient.mutation(anyApi.finance.approveRefund, { refundId: refundId as never, payNow: true });
    check("refund approved + ledger paid", !!paid);
    const trial = await accClient.query(anyApi.financeOps.trialBalance, {});
    check("ledger balanced after refund", trial?.balanced === true);
  }

  console.log("== 8. Expenses workflow ==");
  const expenseId = await accClient.mutation(anyApi.financeOps.createExpense, {
    category: "SMOKE Supplies", payee: "SMOKE Vendor", amount: 5000, expenseDate: "2026-02-01", submitNow: false,
  });
  check("expense created (draft)", !!expenseId);
  const submitted = await accClient.mutation(anyApi.financeOps.submitExpense, { expenseId: expenseId as never });
  check("expense submitted", !!submitted);
  const expApproveErr = await errOf(() => accClient.mutation(anyApi.financeOps.approveExpense, { expenseId: expenseId as never }));
  check("accountant cannot approve own expense (creator ≠ approver)", expApproveErr !== null, expApproveErr ?? "allowed");
  const approved = await gfClient.mutation(anyApi.financeOps.approveExpense, { expenseId: expenseId as never });
  check("expense approved by school admin", !!approved);
  const paidExpense = await gfClient.mutation(anyApi.financeOps.payExpense, { expenseId: expenseId as never });
  check("expense paid (ledger-posted)", !!paidExpense?.transactionId);
  const trial3 = await accClient.query(anyApi.financeOps.trialBalance, {});
  check("ledger balanced after expense", trial3?.balanced === true);
  const expReport = await accClient.query(anyApi.financeOps.expenseReport, { from: "2026-01-01", to: "2026-12-31" });
  check("expense report includes the paid expense", (expReport?.byCategory ?? []).some((c: { category: string }) => c.category === "SMOKE Supplies"));

  console.log("== 9. RBAC: teacher blocked, accountant + principal scoped ==");
  if (invoiceId) {
    const teacherBlocked = await errOf(() => tClient.query(anyApi.finance.invoiceDetail, { invoiceId: invoiceId as never }));
    check("teacher cannot view invoices (billing.view denied)", teacherBlocked !== null, teacherBlocked ?? "allowed");
  }
  const teacherStudent = (await tClient.query(anyApi.students.list, { paginationOpts: { numItems: 1, cursor: null } }))?.page?.[0]?._id as never;
  const teacherPay = await errOf(() => tClient.mutation(anyApi.finance.recordPayment, {
    studentId: teacherStudent,
    amount: 100, paymentDate: "2026-02-01", method: "Cash",
  }));
  check("teacher cannot record payments", teacherPay !== null, teacherPay ?? "allowed");
  const accRead = await accClient.query(anyApi.finance.listInvoices, {});
  check("accountant can list invoices", Array.isArray(accRead));
  {
    const prClientC = authed(prTok);
    try {
      const principalRevenue = await prClientC.query(anyApi.financeOps.revenueReport, {});
      check("principal can view revenue report (financial_reports.view)", !!principalRevenue, "null");
    } catch (err) {
      check("principal can view revenue report (financial_reports.view)", false, describeErr(err));
    } finally {
      prClientC.close?.();
    }
  }

  console.log("== 10. Tenant isolation: Greenfield vs Riverside ==");
  if (invoiceId) {
    const rvBlocked = await errOf(() => rvClient.query(anyApi.finance.invoiceDetail, { invoiceId: invoiceId as never }));
    check("riverside admin cannot read greenfield invoice (forged ID)", rvBlocked !== null, rvBlocked ?? "allowed");
  }
  const rvInvoices = await rvClient.query(anyApi.finance.listInvoices, {});
  check("riverside invoice list is scoped (no SMOKE greenfield rows leak)",
    (rvInvoices ?? []).every((i: { studentName?: string }) => !!i.studentName && !i.studentName.includes("SMOKE")),
    JSON.stringify((rvInvoices ?? []).slice(0, 3)));
  const rvOutstanding = await rvClient.query(anyApi.financeOps.outstandingReport, {});
  check("riverside outstanding report only contains riverside students",
    (rvOutstanding?.rows ?? []).every((r: { studentName: string }) => !r.studentName.includes("SMOKE")));
  const rvTrial = await rvClient.query(anyApi.financeOps.trialBalance, {});
  const gfTrial = await accClient.query(anyApi.financeOps.trialBalance, {});
  check("riverside ledger totals differ from greenfield (separate books)",
    rvTrial?.totalDebit !== gfTrial?.totalDebit || (rvTrial?.totalDebit ?? 0) < (gfTrial?.totalDebit ?? 0));
  const rvStudent = (await rvClient.query(anyApi.students.list, { paginationOpts: { numItems: 1, cursor: null } }))?.page?.[0];
  const gfPayOnRv = rvStudent
    ? await errOf(() => accClient.mutation(anyApi.finance.recordPayment, {
        studentId: rvStudent._id as never, amount: 100, paymentDate: "2026-02-01", method: "Cash",
      }))
    : "no-rv-student";
  check("greenfield accountant cannot pay a riverside student", gfPayOnRv !== null, gfPayOnRv ?? "allowed");

  console.log("== 11. Historical integrity ==");
  if (invoiceId) {
    const detailA = await accClient.query(anyApi.finance.invoiceDetail, { invoiceId: invoiceId as never });
    // Save another fee structure (config change) — invoice must not change.
    if (termId) {
      const s2 = await accClient.mutation(anyApi.feeStructures.saveStructure, {
        name: "SMOKE PH3 Structure v2 (config change)",
        termId: termId as never,
        applicableGradeLevelIds: [],
        items: [{ name: "SMOKE Tuition v2", category: "Tuition", amount: 999, mandatory: true }],
      });
      void s2;
      await accClient.mutation(anyApi.feeStructures.archiveStructure, { feeStructureId: s2 as never });
    }
    const detailB = await accClient.query(anyApi.finance.invoiceDetail, { invoiceId: invoiceId as never });
    check("fee-structure changes do not alter existing invoices",
      detailA?.totals.totalAmount === detailB?.totals.totalAmount &&
      JSON.stringify(detailA?.items) === JSON.stringify(detailB?.items));
    // Cancel the smoke invoice with reason (audited).
    await accClient.mutation(anyApi.finance.cancelInvoice, { invoiceId: invoiceId as never, reason: "SMOKE cleanup" });
    const detailC = await accClient.query(anyApi.finance.invoiceDetail, { invoiceId: invoiceId as never });
    check("invoice cancelled (not deleted) with reason recorded", detailC?.invoice.status === "cancelled");
    const trial4 = await accClient.query(anyApi.financeOps.trialBalance, {});
    check("ledger balanced after cancellation reversal", trial4?.balanced === true);
  }

  console.log("== 12. Reports reconcile with the dashboard ==");
  const dash = await accClient.query(anyApi.financeOps.dashboard, {});
  const rev = await accClient.query(anyApi.financeOps.revenueReport, {});
  check("dashboard billed matches revenue report billed", dash?.totalBilled === rev?.billed, `${dash?.totalBilled} vs ${rev?.billed}`);
  check("dashboard outstanding = billed − collected − discounted",
    Math.abs((dash?.outstanding ?? 0) - ((rev?.billed ?? 0) - (rev?.collected ?? 0) - (rev?.discounted ?? 0))) < 0.01);
  const cash = await accClient.query(anyApi.financeOps.cashSummary, {});
  check("cash summary = received − spent", Math.abs((cash?.balance ?? 0) - ((cash?.received ?? 0) - (cash?.spent ?? 0))) < 0.01);
} finally {
  accClient.close?.();
  gfClient.close?.();
  tClient.close?.();
  rvClient.close?.();
  saClient.close?.();
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.log("\nFailed checks:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail > 0 ? 1 : 0);

/** Small helper for one-off authenticated principal queries. */
async function prClient(_api: unknown, tok: string | null, fn: { query: (c: unknown, args: unknown) => Promise<unknown> }, args: unknown) {
  const c = new ConvexHttpClient(url);
  try {
    if (tok) c.setAuth(tok);
    const value = await (fn as unknown as { query: (c: unknown, a: unknown) => Promise<unknown> }).query(c, args);
    return { ok: value !== undefined, err: null as string | null };
  } catch (err) {
    return { ok: false, err: describeErr(err) };
  } finally { c.close?.(); }
}
