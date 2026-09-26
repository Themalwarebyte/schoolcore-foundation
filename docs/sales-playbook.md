# SchoolCore — Sales Playbook

> Companion to `docs/commercial-packaging.md` (packaging/pricing drafts) and
> `docs/customer-onboarding.md` (implementation journey). Commercial choices
> remain **OWNER DECISION REQUIRED**.

---

## 1. Discovery questions (ask before demoing)

Goal: understand the school's real workflow and pain before showing the
product. Listen for problems SchoolCore already solves; note anything that
would require customisation (flag it honestly).

**Size & structure**
1. How many students, and how many campuses/sites?
2. How many teachers and administrative staff?
3. Which grades/curricula do you run?

**Current systems**
4. What do you use today for records, fees, exams and communication? (Paper, Excel, another system?)
5. What works well in it — and what made you look for a change now?

**Fees & payments**
6. Walk me through fee structuring, invoicing and receipting today.
7. How do M-Pesa payments reach your records — manual reconciliation? Bank statements?
8. How long does end-of-term fee reconciliation take today?

**Exams & results**
9. How are marks captured, aggregated and report cards produced?
10. How long from last exam to report cards reaching parents?

**Attendance**
11. How is daily (and per-lesson) attendance taken today? How is absenteeism followed up?

**Operations modules**
12. Do you run transport, boarding, library, meals or a school clinic? How are they managed?

**Payroll & HR**
13. How are staff records, contracts, leave and payroll handled?

**Communication**
14. How do you reach parents today (SMS, WhatsApp, print)? What does it cost/who chases it?

**Pain & decision**
15. What are the two or three biggest pain points you want solved first?
16. What would make this project a success by end of term?
17. Who is involved in the decision, and who signs? (owner/proprietor, principal, bursar, board)
18. What is your desired start date, and are there budget cycles we should fit?
19. If you have data in another system or Excel, who can export it, and in what format?
20. May we run a guided demo for your team next week?

---

## 2. Sales demo script (20–30 minutes)

Theme: **"From scattered records to a school that runs itself."** Solve school
problems on screen; never list features. Use the Greenfield demo accounts
(see `docs/demo-accounts.md`; demo only). Ask discovery questions first —
tailor emphasis to their answers.

| # | Beat | Minutes | What you show | The problem it solves |
| - | --- | --- | --- | --- |
| 0 | Opening frame | 2 | Recap their pain points from discovery; promise: "I'll show you exactly how these get solved." | Makes it their demo, not a product tour |
| 1 | Platform overview | 2 | Sign in as school admin; one screen: one school, every module in one place, role-based access | "Too many disconnected tools and spreadsheets" |
| 2 | School dashboard | 2 | Attention list: overdue invoices, pending admissions, leave requests, setup progress card | "I don't know what needs my attention until it's late" |
| 3 | Student record | 3 | Open a student: profile, guardians, enrolment history, fees, documents | "Student information lives in ten places" |
| 4 | Attendance | 3 | Take a register for today, mark a few students, show history & analytics | "We only find out about absenteeism at the end of term" |
| 5 | Results & report card | 4 | Marks grid → submit → approve → publish; open the published report card | "Report cards take weeks and errors slip through" |
| 6 | Finance, payment & receipt | 4 | Invoice with votehead breakdown → record a payment → receipt; reconciliation & bank imports for M-Pesa/bank statements | "Manual fee chasing, paper receipts, reconciliation nightmares" |
| 7 | Parent portal | 3 | Sign in as the demo parent: child switcher, attendance, results, report card, fees & receipts, announcements | "Parents call the office for everything" |
| 8 | Teacher workflow | 2 | Sign in as teacher: my classes, today's lessons, take attendance, enter marks | "Teachers waste time on paperwork instead of teaching" |
| 9 | School onboarding | 2 | Show School Setup checklist and the CSV importers (students, staff) | "Getting started looks risky — show them it's a guided path" |
| 10 | Security & audit | 2 | Roles matrix, permission-gated medical/payroll, audit log of every action, tenant isolation (Riverside vs Greenfield) | "Our data must be safe and private" |
| 11 | Close | 3 | Recap THEIR pains → how each is now solved; propose next step (proposal, pilot) | Convert conviction into a concrete next step |

Tips: use their vocabulary; if they mentioned M-Pesa pain, spend longer in
finance; if report cards are the wound, run the results workflow end to end.
Never demo a module they don't have.

---

## 3. Customer proposal structure

A reusable outline — paste school-specific content from discovery.

1. **Cover** — school name, date, validity (e.g. 30 days), presenter.
2. **Understanding your school** — mirror discovery: population, campuses, current process, pains (in their words).
3. **Proposed solution** — SchoolCore as the single system: one database, role-based access, portals, audit trail.
4. **Included modules** — per the agreed plan tier (from `docs/commercial-packaging.md`), listed by category with one-line outcomes ("Attendance — daily and per-lesson registers with absenteeism analytics").
5. **Implementation plan** — summary of `docs/customer-onboarding.md` stages with dates: kickoff, data templates, imports, configuration, validation, training, pilot, go-live.
6. **Training** — admin, teacher and (optionally) parent-orientation sessions; who attends, duration, format.
7. **Security & privacy** — per-school data isolation, permission gating of medical/payroll, hashed invite tokens, full audit trail, env-only secrets (reference security audit results).
8. **Support** — severity levels and channels per `docs/customer-support.md` (no contractual SLAs until Owner-approved).
9. **Investment** — per the Owner-approved pricing model: subscription, per-student component, implementation fee, optional integrations. Show yearly total.
10. **Payment terms** — e.g. annually in advance or monthly; implementation fee split; invoicing entity. **OWNER DECISION REQUIRED**
11. **Timeline** — indicative week-by-week from signature to go-live (typical 4–8 weeks depending on data).
12. **Responsibilities** — SchoolCore vs school (see onboarding playbook table).
13. **Next steps** — signature, kickoff date, named school contact, data export assignment.

---

## 4. Commercial risks & mitigations

| Risk | Signal | Mitigation |
| --- | --- | --- |
| **Schools resisting migration** | "We've always used paper/Excel"; fear of change | Start with the pilot plan; migrate only what exists (imports accept Excel-exportable CSVs); keep the old way running in parallel during pilot; celebrate quick wins (first receipt, first report card) |
| **Poor source data** | Duplicate students, inconsistent names, no guardian phones | Data templates with validation rules; import preview shows rejects before commit; validation workshop before import; phased import (students → staff → finance) |
| **Unreliable internet** | Rural schools, load-shedding | Offline-friendly habits (paper register → back-capture); position mobile-first portals; set expectations about connectivity at kickoff; consider school-local champion with smartphone |
| **Payment integration expectations** | "Will M-Pesa post automatically?" | Be precise: in-app payment recording is standard; automated M-Pesa/bank callbacks are an Enterprise integration with per-school setup; confirm expectations in writing at proposal stage |
| **Training requirements** | Low digital literacy among some staff | Role-based sessions (admin vs teacher vs bursar); train champions per department; short reference cards; portal is deliberately simple/mobile-first |
| **Customisation pressure** | "Can it do X just for us?" | Say yes to configuration (fee structures, grading schemes, terms), no to forks; log genuine gaps for roadmap review with the Owner; never promise custom code in the sales cycle |
| **Support workload** | Many schools, small team | Support model with severity levels and business-hours window; self-serve docs (demo accounts, import templates); train-the-trainer so the school absorbs first-line questions |
| **Slow procurement decisions** | Boards meet termly | Align to school calendars (propose term-start go-lives); keep proposal validity short (30 days); offer pilot to maintain momentum while boards decide |
| **Trial/pilot abuse** | Endless pilots that never convert | Time-boxed pilots with written success criteria and a decision date; credits toward subscription (Owner-approved policy) |
| **Single-school dependency** | First customer = 100% of revenue | Free/low-cost pilot portfolio of 2–3 schools from the start; document case studies; keep sales pipeline moving during pilots |
| **Data privacy expectations** | Parents' sensitive data | Permission-gated medical/payroll; audit trail; minimal staff exposure; reference the security audit in proposals |
| **Churn after year one** | Poor adoption post go-live | Post-launch review (30 days) and termly check-ins; adoption metrics (attendance taken daily, results published on time) as health signals |
