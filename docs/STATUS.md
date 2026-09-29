# SchoolCore - Status

**As of 2026-09-29 the production migration to self-hosted infrastructure is
COMPLETE and accepted.**

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

## Legacy system

Freebuff / Convex Cloud PROD is a **PAUSED ARCHIVE / ROLLBACK REFERENCE**. Not
resumed, not deleted. Do not resume casually - the two systems have diverged.

## Related documents

- `MIGRATION_STATUS.md` - phase-by-phase migration status
- `FINAL_CUTOVER_RUNBOOK.md` - cutover procedure and outcome
- `BACKUP_AND_RESTORE.md` - backup architecture, retention, restore
- `SECRET_MANAGEMENT_GUIDE.md` - secret handling