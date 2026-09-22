# SchoolCore — School Management System (Phase 1)

A production-quality, **multi-school** School Management System: Student Information
System, academic management, staff records, guardian relationships, RBAC, audit
logging and a platform super-admin layer — built on a foundation ready for finance,
attendance, exams and portals in later phases.

Phase 1 scope: **Foundation & School Core.** No future-phase modules are implemented.

---

## Technology stack

| Layer      | Technology                                          |
| ---------- | --------------------------------------------------- |
| Frontend   | React 19 + TypeScript + Vite + Tailwind CSS 4       |
| UI         | shadcn/ui components, Recharts, Framer Motion       |
| Backend    | Convex functions (queries / mutations / actions)    |
| Database   | Convex documents with typed indexes (schema.ts)     |
| Auth       | Convex Auth — password provider (scrypt hashing)    |
| Routing    | React Router 7 with protected routes                |

## Architecture summary

```
Platform (super admin)
   ├── School A → memberships → users
   │              students ⇄ guardians (many-to-many)
   │              enrollments → academicYear + classSection → gradeLevel
   │              staff → teacherAllocations → classSection + subject
   ├── School B …
   └── School C …
```

- **One source of truth:** one `students` record per learner; future modules
  (attendance, fees, exams) reference the same ID.
- **Multi-tenancy:** every school-owned table carries `schoolId`; every query and
  mutation resolves the caller's session and enforces their school scope.
- **Backend authorization:** `requirePermission(ctx, "…")` guards every function;
  the client mirror is for UI only.
- **Audit trail:** `recordAudit` writes permanent, non-editable log entries for all
  important actions.

## Project structure

```
src/
  convex/            Backend functions & schema
    schema.ts        Tables, indexes, roles, permissions
    access.ts        Role → permission logic
    session.ts       Session resolution + getSchoolRecord (tenant choke point)
    audit.ts         Audit logger
    accounts.ts      Auth account internals, bootstrap admin, password flows
    team.ts          School user management (role changes, enable/disable)
    platform.ts      Platform super-admin queries (users, activity)
    schools.ts       School CRUD + settings + platform stats
    students.ts / guardians.ts / staff.ts
    academics.ts     Years, terms, grades, classes, subjects
    allocations.ts   Teacher ↔ class ↔ subject allocations
    enrollments.ts   Student ↔ year ↔ class enrollments
    dashboard.ts     Live dashboard aggregation
    search.ts        Tenant-safe global search
    seed.ts          Demo data seeding (guarded action)
  pages/             Route pages (school area, platform/ area, auth, landing)
  components/
    layouts/         Sidebar shells + PageHeader
    shared/          DataTable (pagination, skeleton, empty states)
    global-search    ⌘K school-wide search
  hooks/use-session  Client session + permission mirror
  lib/status         Status badges / date formatting
```

## Getting started

```bash
bun install
bun run dev            # Vite dev server (managed by the platform preview)
```

The Convex backend is pushed automatically by the platform; to push manually:

```bash
bunx convex dev --once       # typecheck + push functions, regenerate _generated
```

### Environment variables

All secrets are managed through the platform secret manager (the Keys/API Keys UI
in this environment) or the Convex deployment environment — **never committed to
the repository**. `.env.example` (if present) must contain placeholders only.

**Frontend hosting environment** (build-time, `VITE_`-prefixed):

| Variable          | Purpose                                     |
| ----------------- | ------------------------------------------- |
| `VITE_CONVEX_URL` | Convex deployment URL used by the browser. Must point at the SAME deployment that hosts the auth tables, backend functions and seeded accounts. |

**Convex deployment environment** (server-side; set via the platform/`convex env`):

| Variable                  | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `JWT_PRIVATE_KEY`, `JWKS` | Convex Auth token signing keys (provisioned automatically by the platform; never hardcode or commit). |
| `PLATFORM_ADMIN_EMAIL`    | Bootstrap super admin email (default `admin@schoolcore.dev`).   |
| `PLATFORM_ADMIN_NAME`     | Bootstrap super admin name.                                     |
| `PLATFORM_ADMIN_PASSWORD` | Bootstrap super admin password (dev default `ChangeMe!2026`).   |
| `SEED_SECRET`             | Guard for the seed action. **Required** — the seed refuses to run without it; set a strong random value. |

Do **not** set Convex system variables by hand: `CONVEX_SITE_URL` (the deployment's
`*.convex.site` HTTP-actions domain) and `CONVEX_DEPLOYMENT_NAME` are provided by
Convex itself. `auth.config.ts` reads `process.env.CONVEX_SITE_URL` at runtime —
never point it at the frontend URL or `localhost`. If a frontend origin is needed,
set a separate custom variable (e.g. `SITE_URL=https://schoolcore.freebuff.app/`).

**Local development only:** a local `.env` (git-ignored) may hold `VITE_CONVEX_URL`
for a local dev deployment. Never place production secrets in any committed file.

### Canonical `.env.example` content

> Note: the hosting platform blocks writes to `.env*` files from tooling. If the
> checked-in `.env.example` ever drifts from the content below (e.g. it must
> never contain `CONVEX_SITE_URL=http://localhost:5173` — that value is a Convex
> system variable, not the Vite dev URL), replace the file's contents with this:

```bash
# -----------------------------------------------------------------
# FRONTEND (Vite) variables — the only values that belong in a
# frontend .env file. Everything else lives in the Convex deployment
# environment or is provided automatically by Convex (see README).
# -----------------------------------------------------------------

# Convex deployment URL the browser talks to. Must be the SAME
# deployment that hosts the auth tables, backend functions and seed
# data. Get it from `bunx convex dev` output or the platform preview.
VITE_CONVEX_URL=

# NOTE: Do NOT put CONVEX_SITE_URL or CONVEX_DEPLOYMENT here.
# CONVEX_SITE_URL is a Convex-PROVIDED system variable (the
# deployment's *.convex.site HTTP-actions domain used as the auth/OIDC
# issuer in convex/auth.config.ts) — it is never the Vite dev-server
# URL and must never be set to http://localhost:5173.
# CONVEX_DEPLOYMENT is managed by the Convex CLI, not by you.
#
# Server-side values (PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD,
# SEED_SECRET, JWT_PRIVATE_KEY, JWKS, VLY_EMAIL_OTP_API_KEY, SITE_URL)
# are configured in the Convex deployment environment via the platform
# secret manager — never in this file and never committed.
#
# Local development: copy this file to .env (git-ignored) and fill in
# VITE_CONVEX_URL with your local dev deployment URL.
#
# Deployment used by `npx convex dev` (managed by the CLI):
CONVEX_DEPLOYMENT=
```

### Database setup & migrations

Convex stores its schema in code: `src/convex/schema.ts` **is** the migration.
A fresh clone reproduces the full database with:

```bash
# 1) Push schema + functions (creates tables & indexes)
bunx convex dev --once

# 2) Choose your own strong seed secret and configure it on the deployment
#    (there is NO repository default — the seed refuses to run without it)
bunx convex env set SEED_SECRET "<your-own-strong-random-value>"

# 3) Run the idempotent seed / repair
bunx convex run seed:seedAll '{"secret":"<your-own-strong-random-value>"}'
```

The seed is idempotent — it skips if schools already exist, but **always**
re-ensures the bootstrap super admin and self-heals every documented demo account
(role membership attached to the exact user row the password account resolves to,
active status restored) before skipping. Changing the schema and pushing again
migrates the deployment (with schema validation on indexes).

### Production build

```bash
bun run build
```

## Demo accounts

Created by the seed. Passwords are clearly non-production.

| Role            | Email                          | Password          |
| --------------- | ------------------------------ | ----------------- |
| Super Admin     | `admin@schoolcore.dev`         | `ChangeMe!2026`   |
| School Admin    | `admin@greenfield.ac.ke`       | `Greenfield#2026` |
| Principal       | `principal@greenfield.ac.ke`   | `Greenfield#2026` |
| Accountant      | `accounts@greenfield.ac.ke`    | `Greenfield#2026` |
| Teacher         | `grace.wanjiku@greenfield.ac.ke` | `Greenfield#2026` |
| School Admin 2  | `admin@riverside.ac.ke`        | `Riverside#2026`  |

## Role descriptions

| Role          | Scope                                                             |
| ------------- | ----------------------------------------------------------------- |
| Super Admin   | Platform-wide: schools CRUD, platform users, cross-school audit   |
| School Admin  | Full control inside one school (users, settings, all modules)     |
| Principal     | People + academics management; no user administration             |
| Teacher       | Read access to students, guardians and academic structure         |
| Accountant    | Read access, prepared for the Finance module                      |
| Parent        | Architecture-ready; portal arrives in a later phase               |
| Student       | Architecture-ready; portal arrives in a later phase               |

Permission keys (e.g. `students.create`, `teacher_allocations.manage`) are defined in
`src/convex/schema.ts` and enforced by `requirePermission` on every backend function.
The Roles page in the app renders the full matrix.

## Multi-school isolation

1. Every school-scoped table has `schoolId` plus an index on it.
2. Each request resolves a `Session` from the auth token → memberships → role.
3. List queries filter with `withIndex("by_school", …)` — another school's rows are
   never fetched.
4. ID-based access funnels through `getSchoolRecord(ctx, schoolId, table, id)`, which
   throws unless the record's `schoolId` matches the caller's. Forged IDs fail.
5. Cross-school references (allocations, enrollments, guardian links) validate every
   referenced record belongs to the caller's school.
6. Only the super admin can act across schools — via dedicated platform functions.

Seeded isolation test: **Riverside School** exists alongside Greenfield with its own
admin; signing in as either only ever returns that school's data.

## Seeded demo data

- 2 schools (Greenfield Academy + Riverside School for isolation testing)
- 80 students with guardians (sibling groups share guardians), 11 staff, 8 subjects
- 2026 academic year, 3 terms, 6 grade levels, 6 class sections
- Teacher allocations across classes and subjects
- Fee structures per term/grade (tuition, transport, meals, activity), invoices
  for every active student (some fully paid, partially paid, unpaid, discounted),
  payments with sequential `REC-` receipts, discounts/scholarships, and approved
  expense records — all posted through the double-entry ledger per school
- Audit entries for the seed actions

## Testing

Two suites live in `scripts/`. Both require the deployment's configured
`SEED_SECRET` (they run the idempotent seed/repair first) and only create
`SMOKE-`/`smoke-`/`e2e-`-prefixed test records, which are archived or deactivated
at the end — seeded demo data is never modified or destroyed.

**Smoke test** (`scripts/smoke.ts`) — auth, RBAC, tenant isolation and CRUD:

```bash
SMOKE_CONVEX_URL=https://<deployment>.convex.cloud SEED_SECRET=<secret> bun scripts/smoke.ts
```

Covers: valid demo authentication (all roles), invalid-password rejection,
unknown-user rejection, disabled-user rejection, super-admin platform access,
school-admin school access, teacher RBAC restrictions, Greenfield/Riverside
tenant isolation, forged cross-school record-ID rejection, student
create/update/archive, duplicate admission-number rejection, guardian creation
and linking, academic-year enrollment history, staff creation, duplicate teacher
allocation rejection, and the admin-created-user lifecycle (authenticate →
resolve membership → deactivate).

**End-to-end auth suite** (`scripts/e2e-auth.mjs`) — deeper auth-lifecycle
checks (session refresh persistence, logout refresh-token invalidation, canonical
membership mapping per account, cross-module tenant isolation, RBAC denials,
platform/school user provisioning):

```bash
SEED_SECRET=<secret> bun scripts/e2e-auth.mjs https://<deployment>.convex.cloud
```

**Repair/membership audit** (`scripts/prod-repair.mjs`, `scripts/user-map.mjs`)
— idempotent self-heal of demo-account memberships and a canonical user map per
account:

```bash
SEED_SECRET=<secret> bun scripts/prod-repair.mjs https://<deployment>.convex.cloud
SEED_SECRET=<secret> bun scripts/user-map.mjs https://<deployment>.convex.cloud
```

**Phase 2 academic suite** (`scripts/phase2.test.ts`) — attendance (daily +
lesson), timetable conflicts, assignments, assessments, mark entry, grading
boundaries, weighted results, ranking, result approval/publication, report-card
snapshots, teacher authorization, cross-school isolation:

```bash
SMOKE_CONVEX_URL=https://<deployment>.convex.cloud SEED_SECRET=<secret> bun test scripts/phase2.test.ts
```

**Phase 3 finance suite** (`scripts/phase3.test.ts`) — fee structures, billing,
invoices, payments + receipts, duplicate-reference rejection, discounts,
refunds, expenses (creator ≠ approver RBAC), ledger balance, statements,
report/dashboard reconciliation, historical integrity, tenant isolation:

```bash
SMOKE_CONVEX_URL=https://<deployment>.convex.cloud SEED_SECRET=<secret> bun test scripts/phase3.test.ts
```

## Security notes

- A previously committed `.env.keys` (containing a `DOTENV_PRIVATE_KEY_LOCAL`)
  has been **untracked and deleted from the working tree**, and `.gitignore` now
  excludes `.env*` (except `.env.example`) plus all private-key file types.
  Because the key was public, it must be treated as compromised: **rotate it**
  (`npx dotenvx rotate` or regenerate in the dotenvx dashboard) and rotate any
  secret it could decrypt. If the repository is mirrored on GitHub, also purge
  the blob from history (`git filter-repo` / BFG) — removing it from `HEAD` alone
  does not make the old key safe.
- A hardcoded email-OTP API key in `src/convex/auth/emailOtp.ts` was replaced
  with `process.env.VLY_EMAIL_OTP_API_KEY` (set via the platform Keys UI). The
  previously committed value should be **rotated** as well, since it was public
  in history. SchoolCore's admin-only sign-in does not use email OTP.
- Sign-in uses a custom sign-in-only credentials provider: there is **no public
  sign-up flow** at any layer (the stock Password provider's `signUp` flow is
  disabled), and disabled users are rejected during token issuance.
- Secrets live only in the platform secret manager / deployment environment;
  `JWT_PRIVATE_KEY`/`JWKS` are platform-provisioned and never appear in source.

## Phase 1 feature checklist

Multi-school structure · Super admin · School creation · Authentication · RBAC ·
Tenant isolation · User management · Students · Guardians (many-to-many) · Staff ·
Academic years · Terms · Grade levels · Classes/streams · Subjects · Enrollments ·
Teacher allocations · School settings · Live dashboard · Global search (⌘K) ·
Audit logs · Responsive UI · Seed data · Demo accounts · Tests · README

## Phase 2 feature checklist

Daily + lesson attendance · Timetables (class/teacher/whole-school views from one
dataset, collision detection) · Assignments · Assessments · Mark entry · Grading
schemes · Weighted results · Ranking · Result review/approval/publication ·
Report cards (single + bulk class PDF) · Academic analytics

## Phase 3 feature checklist

Fee structures · Bulk billing · Invoices (draft → issued → partially paid →
paid / overdue, cancellation with audit trail) · Student financial accounts ·
Double-entry ledger · Payments (duplicate-reference rejection, reversal) ·
Sequential receipts (`REC-YYYY-#####`) with PDF · Discounts (request → approve →
apply) · Scholarships/bursaries · Refunds (request → approve → ledger) ·
Expenses with approval workflow (creator ≠ approver) · Chart-of-accounts
foundation · Revenue/payments/outstanding/expense/cash reports · Trial balance ·
Account statements with PDF · Finance dashboard · Parent-portal-ready data model

## Intentionally deferred (future phases)

HR, payroll, library, transport, boarding, inventory, procurement, clinic,
communications (M-Pesa/SMS/email), parent/student/teacher portals, payment
gateway integrations, advanced analytics. The Phase 1–3 models (student ID +
school ID everywhere, enrollment by year, allocations per year/term, ledgered
student accounts) are shaped so these modules attach without rework.
