# Convex Cloud → Self-Hosted Migration Plan

> **Status:** PREPARATION. This plan has not been executed. The current Convex
> Cloud deployment continues to serve production until the cutover decision
> (**OWNER DECISION REQUIRED**). No production data has been or will be
> migrated by this preparation work.

---

## 1. Objective and scope

Migrate SchoolCore's Convex deployment from Convex Cloud (managed by the
Freebuff platform) to a **self-hosted Convex backend** on the Owner's
infrastructure, preserving:

- **IDs** — document `_id`s are stable Convex IDs; export/import must not
  re-generate them.
- **Relationships** — every cross-table `Id<T>` reference must resolve after
  import.
- **`schoolId` isolation** — 121/125 tables are school-scoped; any data
  transformation must not break tenancy.
- **Users, permissions** — `users`, `schoolMemberships`, `roles`, `permissions`
  and role-assignment tables migrate verbatim.
- **Audit logs** — `auditLogs` (by_school/by_user indexed) migrate verbatim;
  they are the compliance record.
- **Storage references** — `files` rows reference Convex `storageId`s; the
  self-hosted backend includes file storage, so references remain valid when
  the whole deployment is migrated as a unit.

---

## 2. Approach

### 2.1 Tooling

| Tool | Role |
| --- | --- |
| `npx convex export` (CLI, run against the **source** Cloud deployment) | Produces a snapshot of documents + file contents |
| `npx convex import` (CLI, run against the **target** self-hosted backend) | Restores the snapshot |
| `scripts/migration/` helpers (this repo) | Wrap the CLI, validate the result, drive rollback |
| Verification suites in `scripts/` | Functional parity gates |

### 2.2 Why whole-deployment migration (not per-table)

- Convex IDs are only meaningful within a deployment's ID space. Selective
  table imports would break every cross-reference; the only safe unit is the
  **entire deployment**.
- The 4 platform-scoped tables (`users`, `schools`, `plans`,
  `schoolRequestDocuments`) have no `schoolId` — per-school splitting is not
  a supported operation today.
- Whole-unit migration preserves ID/relationship/storage invariants by
  construction.

### 2.3 Staging-first

Every rehearsal and the final cutover follow the same pipeline:

```
[Convex Cloud]                    [staging self-host]            [prod self-host]
  convex export ──► migration archive ──► convex import ──► validate ──► (promote)
```

Cutover to production only happens after at least one **successful staging
rehearsal** (Phase 5 of SELF_HOSTING_GUIDE §3).

---

## 3. Schema migration strategy

1. **Schema source of truth is the repo**: `src/convex/schema.ts` (106 tables)
   + `schemaPhase7.ts` (19 tables). No schema is managed outside the repo.
2. **Target backend starts empty** — schema is created by pushing functions:
   `bunx convex push` against the self-hosted deployment (CLI supports
   self-hosted via `--deployment-url`/env). This creates all 125 tables +
   315 indexes exactly as declared.
3. **Schema push happens BEFORE data import** (import needs the tables to
   exist with the same validators).
4. **Schema drift rule:** between the export and the import, the source
   deployment's schema must not change. Cutover plan (§6) includes a
   write-freeze on the source before the final export.
5. **If schema changed between rehearsal and cutover:** re-export + re-import
   into a fresh target. Imports are always into an **empty** backend — never
   incremental — so schema drift cannot corrupt existing rows.
6. Schema history is in git; each migration run records the schema version
   (git SHA) in the migration manifest (README-migration §2).

---

## 4. Data migration strategy

### 4.1 What is migrated

Everything in the deployment snapshot: all 125 tables' documents, file
storage contents, and (via the CLI) the auth tables backing Convex Auth
sessions. Specific invariants to verify (§5):

- `users` rows (platform-scoped) — preserved with original `_id`s so
  `schoolMemberships.userId`, `auditLogs.userId` etc. resolve.
- `schoolMemberships` + `roles`/permission tables — the permission model is
  data-driven from these tables; verbatim copy keeps authz behaviour intact.
- `auditLogs` — copied with original IDs; retention/TTL is a separate
  post-migration task (audit rec, not migration).
- `files` table + storage contents — imported together so `storageId`
  references resolve.
- Demo/seed records (if present on the source) migrate like any other data;
  they are never selectively stripped during migration.

### 4.2 Export procedure (source = Convex Cloud)

Run from a workstation with repo + auth:

```bash
# 1. Freeze (cutover only): stop writes on the source deployment.
#    (Manual: disable sign-in surface or announce freeze — freeze procedure
#    is finalised in the cutover runbook, §6.)

# 2. Export snapshot (includes documents + file storage).
bunx convex export --path migration/snapshot-$(date +%Y%m%d-%H%M%S).zip
#    Note: the CLI uses the deployment from convex.json / CONVEX_DEPLOYMENT;
#    for the production deployment, point the CLI at it explicitly.

# 3. Record manifest (script: scripts/migration/export.mjs wraps 2+3).
bun scripts/migration/export.mjs <source-url> --out migration/
```

### 4.3 Import procedure (target = self-hosted backend)

```bash
# 1. Ensure target backend is running and schema pushed (§3).
# 2. Import into the EMPTY target.
bunx convex import --deployment-url <self-host-url> migration/<archive>.zip
#    (Wrapped by: bun scripts/migration/import.mjs <archive> <target-url>)

# 3. Validate (§5).
bun scripts/migration/validate.mjs <target-url>
```

### 4.4 What is NOT migrated by this tooling

- **Convex Cloud-side configuration** (deployment name, cloud dashboards).
- **Environment variables/secrets** — re-created on the server per
  SECRET_MANAGEMENT_GUIDE (values never transit the migration archive).
- **VLY integrations** — replaced per SELF_HOSTING_GUIDE §1/EMAIL_RESEND.
- **Freebuff-specific auth gateway** (`emailOtp.ts`'s VLY OTP sender) —
  replaced by Resend before cutover (EMAIL_RESEND_MIGRATION).

---

## 5. Verification process

### 5.1 Structural validation (`scripts/migration/validate.mjs`)

Run against the target after import. Checks:

1. **Table presence** — all 125 tables non-empty count-queryable (a count of
   0 on a table that had rows in the manifest is a failure).
2. **Row-count parity** — per-table counts equal manifest counts (± documented
   delta for tables legitimately written between export and import — should
   be zero under cutover freeze).
3. **ID preservation** — for a deterministic sample per table, exported `_id`
   exists in target (spot-check via get-by-id query).
4. **Relationship integrity** — referential probes: for a sample of
   `students` → `schoolMemberships` → `users`, `invoices` → `students`,
   `enrollments` → `classSections`, every referenced `_id` resolves.
5. **Tenancy isolation** — every document in every school-scoped table has
   non-empty `schoolId`; sample cross-checks that `students.schoolId` matches
   `schoolMemberships.schoolId` for the same student.
6. **Audit-log completeness** — `auditLogs` count matches manifest; sample
   entries get-by-id resolve.
7. **Storage references** — every `files` row's `storageId` resolves (metadata
   get succeeds); sample file URLs return 200 via the backend URL.
8. **Users & permissions** — user count parity; `roles` and membership counts
   parity; a seeded smoke login is possible only if a test account is
   provisioned post-import (never export passwords).

### 5.2 Functional validation (existing suites)

Run against the target deployment URL, from a workstation (never on-box):

```bash
# URL-parameterised suites (never echo the URL in logs):
bun scripts/_verify.mjs <url>   # temp wrapper spawning security-audit.mjs etc.
bun test scripts/engines.test.ts  # with SMOKE_CONVEX_URL injected
```

| Suite | Gate |
| --- | --- |
| security-audit.mjs (71 checks) | all pass |
| phase7-verify.mjs (111) | all pass |
| phase2.test.ts (72), phase3.test.ts (51) | all pass |
| engines.test.ts (23) | all pass |
| smoke.ts | Runs only with SEED_SECRET — **not run** against self-host (see gap note, README-migration §7) |

### 5.3 Acceptance

Migration is accepted only when: structural validation is fully green,
all functional suites pass, a smoke login + representative workflows
(attendance mark, invoice create, results view) succeed on the target, and
the Owner signs off (**OWNER DECISION REQUIRED**).

---

## 6. Cutover plan

### 6.1 Pre-conditions (all required)

- [ ] Staging rehearsal completed successfully (Phase 5) with the same
      pipeline as production.
- [ ] All verification gates green on staging.
- [ ] Resend email migration implemented + verified on staging
      (EMAIL_RESEND_MIGRATION §5).
- [ ] Self-hosted environment secrets complete (SECRET_MANAGEMENT_GUIDE §4).
- [ ] Backups configured and tested (SERVER_DEPLOYMENT_GUIDE §5).
- [ ] Freeze window agreed and communicated (**OWNER DECISION REQUIRED**).

### 6.2 Freeze window (target: ≤ 60 min)

| Step | Action | Time |
| --- | --- | --- |
| 1 | Announce freeze; disable sign-in on source (maintenance mode surface is not built — manual freeze via access suspension) | T+0 |
| 2 | Final export from source → archive | T+5 |
| 3 | Import into target; structural validation | T+15 |
| 4 | Functional suites against target | T+30 |
| 5 | Switch DNS / reverse proxy to target (SERVER_DEPLOYMENT_GUIDE §4) | T+40 |
| 6 | Post-cutover smoke: sign-in, attendance, invoice, announcement | T+45 |
| 7 | Unfreeze announcement; monitor | T+60 |

### 6.3 Cutover rollback

If any gate fails **before step 5 (DNS switch)**: abort; source Cloud
deployment is untouched and still live. Re-attempt later.

If a problem is found **after** the DNS switch:

1. **Roll forward preferred:** fix-forward on self-host if the issue is
   code-level and small.
2. **Roll back to Cloud:** re-point DNS to the Cloud deployment. Data written
   to self-host during the window (if any) is reconciled manually or
   sacrificed by re-freezing and re-exporting from Cloud (last-known-good
   Cloud data) — this is an **OWNER DECISION** at incident time.
3. Convex Cloud deployment is kept **read-only operational** (not deleted)
   for the agreed grace period (recommend 2 weeks) as the ultimate fallback.

### 6.4 Post-cutover

- [ ] Decommission plan for Cloud deployment after grace period (Phase 7)
- [ ] Remove Freebuff-specific code paths (vly-toolbar, VLY integrations,
      OTP gateway stubs) once nothing references them
- [ ] Review `docs/production-deployment.md` for Cloud-era assumptions

---

## 7. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Self-hosted Convex backend parity gaps with Cloud (version skew) | Low | High | Pin the backend image to the Cloud-matching version; run all suites pre-cutover |
| Large `auditLogs` export size | Medium | Low | Export includes all data; size the archive window; test export duration in rehearsal |
| ID/reference breakage from partial import | Low (whole-unit approach) | Critical | Whole-deployment unit; structural validator (§5.1) fails loudly |
| Schema drift between export & import | Low | High | Freeze window (§6.2); re-run from empty target if drift detected |
| Secrets leaking via migration artifacts | Low | Critical | Archive contains **data only**; secrets re-created server-side; archive stored encrypted at rest; never committed |
| Freeze window overrun | Medium | Medium | Rehearsal timings measured in Phase 5 before scheduling the real window |
| Email disruption at cutover | Medium | Medium | Resend migration landed + verified BEFORE cutover (Phase 4 before Phase 6) |
| Missed M-Pesa callbacks during freeze | Medium | Medium | Reconcile callbacks received during freeze window post-cutover; M-Pesa retries STK/result queries |

---

## 8. Open items before execution

1. Confirm the self-hosted backend version to target and validate
   `convex export`/`import` compatibility with it (Convex CLI version pin in
   devDependencies).
2. Finalise the source-deployment freeze mechanism (no maintenance-mode
   surface exists today — candidates: access suspension via platform admin,
   or schedule out-of-hours window).
3. Confirm backup restore procedure end-to-end on staging (SERVER_DEPLOYMENT
   GUIDE §5 test).
4. Decide VLY AI feature disposition (ship / disable / replace) — currently
   only OTP email has a committed replacement plan (Resend).
