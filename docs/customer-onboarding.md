# SchoolCore — Customer Onboarding Playbook

> Covers the implementation service package, the full journey from signed
> agreement to post-launch review, responsibility split, and the first-school
> pilot framework. Fees and what is chargeable are **OWNER DECISION REQUIRED**;
> this document describes the operating model, not prices.

---

## 1. Standard implementation package

Stages (all use existing product capability — CSV importers, School Setup,
configuration screens; no custom development is included):

1. **School discovery meeting** — walk through current processes, agree scope, name the school's implementation contact.
2. **Data templates** — provide CSV templates (students/guardians, staff) and fee-structure worksheets; explain required columns and formats.
3. **Student import** — school fills templates; we validate via the importer's preview (rejects surfaced before commit), then import with guardians linked.
4. **Staff import** — same validate-then-import flow for staff and (optionally) initial users.
5. **Academic configuration** — academic year, terms, grade levels, classes/streams, subjects, teacher allocations, timetable entries.
6. **Finance configuration** — fee structures and voteheads, discounts/scholarships, opening balances and any existing-year invoices agreed at discovery.
7. **User setup** — administrator accounts via invitation (each user sets their own password through one-time activation links — no temporary passwords circulate).
8. **Administrator training** — live session for admin/bursar/principal: dashboard, students, finance, imports, users, audit.
9. **Teacher training** — live session: attendance, marks entry, assignments; plus the teacher home page.
10. **Parent rollout** — announcement template, parent-orientation session (optional), portal access letters; activation links distributed per school's process.
11. **Go-live support** — first days/weeks hyper-care window; daily check-ins during the first attendance/invoicing cycles.

### Included vs potentially chargeable

| Item | Typically included | Potentially chargeable (OWNER DECISION REQUIRED) |
| --- | :-: | :-: |
| Discovery meeting, templates, imports (up to agreed row counts) | ✔ | extra batches / re-imports |
| Standard academic + finance configuration | ✔ | complex multi-year/multi-campus setups |
| Admin + teacher training (agreed sessions) | ✔ | extra sessions, on-site visits, parent orientation |
| Go-live hyper-care (agreed window) | ✔ | extended hyper-care |
| Integrations (M-Pesa/bank callbacks, SMS, QR terminals) | — | per-school setup — Enterprise tier |
| Data cleaning performed *for* the school | — | heavy cleansing beyond validation support |
| Custom reports / custom development | — | out of scope for standard implementation |

---

## 2. The journey (signed agreement → post-launch review)

```
Signed agreement → Kickoff → Data collection → System configuration →
Migration → Validation → Training → Pilot → Go-live → Post-launch review
```

| Stage | SchoolCore does | School does | Exit criterion |
| --- | --- | --- | --- |
| **Signed agreement** | Countersign; open implementation record; send welcome pack | Nominate implementation contact (one name) | Both parties confirm kickoff date |
| **Kickoff (1 meeting)** | Facilitate; present timeline; agree scope & data owners | Attend (principal, bursar, IT/contact); confirm scope | Signed-off scope + timeline in writing |
| **Data collection (1–2 wks)** | Deliver templates + worked examples; review first drafts | Fill student/guardian + staff templates from existing records | Templates returned; error rate acceptable |
| **System configuration** | Provision school; configure academic + finance structures with the school's data; create users | Review and confirm structures (terms, classes, fees) | School Setup checklist complete; demo-ready |
| **Migration / imports** | Run imports via preview → commit; fix template issues | Supply corrected files when validation rejects rows | Students, guardians, staff imported and spot-checked |
| **Validation (3–5 days)** | Reconcile counts with school (students per class, fee totals) | Verify sample students, fee structures, opening balances | Written validation sign-off by school |
| **Training** | Run admin + teacher sessions; provide quick-reference material | Release staff to attend; provide venue/logistics | Staff can perform core tasks unaided (checklist) |
| **Pilot (2–4 wks)** | Hyper-care; fix genuine defects; monitor adoption | Run real workflows: attendance, marks, invoicing in parallel with old process | Pilot success criteria met (below) |
| **Go-live** | Cut-over checklist; decommission parallel process; stand by | Stop double-entry; adopt SchoolCore as system of record | First full cycle (attendance + invoicing) completed in SchoolCore |
| **Post-launch review (day ~30)** | Review adoption metrics & feedback; agree support cadence | Provide feedback; confirm subscription activation | Review meeting held; support model active |

**Responsibilities summary**

- **SchoolCore owns:** provisioning, configuration, import execution, training delivery, hyper-care, defect fixes, security of the platform.
- **School owns:** data accuracy and templates, staff attendance at training, internal communication to parents, decisions (fee structures, grading schemes), timely sign-offs.

---

## 3. First-school pilot plan

Purpose: prove SchoolCore in one real school, create a reference story, and
harden implementation before scaling.

### Stages
1. **Select school** — engaged, digitisation-minded, reachable, modest size first (200–600 students is ideal), willing to be a reference.
2. **Sign pilot agreement** — time-boxed (one term), written scope, written success criteria, decision date, and what happens on success (subscription, possibly pilot-fee credit) — terms **OWNER DECISION REQUIRED**.
3. **Baseline current processes** — document how attendance/fees/results work today (photographs of the "before" are powerful for the case study).
4. **Import sample data** — one class-level batch first, then the school; use the standard importers.
5. **Validate workflows** — attendance, marks → report card, invoice → payment → receipt, parent portal access.
6. **Train key users** — 2–3 champions (admin, bursar, lead teacher) before the wider staff.
7. **Run pilot** — real usage for the term; weekly check-in call; issues logged.
8. **Collect feedback** — structured survey + interviews (admin, teachers, a parent group); usage metrics from the platform.
9. **Correct genuine issues** — defects fixed as product bugs; configuration adjusted; enhancements go to the roadmap list, **not** custom code.
10. **Production go-live** — after criteria met and school sign-off.
11. **30-day review** — adoption metrics review; case study (with consent); reference call for prospects.

### Success criteria (all should be true)

- [ ] Users (admin, teachers, accountant) can log in and reach their workflows.
- [ ] Student data is accurate: class rosters match reality; guardians linked.
- [ ] Invoices reconcile: issued totals and payment totals match school records.
- [ ] Teachers take daily attendance without assistance.
- [ ] Results publish correctly: report cards generated through the real workflow and accepted by the school.
- [ ] Parents access their children (portal activation + first sign-ins).
- [ ] No tenant/security issues (no cross-school data access; permission denials behave correctly).
- [ ] School administration accepts migration (written go-live confirmation).

Pilot exit: criteria met → go-live + subscription activation. Criteria not met
→ written gap list, remediation plan, decision date. **Commercial terms of any
kind: OWNER DECISION REQUIRED.**
