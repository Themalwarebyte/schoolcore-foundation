# SchoolCore Current State

**Read this first.** This is the authoritative current-state record for
SchoolCore as at **2026-09-30**. If this file and any other document disagree
about the present, this file is correct and the other document is either
historical or needs reconciling.

It does not replace history. `MIGRATION_STATUS.md`, `FINAL_CUTOVER_RUNBOOK.md`
and the phase records remain the evidence of how the system got here. This file
answers "where are we now", not "how did we get here".

For what still has to happen, see `PHASE8_ROADMAP.md`.

---

## 1. Executive Status

| | |
|---|---|
| **Migration** | **COMPLETE and accepted.** Cutover 2026-09-29, owner browser acceptance recorded (`MIGRATION_STATUS.md` §"Phase 6B/7 - PRODUCTION CUTOVER COMPLETED"). Phases 0–7 are closed. |
| **Production** | **LIVE on self-hosted infrastructure** at `gman-02`, serving production traffic. |
| **Current deployed application SHA** | **`8f4b84fcf1bdf6755033f60f0bf35bf1b5ab85f6`** (`8f4b84f`) — the PB-3 `react-router` frontend hardening |
| **Current branch** | `selfhost-production` — the production branch, CI-gated, deployed by exact SHA |
| **Current phase** | **Phase 8 — Production Hardening and Pilot Readiness. Phase 8 is OPEN.** |
| **Pilot readiness** | **NOT ready.** All three recorded pilot blockers are now CLOSED. Phase 8 Gates 3–10 have not started. |

### On the deployed SHA and the branch HEAD

The deployed application SHA and the branch HEAD are deliberately separate.

- **`d9ba8b7` is deployed.** It contains the `staff.ts` authorization fix.
- Commits after it (`b5eebf5`, `9cfa8c2`, and documentation commits) change
  **only** tests and documentation. Per `PRODUCTION_RELEASE_WORKFLOW.md` §6, a
  documentation-only commit does not require a deploy, so the running code is
  still `d9ba8b7` while `selfhost-production` has moved on.

To confirm what is actually running:

```bash
git -C /opt/schoolcore/app/source/schoolcore rev-parse HEAD
```

**No document recorded any deployed SHA before this file existed.** That gap is
why this record was created.

---

## 2. Production Environment

| Component | State |
|---|---|
| **Self-hosted production** | LIVE. `gman-02` (Debian 13, OpenMediaVault host) |
| **Convex Cloud archive** | `kindhearted-goldfish-282` — **PAUSED ARCHIVE / ROLLBACK REFERENCE**. Not resumed, not deleted. The two systems have diverged; do not resume casually. |
| **Containers (5)** | `schoolcore-postgres` healthy · `schoolcore-convex-backend` healthy · `schoolcore-convex-dashboard` up · `schoolcore-cloudflared` up · `schoolcore-frontend` healthy |
| **Database** | PostgreSQL 17, accepting connections. 3 active schools. |
| **Host-published ports** | **0.** All ingress via Cloudflare Tunnel. |
| **Convex dashboard** | Private, no public DNS, intentionally unrouted |
| **Health** | `STATUS=DEGRADED (warn=1)` — the single warning is a 57 MB swap usage notice, which is a strict-threshold artefact, not an incident. See §5. |
| **Monitoring** | `schoolcore-health.timer` every 5 minutes, state-transition alerting via Resend, 1-hour cooldown, recovery notices. Both timers active. |
| **Backup** | `schoolcore-backup.timer` daily 02:30 Europe/London (02:33 BST next run). Restic → Google Drive, encrypted. 12 off-site snapshots, newest `1cf29f5f` at time of writing. Retention `14d/8w/12m/2y`. `backup-health.sh`: HEALTHY. |
| **`/srv/platform`** | **Untouched throughout.** A separate deployment, not part of SchoolCore. |
| **Freebuff** | Untouched and paused. |

### Public endpoints

| Purpose | URL | Status |
|---|---|---|
| Frontend | `https://schoolcore.ooflowdesk.com` | HTTP 200 |
| Convex API | `https://schoolcore-api.ooflowdesk.com` | HTTP 200 |
| Convex site / OIDC | `https://schoolcore-site.ooflowdesk.com` | HTTP 200 |
| Convex dashboard | internal only | no public DNS |

---

## 3. Completed Work

### Migration — complete
- Phases 0–7 executed and closed. Empty self-hosted Convex built (Phase 3),
  data migrated and verified (Phase 4), application deployed and verified
  (Phase 5), email delivery via Resend (Phase 6), cutover and owner acceptance
  (Phase 6B/7).
- 666 documents imported in 12 seconds with every table signature delta 0,
  `_id` and `_creationTime` preserved, 0 orphans, tenant isolation verified,
  and an existing production password authenticating against the self-host.
- Evidence: `MIGRATION_STATUS.md`, `FINAL_CUTOVER_RUNBOOK.md`.

### Security
- **Authorization validation** — full role matrix executed against the live
  deployment using the `convex run --identity` harness. Final state
  **100 PASS / 0 FAIL / 0 RETEST** across 101 rows. Evidence:
  `AUTHORIZATION_VALIDATION.md`.
- **Student horizontal access defect — FIXED** (`db1fe52`). `students:get`,
  `students:stats` and `students:recent` gated on session presence rather than
  `students.view`, letting parent and student accounts read other students
  inside their own school. Closed with a regression suite that fails on the old
  behaviour.
- **PB-2 `staff:get` — CLOSED** (`d9ba8b7`). The only staff read handler with no
  role gate. Now requires `staff.view`, matching `staff:list`, `staff:stats`
  and `staff:departments`. Super-admin null-`schoolId` behaviour deliberately
  preserved as secure denial. Regression suite 36 pass / 2 fail before,
  38 pass / 0 fail after; extended matrix 113 pass / 0 fail / 0 retest.
- **Dependency audit** — production-reachable `hono` finding fixed
  (4.12.27 → 4.13.11); audit count 25 → 18, remainder triaged. Evidence:
  `PRODUCTION_SECURITY_REVIEW.md`.

### Operations
- **Monitoring corrective pass — COMPLETE.** Two critical defects found in the
  alerting path and a third in the backup-freshness signal. The alerting system
  had never been able to send a DEGRADED or CRITICAL alert; the freshness check
  measured the *oldest* off-site snapshot instead of the newest and therefore
  cried wolf while backups succeeded. All three fixed and verified end to end,
  including a proven `HEALTHY → DEGRADED` alert delivery. Evidence:
  `MONITORING_AND_ALERTING.md` §7.
- **Release workflow — COMPLETE.** Documented deployment discipline with
  mandatory CI gates, mandatory pre-deploy backup, SHA-pinned deploy, health and
  authorization smoke requirements, and code-vs-data rollback paths. Evidence:
  `PRODUCTION_RELEASE_WORKFLOW.md`.
- **CI validated** — every commit to `selfhost-production` runs install,
  typecheck, unit tests, lint and build. All green through run #12.

---

## 4. Open Pilot Blockers

| ID | Issue | Status | Owner / Next Action |
|---|---|---|---|
| **PB-1** | `@auth/core@0.37.4` — CRITICAL (GHSA-7rqj-j65f-68wh, homoglyph email bypass), HIGH (GHSA-xmf8-cvqr-rfgj), MODERATE. | **CLOSED** | Upgraded to `@convex-dev/auth@0.0.95` with `@auth/core@0.41.3` pinned, commit `d58f971`. Reachability proven against the installed tree: `@convex-dev/auth` imports only `setEnvDefaults` from `@auth/core`, the registered Email provider has zero `@auth/core` references, and `getToken` is reachable only from the unused `nextjs` entrypoint. Authentication re-validated through real sign-in — 42/42 both before and after — and the authorization matrix holds at 113/113. See `PRODUCTION_SECURITY_REVIEW.md` §4.2.1. |
| **PB-2** | `staff:get` authorization defect — parent and student could read individual staff records. | **CLOSED** | Remediated in `d9ba8b7`. Verified: regression suite 38/0, extended matrix 113/0/0. Evidence: `PRODUCTION_SECURITY_REVIEW.md` §4.1.1. |
| **PB-3** | `react-router@7.18.1` RSC CSRF (GHSA-qwww-vcr4-c8h2). | **CLOSED** | Upgraded to `react-router@7.18.4`, commit `8f4b84f`. Reachability proven from the build configuration: no RSC, no SSR, no server actions, `@react-router/dev` not installed, and the frontend container runs nginx serving static files. The frontend build definition turned out to be tracked as `Dockerfile.frontend`, correcting the earlier claim that it was absent; the image was rebuilt, validated in isolation, and deployed via Docker Compose. Asset inventory identical at 124. See `PRODUCTION_SECURITY_REVIEW.md` §4.3.1. |

### Open items that are not pilot blockers

| Item | Note |
|---|---|
| `academicOps:teacherHome` | Throws for a contextless platform super admin (`academicOps.ts:137`, unchecked `session.schoolId` cast into `db.get`). Availability, not isolation — no data returned. The same unchecked-cast pattern exists in many school-scoped handlers and needs a dedicated review. Not assigned a Phase 8 gate. |
| `phase7/access:permissionMatrix` | Readable by any signed-in user (`phase7/access.ts:90-100`, bare `getSession`). Exposes permission names, not data, so low severity, but it widens the authenticated surface intentionally and should be a conscious decision. |
| Platform super-admin school context | `staff:list` returns an empty page for a platform admin while `staff:get` returns DENIED. Both stem from the null `schoolId`; neither is deliberate design. Recorded, not resolved, because resolving it means defining a cross-school access model. |

---

## 5. Known Risks

**These are risks and accepted conditions, not active failures.** The system is
healthy and serving production.

| Risk | Impact | Disposition |
|---|---|---|
| **Restic stale lock** | A lock left by an interrupted object-store operation blocks `restic check` *and the next `restic backup`*. `backup.sh` only clears locks inside its own `forget` retry, which is reached only *after* `restic backup` has already failed. One was observed on 2026-09-30 and cleared with `restic unlock` after confirming the owning PID was dead. | Accepted, unmitigated. A pre-backup stale-lock sweep or an age threshold on lock files would close it. |
| **`backup-health.sh` vs freshness signal** | Two backup checks answer different questions and can disagree. During the §7.4 defect, `backup-health.sh` said `HEALTHY` while `production-health.sh` said `CRITICAL` on the same repository. Nothing detects a divergence between them. | Accepted. A `HEALTHY` from `backup-health.sh` does not by itself prove off-site freshness. Consider surfacing the off-site age from `backup-health.sh`. |
| **Swap warning keeps the system at `DEGRADED`** | The health check warns for *any* swap usage, so `HEALTHY` is currently unreachable on this host. Cosmetic (`vmstat` shows `si=0 so=0`, ~12 GB RAM free), but it blunts sensitivity to future warnings. | Accepted. Confirm with `vmstat`, not with the health verdict. |
| **Other bare-`getSession` authorization patterns** | PB-2 was found by inspecting one module. The same pattern — a school-scoped read gated on session presence rather than permission — could exist in other handlers. Not swept. | Unassessed. A targeted audit of school-scoped single-record reads is warranted. |
| **Platform super-admin school-context ambiguity** | See §4. Behaviour is inconsistent between `staff:list` and `staff:get`. No security impact found — platform sessions are denied or get empty results. | Accepted pending a deliberate decision on the cross-school model. |
| **No logrotate for `/opt/schoolcore/logs`** | Unbounded growth, roughly 100 KB/day. | Deferred to 8.11 archive/retention policy. |
| **Single alert destination** | One mailbox; a mailbox failure means silent loss. | Deferred to 8.12 runbook. |

---

## 6. Document Map

### Authoritative for the present
| Document | Authority |
|---|---|
| **`SCHOOLCORE_CURRENT_STATE.md`** (this file) | Current production state, open blockers, risks |
| **`PHASE8_ROADMAP.md`** | What remains, in sequence, with acceptance criteria |
| `AUTHORIZATION_VALIDATION.md` | Authorization behaviour, the full matrix, both defect fixes |
| `PRODUCTION_SECURITY_REVIEW.md` | Security posture, dependency audit, PB-2 remediation |
| `MONITORING_AND_ALERTING.md` | Monitoring and alerting architecture, the three defects found |
| `PRODUCTION_RELEASE_WORKFLOW.md` | How a change reaches production, and how to roll it back |

### Historical — evidence, not current state
| Document | Note |
|---|---|
| `MIGRATION_STATUS.md` | Phases 0–7 record and cutover evidence. Its banner and Progress snapshot are superseded by this file. |
| `FINAL_CUTOVER_RUNBOOK.md` | The cutover procedure and outcome |
| `PHASE5B_DEPLOYMENT_HANDOFF.md` | The one document recording the deployment order for an agent |
| `BACKUP_AND_RESTORE.md`, `SECRET_MANAGEMENT_GUIDE.md` | Operational reference |
| `SELF_HOSTING_GUIDE.md`, `SELF_HOST_EXECUTION_CHECKLIST.md`, `SERVER_EXECUTION_APPROVAL_CHECKLIST.md`, `scripts/README-migration.md` | **Superseded.** Dated 2026-09-25/26; their banners still read "PREPARATION / Nothing has been executed". Correct as history, misleading if read as current. |

---

## 7. Things that are deliberately not true

Stated so nobody re-derives them:

- **The migration is not in progress.** It completed on 2026-09-29. Documents
  saying otherwise predate it.
- **`selfhost-production` is not exempt from CI.** It is CI-gated and is the
  branch that deploys.
- **`main` is not blindly merged** into the production branch.
- **Freebuff/Convex Cloud is not "live production".** It is a paused archive.
- **A green CI run does not mean deployed.** Only `d9ba8b7` is running.
- **All three pilot blockers are closed** (PB-1, PB-2, PB-3). That is a
  precondition for Gate 10, not the same thing as pilot readiness — Gates 3–9
  have not started.
- **The swap warning is not an incident.**