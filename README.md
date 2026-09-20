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

Copy `.env.example`-style values into your platform secret manager (the Keys/API
Keys UI in this environment). Never commit real secrets.

| Variable                  | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `VITE_CONVEX_URL`         | Convex deployment URL used by the browser              |
| `PLATFORM_ADMIN_EMAIL`    | Bootstrap super admin email (default `admin@schoolcore.dev`) |
| `PLATFORM_ADMIN_NAME`     | Bootstrap super admin name                             |
| `PLATFORM_ADMIN_PASSWORD` | Bootstrap super admin password (dev default `ChangeMe!2026`) |
| `SEED_SECRET`             | Guard for the seed action (`schoolcore-dev-seed`)      |

### Database setup & migrations

Convex stores its schema in code: `src/convex/schema.ts` **is** the migration.
A fresh clone reproduces the full database with:

```bash
bunx convex dev --once          # push schema + functions (creates tables & indexes)
bunx convex run seed:seedAll '{"secret":"schoolcore-dev-seed"}'
```

The seed is idempotent — it skips if schools already exist. Changing the schema and
pushing again migrates the deployment (with schema validation on indexes).

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
- Audit entries for the seed actions

## Testing

A backend smoke-test script covers authentication, RBAC and tenant isolation against
the live deployment. Run it after seeding:

```bash
bunx convex run seed:seedAll '{"secret":"schoolcore-dev-seed"}'
bun run scripts/smoke.ts
```

The script verifies:

- **Auth:** valid login succeeds; invalid password fails; disabled users rejected.
- **RBAC:** teacher cannot call admin functions; school admin cannot act platform-wide.
- **Tenant isolation:** Greenfield's admin cannot read Riverside's students/guardians;
  forged cross-school IDs are rejected.
- **CRUD:** student create/update/archive, duplicate admission numbers rejected,
  guardian linking shared across siblings, enrollment history, staff creation,
  allocation uniqueness, academic structure creation.

## Phase 1 feature checklist

Multi-school structure · Super admin · School creation · Authentication · RBAC ·
Tenant isolation · User management · Students · Guardians (many-to-many) · Staff ·
Academic years · Terms · Grade levels · Classes/streams · Subjects · Enrollments ·
Teacher allocations · School settings · Live dashboard · Global search (⌘K) ·
Audit logs · Responsive UI · Seed data · Demo accounts · Tests · README

## Intentionally deferred (future phases)

Attendance, timetables, assignments, exams, report cards, fees, payments, payroll,
library, transport, boarding, inventory, procurement, clinic, communications
(M-Pesa/SMS/email), parent/student/teacher portals, analytics. The Phase 1 models
(student ID + school ID everywhere, enrollment by year, allocations per year/term)
are shaped so these modules attach without rework.
