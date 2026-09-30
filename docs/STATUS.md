# SchoolCore - Status

**As of 2026-09-29 the production migration to self-hosted infrastructure is
COMPLETE and accepted.**

> **This file is a short summary. For the authoritative current state — deployed
> SHA, open pilot blockers, known risks and the document map — read
> [`SCHOOLCORE_CURRENT_STATE.md`](./SCHOOLCORE_CURRENT_STATE.md).**
> For what remains to be done, read
> [`PHASE8_ROADMAP.md`](./PHASE8_ROADMAP.md).

| | |
|---|---|
| Migration | COMPLETE and accepted (Phases 0–7), 2026-09-29 |
| Production | LIVE, self-hosted at `gman-02` |
| **Deployed application SHA** | **`d9ba8b7`** (`d9ba8b7330bc69cc34408f799f285cb13b57bde7`) — PB-2 `staff:get` fix |
| Production branch | `selfhost-production` — CI-gated, deployed by exact SHA |
| Current phase | **Phase 8 — Production Hardening and Pilot Readiness. OPEN.** |
| Pilot readiness | NOT ready. PB-1 and PB-3 open; Gates 3–10 of Phase 8 not started. |

The deployed SHA and the branch HEAD differ by design: commits after `d9ba8b7`
change only tests and documentation, which do not require a deploy. Confirm
what is running with
`git -C /opt/schoolcore/app/source/schoolcore rev-parse HEAD`.

## Live endpoints

| Purpose | URL | Status |
|---|---|---|
| Frontend | `https://schoolcore.ooflowdesk.com` | HTTP 200 |
| Convex API | `https://schoolcore-api.ooflowdesk.com` | HTTP 200 |
| Convex site / OIDC | `https://schoolcore-site.ooflowdesk.com` | HTTP 200 |
| Convex dashboard | internal only | no public DNS |

## Hosting

`gman-02` (Debian 13) - OpenMediaVault host. Five containers:
PostgreSQL 17.11, Convex backend, Convex dashboard, cloudflared, frontend.
Zero host-published ports; all ingress via Cloudflare Tunnel.

## Data

Migrated from the paused Freebuff/Convex Cloud deployment
(`kindhearted-goldfish-282`) on 2026-09-29. 666 documents imported in 12
seconds with verified counts, IDs, timestamps, relationships and tenant
isolation.

## Backups

Encrypted off-site backups to Google Drive via Restic, daily at 02:30
Europe/London. First live production snapshot: `bea9a61c` (2026-09-29T16:28:38Z).
Restore tested. See `BACKUP_AND_RESTORE.md`.
Current backup and monitoring state: `SCHOOLCORE_CURRENT_STATE.md` §2, and
`MONITORING_AND_ALERTING.md`.

## Legacy system

Freebuff / Convex Cloud PROD is a **PAUSED ARCHIVE / ROLLBACK REFERENCE**. Not
resumed, not deleted. Do not resume casually - the two systems have diverged.

## Related documents

### Start here
- **`SCHOOLCORE_CURRENT_STATE.md`** - authoritative current state, blockers, risks
- **`PHASE8_ROADMAP.md`** - what remains, in sequence, with acceptance criteria

### Current technical record
- `AUTHORIZATION_VALIDATION.md` - authorization matrix and both defect fixes
- `PRODUCTION_SECURITY_REVIEW.md` - security posture, dependency audit, PB-2
- `MONITORING_AND_ALERTING.md` - monitoring and alerting architecture
- `PRODUCTION_RELEASE_WORKFLOW.md` - release, backup and rollback discipline

### Historical
- `MIGRATION_STATUS.md` - phase-by-phase migration record and cutover evidence.
  Its banner and Progress snapshot are superseded by the current-state document;
  the phase record and Changelog remain the historical evidence.
- `FINAL_CUTOVER_RUNBOOK.md` - cutover procedure and outcome
- `PHASE5B_DEPLOYMENT_HANDOFF.md` - deployment order for an agent
- `BACKUP_AND_RESTORE.md` - backup architecture, retention, restore
- `SECRET_MANAGEMENT_GUIDE.md` - secret handling
- `SELF_HOSTING_GUIDE.md`, `SELF_HOST_EXECUTION_CHECKLIST.md`,
  `SERVER_EXECUTION_APPROVAL_CHECKLIST.md`, `scripts/README-migration.md` -
  **superseded**, dated 2026-09-25/26, their banners still read "PREPARATION".
  Historically accurate, misleading if read as current.