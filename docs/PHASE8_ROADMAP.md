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

### Gate 3 — Disaster Recovery — **INCOMPLETE**

**8.5**

A full restore rehearsal was executed on 2026-09-30 against a real off-site
snapshot (`2cee6972`, 3 hours old) in a fully isolated environment. Most of the
procedure worked, and the rehearsal surfaced a **blocker the documentation did
not anticipate**.

**What passed.** Off-site retrieval with `--verify` (35 s); `sha256sum -c`
integrity; PostgreSQL restore of the 3.2 MB dump (1 s); Convex backend start
against the restored database (4 s); the recovered deployment serving real data
— `schools:listSchools`, `team:me`, and `team:list` returning 14 correctly
tenant-scoped users. Cross-tenant reads denied. PB-2's `staff:get` gate still
holds on recovered data. The restored `JWT_PRIVATE_KEY` and `JWKS` are
**fingerprint-identical** to live, so a restore preserves sessions rather than
invalidating them. Database-only restore path: **~44 s**. Production was never
a target; the rehearsal namespace was torn down and the backup repository is
untouched (13 snapshots before and after).

**The blocker.** The backup contains the PostgreSQL dump but **not** the Convex
backend's local storage volume (`convex-data` → `/convex/data/storage/modules/`,
16 blobs / 10 MB in production). The database holds *references* to those
blobs. A database-only restore therefore produces a deployment that starts,
reports healthy, and **fails every function call** with
`Local dir storage couldn't open …/modules/<uuid>.blob`. `convex deploy` also
fails at `start_push` for the same reason.

This is the dangerous class of failure: every surface health check passes while
the application is completely non-functional. **Until the volume is included in
the backup, a total loss of `gman-02` is not recoverable from the backup
alone.**

**Three further gaps** found and now documented in `BACKUP_AND_RESTORE.md` §9.3:
`INSTANCE_NAME` must match the restored database name or the backend exits;
`pg_restore --clean` exits 1 on a fresh target even when it succeeds; and
`deploy/.env` is not in the backup and must be re-supplied.

**Objective.** Make a full recovery possible from the backup alone.

**Prerequisites.** None outstanding; the findings are complete.

**Acceptance criteria — 9 of 11 met.**

- [x] A real off-site snapshot was retrieved
- [x] Restore performed in an isolated environment
- [x] Restored services started successfully — *with the storage volume supplied*
- [x] Application health checks passed on recovered data
- [x] Authentication validated (sign-in path, session resolution, disabled-account refusal)
- [x] Representative data integrity confirmed (every entity count matches live; zero orphans)
- [x] Security posture verified (no public exposure, 0 ports, tenant isolation intact)
- [x] Recovery timing recorded
- [x] Documentation corrected from actual experience
- [x] No production impact occurred
- [ ] **Backup includes the Convex storage volume, and a fresh backup restores into a working deployment with no manual volume copy** — the blocker above

The tenth criterion is the one that cannot be met without a change to the
backup implementation, which is out of scope for this gate. Gate 3 is therefore
**not complete**, and Gate 10 must not treat it as such.

---

### Gate 4 — Database Review

**8.7**

**Objective.** Review the data model and query patterns now that the system is
live and its real usage is known.

**Prerequisites.** Gate 3 complete.

**Acceptance criteria.**
- Table and index review against actual query patterns.
- Index recommendations identified, each with the query it serves and its cost.
- Any change proposed with before/after evidence rather than assertion.
- Findings recorded whether or not they are acted on.

**Do not.** Fold index changes into an unrelated gate. Index changes are
schema changes and need their own backup and review.

---

### Gate 5 — Performance Baseline

**8.8**

**Objective.** Establish a measured baseline so future changes can be judged
against evidence rather than impression.

**Prerequisites.** Gate 4 complete, so the baseline is not distorted by known
query problems.

**Acceptance criteria.**
- Measured baselines recorded for page load, API latency and the operations
  that matter operationally.
- Test conditions and dataset size stated so the numbers are reproducible.
- Thresholds defined for "normal", so alerting or regression detection can use
  them later.
- Known bottlenecks identified, with severity and effort to address.

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