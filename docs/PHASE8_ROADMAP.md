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
`staff:get` now requires `staff.view`. Deployed `d9ba8b7`. Regression suite
36 pass / 2 fail before the fix, 38 pass / 0 fail after; extended matrix
113 pass / 0 fail / 0 retest.

---

## Remaining Sequence

Gates 1 and 2 close the open pilot blockers. Gate 3 onward is hardening in
roughly increasing order of blast radius on the running system.

Gates are **sequential**. Gate N's prerequisites are Gate N-1's acceptance.

---

### Gate 1 — Authentication Hardening

**PB-1: `@auth/core` upgrade and validation**

`@auth/core@0.37.4` carries a CRITICAL advisory (email normalizer homoglyph
`@` bypass), a HIGH (`getToken()` uncaught exception on malformed `Bearer`
headers) and a MODERATE (OAuth cookie binding). Assessed **not reachable** in the
current configuration — SchoolCore registers no Auth.js Email provider and no
`NextAuth` handler, and has no public sign-up path — but it is a live CVE in a
production authentication dependency, and the fix is not a patch: it requires
moving `@convex-dev/auth` 0.0.90 → 0.0.95, which moves the peer requirement to
`^0.41.1`, and realigning `@auth/core` to `>=0.41.3`.

**Objective.** Remove the CRITICAL advisory from the authentication path, or
record with evidence why it can be deferred a second time.

**Prerequisites.**
- This file and `SCHOOLCORE_CURRENT_STATE.md` read, so the current state is
  known.
- A verified production backup.
- Agreement that the auth core is being changed, because this is the
  authentication path of a system holding student personal data.

**Acceptance criteria.**
- `@auth/core` resolves to `>=0.41.3`, with `@convex-dev/auth` aligned.
- `bun audit` no longer reports the CRITICAL or HIGH `@auth/core` advisories.
- CI green: install, typecheck, unit tests, lint, build.
- Deployed to a verified SHA.
- Authentication smoke tests pass: sign-in with an existing credential, JWT
  issuance, and token refresh.
- Role sign-in validation passes for every role that exists in the data set:
  school admin, teacher, parent, student, platform super admin — each
  confirmed able to sign in and reach its own portal.
- Authorization regression suite still passes, and the full matrix still
  reports 0 FAIL / 0 RETEST.
- Production health checks pass after deploy.

**Do not.** Fold unrelated changes into this gate. It is an authentication-core
change; the smaller the diff, the easier it is to reason about.

---

### Gate 2 — Frontend Dependency Hardening

**PB-3: `react-router` advisory**

`react-router@7.18.1` is affected by a HIGH advisory (RSC-mode CSRF bypass).
Assessed **not reachable**: SchoolCore uses declarative SPA mode across 29
import sites, with no RSC runtime, no framework mode, no server actions and no
SSR. The patched version exists in-range (`7.18.2`).

The blocker is a prerequisite gap, not the upgrade: the running frontend is a
baked image `schoolcore-frontend:oauth-pages` and **its build definition is not
in the repository**, so the upgrade cannot be built and deployed from source as
the project currently stands.

**Objective.** Raise `react-router` to `>=7.18.2` and make the frontend
reproducible from the repository.

**Prerequisites.**
- Gate 1 complete.
- The frontend image build source located or reconstructed. If it cannot be
  found, that is the finding, and it must be solved before the upgrade —
  rebuilding frontend assets with an unknown or improvised build would be
  worse than the advisory it is fixing.

**Acceptance criteria.**
- Frontend image build definition is committed to the repository and produces
  the served `dist/`.
- `react-router` resolves to `>=7.18.2`; the HIGH advisory is gone from
  `bun audit`.
- CI green.
- Frontend image rebuilt and deployed.
- Frontend loads and authenticates end to end against the live deployment.
- Public endpoint health checks pass.

**Do not.** Ship a frontend image built from a definition that is not in the
repository. If the build source cannot be recovered, stop and report it.

---

### Gate 3 — Disaster Recovery

**8.5**

**Objective.** Prove the system can be recovered from a loss, not merely
backed up.

**Prerequisites.** Gates 1–2 complete, so recovery is validated against a
settled codebase.

**Acceptance criteria.**
- A full restore rehearsal executed from a real off-site snapshot into an
  isolated environment, not against production.
- Documented restore time and its known limits.
- The consequence of a restore on the Convex environment-variable store
  documented and exercised — a restore wipes it and requires a re-deploy.
- Recovery documentation written and evidence recorded.
- The two accepted backup risks (stale Restic lock; `backup-health.sh` vs the
  freshness signal) are either mitigated or explicitly accepted with rationale.
- No production data loss and no production downtime caused by the rehearsal.

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

**Prerequisites.** Gates 1–9 complete. **PB-1 and PB-3 must be closed.**

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