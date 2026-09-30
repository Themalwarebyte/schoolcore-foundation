# SchoolCore — Backup and Restore

> Encrypted, three-tier backup for the self-hosted SchoolCore deployment.
> **No secret values appear in this document.** Secrets are referenced by name and path only.

---

## 1. Architecture

| Tier | Location | Content | Protection |
|---|---|---|---|
| 1. Server-local | `gman-02` → `/opt/schoolcore/backups/<UTC-timestamp>/` | PostgreSQL logical dump, approved Convex snapshots, manifests, Compose config, restore notes | root-only (0700) |
| 2. Workstation | Windows dev workstation | Final PROD snapshot, pre-purge Git archive, runbooks | Operator-controlled |
| 3. **Off-site** | **Google Drive** — account `offsitebackups1@gmail.com`, folder `SchoolCore-Backups` | Restic-encrypted repository at `rclone:schoolcore-drive:SchoolCore-Backups/restic` | **Client-side AES-256 encryption** |

**Raw unencrypted uploads are never used.** Everything in tier 3 passes through Restic
encryption before it leaves the server. The Restic repository is the only thing written
to Drive; PostgreSQL dumps, OAuth material and the repository password are never
uploaded in the clear.

> **Account roles are strictly separated**
> - `venturesgman@gmail.com` — **admin/operations mailbox** (Resend recipient, operational contact). **Never a backup target.**
> - `offsitebackups1@gmail.com` — **off-site backup account only.** Used for nothing else.
> - `SchoolCore <noreply@mail.ooflowdesk.com>` — outbound sender, never a backup target.

## 2. What is backed up

**Included:** PostgreSQL custom-format logical dump (no downtime) · **Convex local
storage volume** (compiled function modules, file storage, search and import
blobs) · approved Convex snapshot ZIPs · SHA256 manifest · Docker image +
Compose manifests · sanitized environment-variable **names** · source commit ·
restore instructions.

**Deliberately excluded:** the Convex `credentials/` directory (it holds the
instance secret; a recovered backend generates its own) · live PostgreSQL
data directory · Docker overlay filesystem · `node_modules` · caches · temp
files · Git working directories · **plaintext extracted production-snapshot
directories** · the pre-purge Git archive (secret-bearing — kept private/offline,
never uploaded).

Secrets are **not** in the standard backup. A full recovery needs both the Restic
repository password *and* the Google OAuth config; see §6.

> **Added 2026-09-30 (Phase 8.5 remediation).** The Convex storage volume was
> previously **not** captured, and a database-only restore produced a deployment
> that started, reported healthy, and then failed every function call. The
> rehearsal that found this is in §9.1, and the fix is in §9.1a.

## 3. Restic repository

| Property | Value |
|---|---|
| Tool | Restic **0.18.0** (Debian package) |
| Transport | **rclone v1.60.1** → Google Drive backend |
| rclone remote | `schoolcore-drive` |
| Google account | `offsitebackups1@gmail.com` (backup use only) |
| Drive folder | `SchoolCore-Backups` |
| Repository | `rclone:schoolcore-drive:SchoolCore-Backups/restic` |
| rclone config | `/opt/schoolcore/secrets/rclone.conf` (600 root), referenced via `RCLONE_CONFIG` |
| Authentication | Google OAuth via rclone's **headless** flow, using an **owner-controlled OAuth Desktop app**. rclone's shared built-in client is **not** used, so Google's shared-quota rate limit does not apply. **The account password is never requested or stored.** |
| Encryption | Client-side, AES-256, key derived from the Restic repository password |

The rclone OAuth config alone cannot decrypt the repository; the Restic repository
password alone cannot reach it. **Both are required, and they are stored separately.**

**Drive scope:** `drive.file` — the restricted scope, granting access **only to files
this backup integration creates or manages**. The integration cannot see, enumerate, or
read any other file in `offsitebackups1@gmail.com`. No unrelated Drive content is ever
browsed or inspected.

> **Scope caveat:** `drive.file` is the least-privilege choice and is correct here because
> Restic only ever operates on objects it created. If repository initialisation or
> uploads fail with a permission error, widen to `scope=drive` **temporarily for
> diagnosis only**:
> `rclone config update schoolcore-drive scope drive`
> then restore `drive.file` immediately afterwards.

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

> **Rehearsed 2026-09-30 (Phase 8 Gate 3).** This procedure was executed
> end-to-end against a real off-site snapshot in an isolated environment. The
> corrections below are what the rehearsal actually found. **The procedure as
> previously written was incomplete** — see §9.1.

1. Provision the host; install Docker, Restic 0.18.x.
2. Restore `/opt/schoolcore/` from a backup (or re-clone the repo and re-apply config).
3. Re-create secrets by name: `deploy/.env`, `secrets/rclone.conf`, `secrets/restic-password`.
4. Start PostgreSQL, restore the logical dump:
   ```bash
   docker cp schoolcore.dump <pg-container>:/tmp/d.dump
   docker exec <pg-container> pg_restore -U convex -d schoolcore --clean /tmp/d.dump
   ```
   `--clean` issues `DROP TABLE` for every table first, so **on a fresh
   database it prints "does not exist" errors and exits 1 even when the restore
   succeeds.** That is expected. Confirm success by checking that the tables
   and document counts are present, not by the exit code.
5. Verify integrity: `cd <backup-dir> && sha256sum -c SHA256SUMS`
6. Re-apply the Convex deployment environment (see §9.2 — this is more precise
   than the previous note).
7. Re-create the Restic repository access and pull the latest snapshot.
8. **Restore the Convex local storage volume** — this step was **missing** and
   the deployment does not work without it. See §9.3.
9. Start the Convex backend, then the frontend and tunnel.

**`INSTANCE_NAME` must match the restored database name.** Convex derives the
PostgreSQL database name from `INSTANCE_NAME` (it lower-cases and replaces
non-alphanumerics with `_`). A backend started with `INSTANCE_NAME=schoolcore-dr`
against a database restored as `schoolcore` exits immediately with
`FATAL: database "schoolcore_dr" does not exist`.

### 9.1 The backup was incomplete — FIXED 2026-09-30

**Original finding (Gate 3 rehearsal, 2026-09-30).** The Convex backend keeps the
*compiled* function modules as blob files on a Docker volume (`convex-data` →
`/convex/data/storage/modules/`), not in PostgreSQL. The database holds
*references* to those blobs.

The backup contained the PostgreSQL dump but **not** that volume. Evidence:
`manifests/backup-metadata.txt` recorded `convex_snapshots=0`, and the restored
backup contained no `.blob` files. In production the volume holds **13 module
blobs, 10 MB**.

A database-only restore produced a deployment that was **silently broken**:

- the backend started, answered `/version`, and reported healthy;
- the database was fully populated and correct;
- **every function call failed** with
  `Local dir storage couldn't open /convex/data/storage/modules/<uuid>.blob`;
- `convex deploy` also failed at `start_push`, for the same reason.

Every surface health check passed while the application was non-functional.

#### 9.1a The fix

`backup.sh` now copies `convex-data:/storage` into the backup directory as
`convex-storage/`, immediately **after** `pg_dump`:

```bash
docker run --rm -v schoolcore-convex-data:/src:ro -v "$DEST/convex-storage":/dst \
  alpine sh -c 'cp -a /src/storage /dst/storage'
```

Design points, each deliberate:

- **Captured after the dump, not before.** Module blobs are immutable,
  UUID-named files, so a later capture is a *superset* of what the earlier dump
  can reference. Capturing before could miss a blob the dump references.
- **`credentials/` is excluded.** It holds `instance_secret`. A recovered
  backend generates its own credentials on first start — proven in the rehearsal
  — so they are not needed for recovery, and the "no secrets in the backup"
  posture is preserved.
- **The capture fails the backup if it is empty.** A backup without Convex
  storage must never be recorded as complete — that is the defect being closed.
- **The volume is verified to exist** before the copy; a missing volume aborts.
- Metadata records `convex_storage_files`, `convex_storage_bytes` and
  `convex_module_blobs`; `manifests/convex-module-blobs.txt` lists the blobs.
- The storage is inside the same directory as the dump, so it inherits the same
  SHA256 manifest and the same restic encryption.

Restore step: mount the restored `convex-storage/` at the backend's
`/convex/data` so the blobs land at `/convex/data/storage/modules/`. The volume
root maps to `/convex/data` — nesting the copy one level deeper is the one easy
way to get this wrong, and it reproduces the original symptom exactly.

#### 9.1b Proof

A fresh backup (`20260930-175940`, off-site `aad51574`, 25 files, 13 module
blobs, 14 MB) was restored into an isolated environment **using only the
backup's own contents**, with no access to the live volume:

| Check | Result |
|---|---|
| Off-site retrieve + verify | 40 s, 25/25 checksums OK |
| Convex storage from the backup | 13 module blobs present |
| PostgreSQL restore | 8,227 documents |
| Convex backend start | 3 s |
| **Missing module/storage errors** | **0** |
| Application functions execute | yes — `schools:listSchools`, `team:me` |
| Authentication suite | **42 pass / 0 fail** |
| Authorization spot-checks | **8/8 as expected** |
| Data vs live | schools 8/8 · users 25/25 · students 91/91 · staff 21/21 · guardians 71/71 · memberships 23/23 · authAccounts 22/22 |
| Time to serving | **7 s** after retrieval |

### 9.2 The Convex environment store: partly in the backup, partly not

The previous note said the deployment environment "lives inside the database,
so a restore wipes it". That is only half true, and the difference matters.

**Recovered from the backup** (verified by SHA-256 fingerprint match against
live): `JWT_PRIVATE_KEY` and `JWKS`. The restored signing key is **identical**
to the live one, so a restore **preserves existing sessions** rather than
invalidating them.

**Not recovered** — these are only in `/opt/schoolcore/deploy/.env`, which the
backup deliberately excludes: `CONVEX_SELF_HOSTED_ADMIN_KEY`,
`INSTANCE_SECRET`, `CONVEX_DEPLOYMENT`, `POSTGRES_USER` / `POSTGRES_PASSWORD`,
`CONVEX_SELF_HOSTED_URL`, `CONVEX_SITE_URL`, `SITE_URL`, `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`, `TUNNEL_TOKEN`, `VITE_CONVEX_URL`, `VLY_CONVEX_AUTH_ISSUER`.

So a recovery must re-supply `deploy/.env` out of band. The backup records the
variable *names* in `manifests/env-var-names.txt` but no values.

### 9.3 Missing steps, in the order they actually mattered

| # | Step | Status |
|---|---|---|
| 1 | Restore the Convex storage volume to `/convex/data` | **now in the backup** (§9.1a) |
| 2 | Match `INSTANCE_NAME` to the database name | documented, not automated |
| 3 | Ignore `pg_restore --clean` exit code 1 on a fresh target | documented |
| 4 | Re-supply `deploy/.env` | documented (§9.2) |
| 5 | **Give the recovered backend the same site origin as the restored env store** | documented below — **new, found in the 2026-09-30 rehearsal** |
| 6 | Deploy functions before declaring recovery | documented |

**Step 5 — the site-origin coupling.** The restored environment store contains
`CONVEX_SITE_URL` for the production host, and `auth.config.ts` registers its
OIDC provider from that value. If the recovered backend is started with a
*different* site origin, tokens it mints carry the wrong issuer and every
session resolution fails with:

```
NoAuthProvider: No auth provider found matching the given token.
Check that your JWT's issuer and audience match one of your configured providers
```

This costs nothing on a real recovery, where the production origin is used, but
it is a sharp edge when rehearsing against an isolated host, and it is
indistinguishable from a broken restore unless you know to look for it.

### 9.4 Observed recovery time

Measured 2026-09-30 restoring snapshot `aad51574` (database **and** Convex
storage) from the off-site repository:

| Component | Observed |
|---|---|
| Off-site retrieve + verify (13.1 MB, 28 files) | 40 s |
| SHA256 integrity (25 files) | < 1 s |
| PostgreSQL start + `pg_restore` | 3 s |
| Convex backend start | 3 s |
| **Time to serving** | **7 s** after retrieval |
| **Total from cold** | **~47 s** |

**Recovery point:** the daily 24-hour schedule, so worst-case data loss is one
day — inside the RPO target in `BACKUP_RECOVERY.md` (≤ 24 h), and the restore
is far inside the RTO target (≤ 8 h) for the data-recovery step alone. **These
are not end-to-end RTO figures**: host provisioning and secret recovery are not
automated and are not measured here.

## 9.5 Recovery blockers summary

A full recovery requires, in addition to the encrypted backup:

1. The **Restic repository password** and the **rclone/OAuth config** — held
   separately, and the Restic password must be kept off-server (§6).
2. **`/opt/schoolcore/deploy/.env`** — not in the backup, and required (§9.2).

The Convex storage volume is **no longer** a blocker: it is captured, restic-
encrypted, checksummed, and proven to restore into a working deployment
(§9.1b).


## 10. Restoring a Convex snapshot

Only into the **self-hosted** target:
```
npx convex import <snapshot.zip>          # replacement semantics — never --append
```
The Phase 6A rehearsal snapshot is **not** a cutover snapshot. The final cutover uses a
freshly downloaded PROD snapshot taken after the write freeze and after password rotation.

## 11. Operational status

Verified 2026-09-27/28 against the live repository.

| Item | Value |
|---|---|
| Repository id | `8ec26daf73…` (restic v2 repo) |
| First snapshot | `7490fcbf` — 2026-09-28 14:47 BST, host `gman-02` |
| Snapshot tags | `schoolcore, automated, postgres, gman-02` |
| Snapshot size | 567.458 KiB |
| Upload duration | 42 s (local dump + validate + checksum + upload, 69 s total) |
| `restic check` | **no errors were found** |
| Restore test | **PASS** — checksums verified, dump validated, restored into a **disposable** PostgreSQL container (5 tables, 3 182 document rows), plaintext shredded afterwards |
| Retention | **applied** — 14 daily / 8 weekly / 12 monthly / 2 yearly, Restic-managed |
| Scheduled run | timer `enabled` + `active`, `Persistent=true` |
| Next run | **02:30 Europe/London** (+ up to 300 s randomised) |
| **Nairobi mapping** | 02:30 London = **04:30 EAT** during BST; **05:30 EAT** during GMT |
| Health check | **HEALTHY** — local fresh, Drive reachable, off-site age under 36 h |

### Encryption verification

Restic stores `config` in plaintext **by design**; confidentiality comes from the
master key, which is wrapped by a scrypt key derived from the repository
password. Verified on the Drive objects:

- Only `restic/` exists at the Drive folder top level — **no plaintext backup
  artefacts** outside the repository
- A sampled data pack begins `3e b5 d9 b1 1a 2c 29 81 …` (high-entropy
  ciphertext, not ASCII)
- The plaintext marker `PostgreSQL database dump` occurs **0** times in the pack

### Off-server recovery copy — MANDATORY

The Restic repository password is stored at
`/opt/schoolcore/secrets/restic-password` (root:root, 0600). A verified
copy exists on the owner workstation at
`E:\AI-Development\Backups\SchoolCore\recovery\restic-password`
(SHA-256 matched at transfer time).

> **Loss of this password = permanent loss of the encrypted repository.** The
> rclone OAuth token alone cannot decrypt it, and the password alone cannot
> reach it. Both are required, and they are stored separately.

### Operational notes

- If a backup is interrupted on Drive, a **stale restic lock** can make the
  repository appear unreachable. `backup-health.sh` detects and clears locks it
  finds; if a lock is genuinely active, `restic unlock` is the manual step.
- `backup-health.sh` exits non-zero when the newest off-site snapshot is older
  than **36 hours**.


### First live production backup (post-cutover)

The first backup taken after the owner accepted the migrated deployment:

| Field | Value |
|---|---|
| Timestamp (UTC) | 2026-09-29T16:28:38Z |
| Local path | `/opt/schoolcore/backups/20260929-162836` (3.1 MB, 8 files) |
| PostgreSQL dump | 3,127,482 bytes, `pg_restore` validated |
| Checksums | `SHA256SUMS` 8/8 verified |
| Restic snapshot | `bea9a61c` |
| Upload duration | 39 s (69 s total) |
| `restic check` | no errors (5/5 snapshots) |
| Backup health | **HEALTHY** |

This is the baseline against which later backups should be compared.

## 13. Related

- `docs/FINAL_CUTOVER_RUNBOOK.md` — cutover sequence, rollback, acceptance gates
- `docs/MIGRATION_STATUS.md` — phase status
