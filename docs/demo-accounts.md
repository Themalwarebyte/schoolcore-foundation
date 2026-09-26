# Demo & Verification Accounts

> **DEMO / DEVELOPMENT ONLY — DO NOT USE THESE CREDENTIALS IN PRODUCTION.**
>
> These accounts are created by the demo seed (`src/convex/seed.ts`). They exist
> so evaluators can explore every role and so verification harnesses can run.
> Every password below is intentionally non-production. A real production launch
> must start from an **empty, unseeded deployment** — see
> [`docs/production-deployment.md`](./production-deployment.md).

## Account list

| # | Role           | Email                              | Password           | What it demonstrates |
| - | -------------- | ---------------------------------- | ------------------ | -------------------- |
| 1 | Platform Admin (super admin) | `admin@schoolcore.dev` | `ChangeMe!2026` | Cross-school platform console: school requests, schools list, platform users, platform audit. Bootstrap account (see note below). |
| 2 | School Admin   | `admin@greenfield.ac.ke`           | `Greenfield#2026`  | Full single-school workspace for **Greenfield Academy (GRN-001)**: dashboard, academics, students, staff, finance, operations, users, settings, School Setup. |
| 3 | Principal      | `principal@greenfield.ac.ke`       | `Greenfield#2026`  | People + academics management inside Greenfield; no user administration. |
| 4 | Teacher        | `grace.wanjiku@greenfield.ac.ke`   | `Greenfield#2026`  | Teacher home, timetable, attendance, assignments, marks entry, results workflow. |
| 5 | Accountant     | `accounts@greenfield.ac.ke`        | `Greenfield#2026`  | Invoices, payments, receipts, fee structures, reconciliation, bank imports, finance reports. |
| 6 | School Admin (isolation test) | `admin@riverside.ac.ke` | `Riverside#2026` | **Riverside School (RVS-002)** — exists to prove tenant isolation: signing in here must never show Greenfield data. |
| 7 | Parent         | `parent.wanjiku@greenfield.ac.ke`  | `Parent#2026`      | Parent portal with **two linked children** (child switcher), attendance, results, report cards, fees, invoices, receipts, announcements. |
| 8 | Student        | `student.demo@greenfield.ac.ke`    | `Student#2026`     | Student portal: timetable, assignments, attendance, published results, report card, announcements. |

### Platform Admin bootstrap note

The super admin is **not** part of the school seed data. It is created (or
repaired) by the `ensureBootstrapAdmin` bootstrap step, which is idempotent and
is also invoked by the seed. Its identity and password come from the deployment
environment — never from the repository:

- `PLATFORM_ADMIN_EMAIL` — defaults to `admin@schoolcore.dev`
- `PLATFORM_ADMIN_PASSWORD` — **required**; bootstrap refuses to mint the
  platform admin with a built-in default password
- `PLATFORM_ADMIN_NAME` — optional display name

On any fresh deployment, set these two variables first; on the demo deployment
they are set so the account above works.

## Greenfield demo data (created by the seed)

- 2 schools: Greenfield Academy (GRN-001, full demo) + Riverside School
  (RVS-002, isolation test with its own admin)
- 80 students with guardians (sibling groups share guardians), 11 staff,
  8 subjects
- 2026 academic year, 3 terms, 6 grade levels, 6 class sections
- Fee structures, invoices (partial + paid), payments, expense records
- Attendance sessions, assignments, subject results and **published report
  cards** (generated through the real grading/publishing engines)
- Announcements for parents, students and staff
- Parent linked to the first two active students; student portal link for the
  first student

The seed is idempotent and self-healing: re-running it repairs demo-account
memberships and re-publishes any missing demo results/report cards. It never
touches non-demo data.

## Verification harness data (SMOKE)

The suites in `scripts/` (`smoke.ts`, `phase2.test.ts`, `phase3.test.ts`,
`phase4-verify.mjs`, `phase5-verify.mjs`, `phase6-verify.mjs`,
`phase7-verify.mjs`, `security-audit.mjs`, `demo-polish.mjs`) create records
prefixed with `SMOKE` (or clearly harness-specific names such as
`SMOKE7-<run>-1`, `Admission Smoke<run>`), plus one reversible test payment.

Cleanup is built in:

- Each harness archives or reverses what it can at the end of its run.
- `bun scripts/demo-polish.mjs <convexUrl>` reverses leftover SMOKE payments,
  purges harness students, and republishes demo results/report cards.
- The diagnostics routine `purgeSmokeAssessments` (via the
  `diagnostics.runInternal` bridge) removes leftover harness assessments,
  applications and converted test students.

No SMOKE/harness record is ever part of the documented demo experience.

## Safety rules

1. Never reuse any password from this file in a real deployment.
2. Never point a production deployment at a seeded database — the demo/production
   separation relies on the seed never having run there.
3. The seed action is guarded: it refuses to run unless `SEED_SECRET` is set in
   the deployment environment. There is deliberately no repository fallback.
