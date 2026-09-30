# Phase 8 — Production Hardening and Pilot Readiness

Roadmap for the work that remains before SchoolCore can be accepted for
production use.

For present state see `SCHOOLCORE_CURRENT_STATE.md`. For why any item exists,
see the document named against it.

No dates are assigned. Each gate states its own prerequisites and acceptance
criteria; proceed when the prerequisites are met, not when the calendar says so.

---

## Purpose

The migration is complete and the system is live, but the system was not
*accepted* — it was cut over and then hardened. Phase 8 exists to close the
security, operational and readiness gaps that were identified after production
went live, and to end with an explicit, evidence-backed pilot readiness
decision.

Phase 8 is **open**. 8.2, 8.4 and 8.6 are complete; the two open pilot
blockers and gates 3–10 remain.

---

## Completed

### 8.2 — Release Workflow — COMPLETE
Documented production release discipline: `selfhost-production` as the
production branch, five mandatory CI gates, mandatory verified pre-deploy
backup, SHA-pinned deploy, health and authorization smoke requirements,
acceptance criteria, and code-vs-data rollback paths. Includes the generated
Convex file policy — `src/convex/_generated/` is committed intentionally
because CI does not run the Convex CLI and 168 tracked files import it.

Evidence: `PRODUCTION_RELEASE_WORKFLOW.md`.

### 8.4 — Monitoring and Alerting — COMPLETE
Architecture documented and the implementation tested to the point where three
critical defects were found and fixed:

1. The alert state parser truncated `STATUS=DEGRADED (warn=1)` to
   `DEGRADED (warn`, which matched no `case` arm, and the `case` had no
   default — so DEGRADED and CRITICAL **never alerted at all**.
2. Alert bodies were not JSON-escaped, so every send returned HTTP 400.
3. The off-site backup freshness check read the **oldest** snapshot in the
   repository instead of the newest, so it reported CRITICAL continuously while
   backups were succeeding.

All three verified fixed, including a real `HEALTHY → DEGRADED` alert delivery
and proof the 36-hour staleness threshold still fires.

Evidence: `MONITORING_AND_ALERTING.md`.

### 8.6 — Security Review — COMPLETE
Full security review: authorization model, dependency audit with production and
development reachability separated, Docker healthcheck review, SSH hardening
review. Findings fixed where reachable: the student horizontal access defect,
PB-2, and the production-reachable `hono` advisories. Accepted risks documented
with rationale.

Evidence: `PRODUCTION_SECURITY_REVIEW.md`.

### PB-2 remediation — CLOSED
`staff:get` now requires `staff.view`, matching `staff:list`, `staff:stats` and
`staff:departments`. Super-admin null-`schoolId` behaviour deliberately preserved
as secure denial. Deployed `d9ba8b7`; regression suite 36 pass / 2 fail before
the fix and 38 pass / 0 fail after; extended matrix 113 pass / 0 fail / 0 retest.
Evidence: `PRODUCTION_SECURITY_REVIEW.md` §4.1.1.

### PB-1 remediation — CLOSED
`@convex-dev/auth` upgraded to `0.0.95` with `@auth/core@0.41.3` pinned, removing
the only CRITICAL advisory in the dependency tree. Reachability proven against
the installed tree rather than inferred, and a previous incorrect claim — that
no Auth.js Email provider is registered — corrected. Deployed `d58f971`; CI run
#14 success; authentication re-validated through real sign-in at 42/42 both
before and after the change, authorization matrix 113/113. Evidence:
`PRODUCTION_SECURITY_REVIEW.md` §4.2.1.

---

## Remaining Sequence

Gates 1 and 2 close the open pilot blockers. Gate 3 onward is hardening in
roughly increasing order of blast radius on the running system.

Gates are **sequential**. Gate N's prerequisites are Gate N-1's acceptance.

---

### Gate 1 — Authentication Hardening — **COMPLETE**

**PB-1: `@auth/core` upgrade and validation — CLOSED**

`@auth/core@0.37.4` carried a CRITICAL advisory (email normalizer homoglyph
`@` bypass), a HIGH (`getToken()` uncaught exception on malformed `Bearer`
headers) and a MODERATE (OAuth cookie binding). The fix was not a patch: it
required moving `@convex-dev/auth` 0.0.90 to 0.0.95, which moves the peer
requirement to `^0.41.1`, and realigning `@auth/core` to `>=0.41.3`.

**Objective.** Remove the CRITICAL advisory from the authentication path, or
record with evidence why it can be deferred. **Achieved** — removed, and the
reachability question answered with proof rather than assessment.

**Acceptance criteria — all met.**

- [x] `@auth/core` resolves to `>=0.41.3` (`0.41.3`), with `@convex-dev/auth` at `0.0.95`
- [x] `bun audit` no longer reports the CRITICAL or HIGH `@auth/core` advisories
- [x] CI green: install, typecheck, unit tests, lint, build (run #14 success)
- [x] Deployed to a verified SHA (`d58f971`, clean tree, no generated-file drift)
- [x] Authentication smoke tests pass: sign-in, token issuance, verification on a fresh connection, tampered-token rejection
- [x] Role sign-in validation for every role in the data set: school admin, teacher, parent, student, plus a cross-tenant Riverside student
- [x] Role resolution and school membership correct for each
- [x] Authorization regression suite 38/38 and full matrix 113/113, 0 FAIL, 0 RETEST
- [x] Production health checks pass after deploy

**Two findings worth carrying forward.** First, the reachability claim in the
original assessment was partly wrong — the Auth.js Email provider adapter *is*
imported and registered — and the corrected proof is recorded in
`PRODUCTION_SECURITY_REVIEW.md` §4.2.1. Second, the first `convex deploy`
reported success while bundling the **old** library, because the server's
gitignored `node_modules` was not re-installed after the checkout. Deployment
should compare declared against installed dependency versions rather than
trusting the deploy exit code.

---

### PB-3 remediation — CLOSED
`react-router` upgraded from 7.18.1 to 7.18.4, clearing GHSA-qwww-vcr4-c8h2,
with the declared floor tightened to `^7.18.4` so it cannot regress below the
fix. The build path was established first: the definition is tracked as
`Dockerfile.frontend`, correcting the earlier claim that it was absent, and the
image was rebuilt from the committed source and deployed through Docker
Compose. Reachability proven from the build configuration — no RSC, no SSR, no
server actions, `@react-router/dev` not installed, nginx serving static files.
Deployed `8f4b84f`; CI run #16 success; asset inventory identical at 124;
authorization matrix 113/113; authentication 42/42. Evidence:
`PRODUCTION_SECURITY_REVIEW.md` §4.3.1.

### Gate 2 — Frontend Dependency Hardening — **COMPLETE**

**PB-3: `react-router` advisory — CLOSED**

`react-router@7.18.1` was affected by a HIGH advisory (RSC-mode CSRF bypass).
The blocker was a prerequisite gap: the build definition had been recorded as
absent from the repository. It was not — `Dockerfile.frontend` is tracked, and
the running image's history matches it layer for layer.

**Acceptance criteria — all met.**

- [x] Frontend image build definition located and confirmed tracked
- [x] `react-router` resolves to `>=7.18.2` (`7.18.4`); the HIGH advisory is gone
- [x] No major version taken (`8.4.0` available, not used)
- [x] CI green: install, typecheck, unit tests, lint, build (run #16 success)
- [x] Image rebuilt from the committed source and validated in isolation before going live
- [x] Deployed through the real path (Docker Compose), security posture preserved
- [x] Frontend loads; auth pages, protected routes and navigation all serve — 200 on every SPA route, no blank pages, no broken redirects
- [x] Asset inventory identical at 124 — no route or page added or removed
- [x] Authorization matrix 113/113 and authentication 42/42 — PB-1 and PB-2 remain closed
- [x] Production health checks pass after deploy

**Two findings worth carrying forward.** The earlier "build definition not in
the repository" claim was wrong and is corrected in
`PRODUCTION_SECURITY_REVIEW.md` §4.3.1. And the frontend deploys through
Docker Compose from a **host-managed** compose file, not `docker run` — the
release workflow did not previously describe that path.

---

### Gate 3 — Disaster Recovery — **COMPLETE**

**8.5**

Two rehearsals on 2026-09-30. The first found a blocker; the second proved the
fix.

**First rehearsal — blocker found.** A database-only restore from a real
off-site snapshot produced a deployment that started, answered `/version`,
reported healthy, and then failed **every function call** with
`Local dir storage couldn't open …/modules/<uuid>.blob`. The Convex backend
keeps compiled function modules on a Docker volume that the backup did not
capture, and the database holds only references to it. Every surface health
check passed while the application was non-functional.

**Fix.** `backup.sh` now copies `convex-data:/storage` into the backup after
`pg_dump` — later, so the capture is a superset of what the dump can reference —
excluding `credentials/` (instance secret), and **fails the backup** if the
capture is empty. The blobs inherit the same SHA256 manifest and the same restic
encryption.

**Second rehearsal — from the new backup only.** Snapshot `aad51574`, restored
with no access to the live volume.

| Acceptance criterion | Result |
|---|---|
| A real off-site snapshot retrieved | yes, `aad51574`, 13.1 MB |
| Restored in an isolated environment | yes, separate network and volumes |
| PostgreSQL starts | yes, 3 s, 8,227 documents |
| Convex backend starts | yes, 3 s |
| **No missing module/storage errors** | **0** |
| Application functions execute | yes — `schools:listSchools`, `team:me` |
| Representative data integrity | schools 8/8 · users 25/25 · students 91/91 · staff 21/21 · guardians 71/71 · memberships 23/23 · authAccounts 22/22 — **all match live** |
| Authentication validated | **42 pass / 0 fail** |
| Authorization checks | **8/8 as expected**, including PB-1 and PB-2 closures |
| Security posture intact | 0 published ports, isolated network, no credentials in the backup |
| Recovery timing recorded | **7 s** to serving, ~47 s from cold |
| Documentation corrected | `BACKUP_AND_RESTORE.md` §2, §9.1–9.5 |
| No production impact | SHA `8f4b84f` clean, all services up, 14 snapshots before and after, `restic check` clean |

**One further finding.** The restored env store carries the production
`CONVEX_SITE_URL`, so a recovered backend started on a different site origin
mints tokens the auth provider will not accept (`NoAuthProvider`). Free on a
real recovery, but a sharp edge in rehearsals. Documented in §9.3.

**Gate 3 is complete.** Two recovery inputs remain outside the backup and are
documented as such: the Restic password with the rclone OAuth config, and
`/opt/schoolcore/deploy/.env`. Both are custody questions, not software defects.

---

### Gate 4 — Database Review — **COMPLETE**

**8.7**

Audited the production database read-only. **No changes were made, because the
evidence did not support any.**

| Acceptance criterion | Result |
|---|---|
| Baseline recorded | PostgreSQL 17.11, 21 MB, 6,916 live document rows, 3,924 current entities, 1 connection in use |
| Schema reviewed | 105 tables, 271 Convex index definitions, 0 tables unindexed, 0 duplicates |
| Query patterns reviewed | 838 unbounded `.collect()` sites assessed; all either school-scoped or on small dimension tables; no missing pagination on a growing surface |
| Index usage assessed | `documents` 99.6% index-served (145,432 idx_scan vs 543 seq_scan); no bloat; autovacuum healthy |
| Required optimizations | **none** |
| Safe changes applied | none justified — a twelve-table schema declaration (hygiene) would require a deployment-wide migration for no measured benefit |
| No unsupported optimizations introduced | yes — no index added speculatively |
| Documentation updated | `docs/DATABASE_REVIEW.md` |
| Production stability confirmed | read-only pass; deployed SHA `8f4b84f` unchanged, all services healthy |

**Key architectural finding:** PostgreSQL holds Convex's storage engine, not the
application data model. The application never queries those tables, and the eight
physical B-trees are Convex's own. The application's query index is the schema's
Convex index definitions, so the audit was against those and **no PostgreSQL DDL
is appropriate**.

**Two items carried forward, neither a pilot blocker:**
- **R1 (hygiene).** Twelve tables are queried with `withIndex()` but are absent
  from `schema.ts`. Verified working on the live deployment — Convex resolves
  their indexes implicitly. The cost is that those documents are unvalidated and
  their indexes are invisible to a future schema regeneration. Schedule with the
  next schema-change window.
- **R2 (measurement).** `attendanceRecords` is the only compounding table
  (105 rows for 86 students) and the primary load area for 8.8.

Evidence: `docs/DATABASE_REVIEW.md`.

---

### Gate 5 — Performance Baseline — **COMPLETE**

**8.8**

Measured in two layers — origin execution (inside `schoolcore-net`, excluding
network) and public end-to-end (through the real Cloudflare Tunnel) — using
sequential, read-only synthetic requests. No load test: generating synthetic
load against a live production system holding real school data is an asymmetric
risk against information the current numbers already bound.

| Acceptance criterion | Result |
|---|---|
| Production baseline captured | PostgreSQL 17.11, 21 MB, 6,916 live rows, 3,924 entities, 1 connection |
| Resource baseline captured | 4 cores, load 0.21, 12.3 GB RAM free, 1% disk; backend 359 MiB, postgres 39 MiB |
| Important workflows measured | 20 endpoints: sign-in, session, admin/teacher/parent/student portals, lists, single records, academic, finance |
| Performance risks identified | 9 findings, **none blocking** |
| 8.7 database findings incorporated | all six, §9 of the baseline document |
| No unsupported optimization introduced | **none applied** — nothing measured was slow enough to justify a change |
| Documentation created | `docs/PERFORMANCE_BASELINE.md` |
| Production stability confirmed | read-only pass; SHA `8f4b84f`, all services healthy, fixtures re-disabled |

**Headline result.** Origin execution is **p50 3.1 ms, p95 4.4 ms** across every
workflow, with a flat distribution — portal, list, record and three-hop
relationship traversals all land within 1 ms of each other, which is the
expected consequence of 8.7's index coverage.

**The finding that reframes performance work:** public end-to-end is **~780 ms
p50**, of which **~178 ms is TLS establishment through the tunnel** and only
~3 ms is SchoolCore. **Roughly 99.6% of user-visible latency is outside the
application's control.** Optimizing a 3 ms query would move the user experience
by 0.1%.

Also recorded: `auth:signIn` at ~238 ms is the deliberate `Scrypt` cost and must
**not** be reduced; and an ~880 ms isolate cold start occurs on roughly 1 call
in 20 after idle — runtime behaviour, not application code.

**Two earlier measurement attempts were discarded as invalid** and this is
recorded in the document: the generated `anyApi` object produced
`BadConvexFunctionIdentifier` (so its "1.4 ms" figures were error responses),
and `setAuth({subject})` produced `InvalidAuthHeader` because a raw object is
not a signed JWT. Only the third method — a real sign-in per role with the
issued token reused — produced valid data.

**Most important gap: the system cannot measure itself.** `pg_stat_statements`
and `auto_explain` are not installed, `shared_preload_libraries` is empty,
`log_min_duration_statement` is `-1`, Convex emits no per-function timing, and
there is no metrics container. No endpoint latency, no error rate, no query
time. A future regression would be invisible until a user reported it. The
cheapest high-value fix is **O3** in the baseline document: add per-endpoint
latency and error rate to the existing five-minute `production-health.sh`,
which already runs and already alerts.

Also found: **no container has memory or CPU limits** — every service reports
`memory=0 cpus=0`. A leak could not be contained. Cheap to add at the next
compose change.

Evidence: `docs/PERFORMANCE_BASELINE.md`.

---

### Gate 6 — Onboarding Rehearsal

**8.9**

**Objective.** Prove a new school can be onboarded end to end before a real
customer is asked to do it.

**Prerequisites.** Gates 4–5 complete.

**Acceptance criteria.**
- A full onboarding rehearsal executed in an isolated environment: school
  creation, academic year setup, class sections, subjects, user provisioning,
  staff and student import.
- Time and effort recorded, including the steps that are manual today.
- Documented gaps where onboarding cannot currently be completed without
  engineering help.
- The synthetic `P8-` authorization fixtures either excluded from the rehearsal
  or confirmed not to interfere.

---

### Gate 7 — Commercial Operations

**8.10**

**Objective.** Establish the operational and commercial surface around the
product.

**Prerequisites.** Gates 5–6 complete.

**Acceptance criteria.**
- Support, escalation and incident-response ownership documented.
- On-call and communication paths confirmed with the Owner.
- Commercial packaging and pricing validated against what was actually built.
- Any commitment in customer-facing material verified as something the product
  currently does.

**Requires Owner decision.** This gate is commercial, not engineering, and must
not proceed on an agent's initiative.

---

### Gate 8 — Archive and Retention Policy

**8.11**

**Objective.** Define what is retained, for how long, and how it is disposed
of.

**Prerequisites.** Gate 3 complete, because retention interacts with restore
capability.

**Acceptance criteria.**
- A written retention policy covering application data, backups, logs and
  audit records.
- Logrotate configured for `/opt/schoolcore/logs`, closing the unbounded-growth
  gap.
- Explicit journald retention configured rather than left to host defaults.
- Policy reconciled with backup retention (`14d/8w/12m/2y`) so the two do not
  contradict.
- Disposal procedure documented, including the rule that nothing is deleted
  without Owner approval.

---

### Gate 9 — Runbook Consolidation

**8.12**

**Objective.** Reduce the documentation set to something navigable, without
losing history.

**Prerequisites.** Gates 7–8 complete.

**Acceptance criteria.**
- `SCHOOLCORE_CURRENT_STATE.md` and `PHASE8_ROADMAP.md` confirmed as the entry
  points, with every other document reachable from them or marked historical.
- A secondary alert destination added, closing the single-mailbox risk.
- Superseded documents (the four dated 2026-09-25/26 "PREPARATION" files) either
  marked superseded in place or archived — **not deleted**.
- Any contradictions discovered during consolidation recorded rather than
  silently resolved.

---

### Gate 10 — Pilot Readiness Review

**8.13**

**Objective.** Make an explicit, evidence-backed decision on whether SchoolCore
is ready for a pilot.

**Prerequisites.** Gates 1–9 complete. **All three pilot blockers are closed** (PB-1 in Gate 1, PB-2 in the completed remediations, PB-3 in Gate 2).

**Acceptance criteria.**
- Every gate's acceptance criteria evidenced and linked.
- All pilot blockers closed, or an Owner decision recorded for any that remain
  open, with the risk accepted in writing.
- Known risks (§5 of the current-state document) reviewed, each either
  mitigated or explicitly accepted by the Owner.
- Freebuff/Convex Cloud archive decision recorded — the grace period status and
  whether the rollback reference is retained or retired. Deletion requires
  explicit Owner approval and must not happen without it.
- A written pilot readiness decision.

**This gate does not complete automatically.** It produces a decision, and the
decision belongs to the Owner.

---

## Standing constraints

- `/srv/platform` and Freebuff/Convex Cloud are out of bounds without explicit
  instruction. The Cloud archive must not be deleted.
- Live SSH configuration changes require verified owner access and a rollback
  path.
- Verification scripts must never be pointed at production data.
- CI must not be weakened to make a change pass. If a check is wrong, fix the
  check in its own reviewed change.
- Phase 8 does not complete until Gate 10 produces a decision.