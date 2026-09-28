# SchoolCore — Backup and Restore

> Encrypted, three-tier backup for the self-hosted SchoolCore deployment.
> **No secret values appear in this document.** Secrets are referenced by name and path only.

---

## 1. Architecture

| Tier | Location | Content | Protection |
|---|---|---|---|
| 1. Server-local | `gman-02` → `/opt/schoolcore/backups/<UTC-timestamp>/` | PostgreSQL logical dump, approved Convex snapshots, manifests, Compose config, restore notes | root-only (0700) |
| 2. Workstation | Windows dev workstation | Final PROD snapshot, pre-purge Git archive, runbooks | Operator-controlled |
| 3. **Off-site** | **Google Drive** — account `offsitebackup1@gmail.com`, folder `SchoolCore-Backups` | Restic-encrypted repository at `rclone:schoolcore-drive:SchoolCore-Backups/restic` | **Client-side AES-256 encryption** |

**Raw unencrypted uploads are never used.** Everything in tier 3 passes through Restic
encryption before it leaves the server. The Restic repository is the only thing written
to Drive; PostgreSQL dumps, OAuth material and the repository password are never
uploaded in the clear.

> **Account roles are strictly separated**
> - `venturesgman@gmail.com` — **admin/operations mailbox** (Resend recipient, operational contact). **Never a backup target.**
> - `offsitebackup1@gmail.com` — **off-site backup account only.** Used for nothing else.
> - `SchoolCore <noreply@mail.ooflowdesk.com>` — outbound sender, never a backup target.

## 2. What is backed up

**Included:** PostgreSQL custom-format logical dump (no downtime) · approved Convex
snapshot ZIPs · SHA256 manifest · Docker image + Compose manifests · sanitized
environment-variable **names** · source commit · restore instructions.

**Deliberately excluded:** live PostgreSQL data directory · Docker overlay filesystem ·
`node_modules` · caches · temp files · Git working directories · **plaintext extracted
production-snapshot directories** · the pre-purge Git archive (secret-bearing — kept
private/offline, never uploaded).

Secrets are **not** in the standard backup. A full recovery needs both the Restic
repository password *and* the Google OAuth config; see §6.

## 3. Restic repository

| Property | Value |
|---|---|
| Tool | Restic **0.18.0** (Debian package) |
| Transport | **rclone v1.60.1** → Google Drive backend |
| rclone remote | `schoolcore-drive` |
| Google account | `offsitebackup1@gmail.com` (backup use only) |
| Drive folder | `SchoolCore-Backups` |
| Repository | `rclone:schoolcore-drive:SchoolCore-Backups/restic` |
| rclone config | `/opt/schoolcore/secrets/rclone.conf` (600 root), referenced via `RCLONE_CONFIG` |
| Authentication | Google OAuth (headless). **The account password is never requested or stored.** |
| Encryption | Client-side, AES-256, key derived from the Restic repository password |

The rclone OAuth config alone cannot decrypt the repository; the Restic repository
password alone cannot reach it. **Both are required, and they are stored separately.**

**Drive scope:** limited to files created/managed by this backup integration
(`drive.scope=drive`, the minimum that reliably supports Restic's object model).
No unrelated Drive content is browsed or inspected.

## 4. Retention

Restic manages retention itself. **No independent Google Drive deletion policy is
configured** — a Drive-side delete rule would corrupt the Restic repository by removing
objects Restic still tracks.

```
--keep-daily 14   --keep-weekly 8   --keep-monthly 12   --keep-yearly 2
```

Applied automatically after every successful upload, with `--prune`.

**Later enhancement (not implemented):** an `IMMUTABLE ARCHIVE` design using a
*separate* Drive folder plus a retention policy for periodic standalone encrypted
archives. This keeps immutability without interfering with the live repository's
prune operations.

## 5. Scheduling

| Property | Value |
|---|---|
| Mechanism | systemd `schoolcore-backup.service` + `schoolcore-backup.timer` |
| Schedule | `02:30` **server local time** |
| Server timezone | `Europe/London` (unchanged — this setup does not alter it) |
| Kenya-time mapping | `02:30 London = 04:30 Africa/Nairobi` during BST; `05:30` during GMT |
| Randomised delay | 300 s |
| Catch-up | `Persistent=true` — a missed run fires after the machine returns |
| Logs | `/opt/schoolcore/logs/backup-<UTC-timestamp>.log` + journald |

## 6. Credentials and recovery (by name/path only)

| Secret | Path | Notes |
|---|---|---|
| rclone / Google OAuth config | `/opt/schoolcore/secrets/rclone.conf` (600 root) | Holds the OAuth token. Never uploaded. |
| Restic repository password | `/opt/schoolcore/secrets/restic-password` (600 root) | **Must also be copied off-server.** Never stored in the Drive repository. |
| SchoolCore runtime secrets | `/opt/schoolcore/deploy/.env` (600 root) | Not uploaded by this job. |
| Google account password | **never requested, never stored** | OAuth only. |

> ### ⚠️ Mandatory off-server recovery copy
> The Restic repository password **must** be retained somewhere the loss of `gman-02`
> cannot destroy. If the server and that password are both lost, the encrypted Drive
> repository **cannot be restored**, even with a valid OAuth token.

Never paste the OAuth token, the Restic password, or any other credential into chat,
Git, Compose files, command-line arguments, or logs.

## 7. Verifying the latest backup

```bash
/opt/schoolcore/scripts/backup-health.sh
```
Reports: newest local backup and its age, dump + checksum presence, free disk, repository
reachability, newest off-site snapshot and its age.
**Unhealthy when the newest off-site snapshot is older than 36 hours.**

## 8. Running a backup manually

```bash
sudo /opt/schoolcore/scripts/backup.sh
```
Single-instance via `flock`; non-zero exit on any failure. Local-only when the Drive
credentials are absent (off-site step is logged as `SKIPPED`).

## 9. Restore to a new server

1. Provision the host; install Docker, Restic 0.18.x.
2. Restore `/opt/schoolcore/` from a backup (or re-clone the repo and re-apply config).
3. Re-create secrets by name: `deploy/.env`, `secrets/rclone.conf`, `secrets/restic-password`.
4. Start PostgreSQL, restore the logical dump:
   ```bash
   docker cp schoolcore.dump <pg-container>:/tmp/d.dump
   docker exec <pg-container> pg_restore -U convex -d schoolcore --clean /tmp/d.dump
   ```
5. Verify integrity: `cd <backup-dir> && sha256sum -c SHA256SUMS`
6. Re-apply the Convex deployment environment (it lives **inside the database**, so a
   restore wipes it — see the note in `docs/FINAL_CUTOVER_RUNBOOK.md`).
7. Re-create the Restic repository access and pull the latest snapshot.
8. Redeploy Convex functions, then start frontend/tunnel.

## 10. Restoring a Convex snapshot

Only into the **self-hosted** target:
```
npx convex import <snapshot.zip>          # replacement semantics — never --append
```
The Phase 6A rehearsal snapshot is **not** a cutover snapshot. The final cutover uses a
freshly downloaded PROD snapshot taken after the write freeze and after password rotation.

## 11. Related

- `docs/FINAL_CUTOVER_RUNBOOK.md` — cutover sequence, rollback, acceptance gates
- `docs/MIGRATION_STATUS.md` — phase status
