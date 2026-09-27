# SchoolCore — Final Cutover Runbook

> **Status: PREPARED. NOT EXECUTED.** This runbook defines the exact procedure
> for the one-way cutover from Freebuff/Convex Cloud production to the
> SchoolCore self-hosted deployment on `gman-02`.
>
> **Prerequisite:** Phase 6A rehearsal PASSED (real PROD snapshot imported,
> counts matched, `_id`/`_creationTime` preserved, tenant isolation verified).
>
> **Do not execute until every gate in §6 passes and the Owner issues an
> explicit GO.**

---

## 0. Provenance — Phase 6A rehearsal + Phase 6B auth gate

| Check | Result |
|---|---|
| Source snapshot | `d1e982a8-8f2b-414f-9c2c-8933ef661959.zip` (Convex snapshot, 129 tables, 802 docs) |
| Import | 673 application documents, **11 s** |
| SHA256 | `ce49b9f1d1583d04eca9bc35afa9519fb9388575c592360a58b53f9c302a01a9` |
| Table counts | **0 discrepancies** |
| `_id` preservation | **IDENTICAL** (0 missing / 0 unexpected) |
| `_creationTime` | **100% preserved** |
| Relationship orphans | **0** |
| Tenant isolation | **PASS** (`You do not have access to this school.`) |
| Auth component data | **PRESENT** (12 accounts, 51 sessions, 66 refresh tokens) |
| **Existing production password** | **PASS** — migrated account accepted the existing production password, application user resolved, tenant resolved, self-host JWT issued |
| Anonymous exposure audit | **PASS** — 20 sensitive functions all blocked; no unauthenticated data return |
| File storage | none in production |

> **The migration compatibility question is closed.** The only remaining
> cutover gate is the **Freebuff write-freeze mechanism** plus owner security
> actions (§12).
>
> **Maintenance window is dominated by freeze coordination and cutover
> verification, not the 11-second database import.**

---

## 12. Exact final cutover sequence

Perform strictly in order. Do not reorder.

| # | Step | Owner / Agent |
|---|---|---|
| 1 | **Rotate the compromised production password in Freebuff.** Never reuse the exposed value. | Owner |
| 2 | **Delete `SEED_SECRET`** from Freebuff production env. | Owner |
| 3 | **Remove `VLY_INTEGRATION_KEY`** from Freebuff env **and rotate/revoke at the VLY issuer.** | Owner |
| 4 | Verify Freebuff PROD is healthy. | Owner |
| 5 | **Enter the verified write-freeze / maintenance state** (§2). | Owner |
| 6 | **Record the freeze timestamp.** | Owner |
| 7 | Download a **NEW** Freebuff PROD backup — *after* the password rotation and freeze. The Phase 6A snapshot **must not** be reused. | Owner |
| 8 | Save to `E:\AI-Development\Backups\SchoolCore\production\final\` | Owner |
| 9 | Calculate SHA256. | Owner |
| 10 | Record the download timestamp. | Owner |
| 11 | Inspect snapshot structure and per-table counts; confirm 129 tables and auth component coverage. | Agent |
| 12 | Transfer to `/opt/schoolcore/backups/migration-rehearsal/` (mode 600, root). | Agent |
| 13 | **Verify SHA256 matches** — stop if it differs. | Agent |
| 14 | Create the `pre-production-cutover-<timestamp>` self-host backup (§4). | Agent |
| 15 | Isolate SchoolCore public ingress as required. | Agent |
| 16 | Import the final snapshot with replacement semantics (§5). | Agent |
| 17 | Run all acceptance gates (§6). | Agent |
| 18 | Start SchoolCore public services — **only after every gate passes.** | Agent |
| 19 | **Owner acceptance declared.** | Owner |
| 20 | *Only now* decide Freebuff archival / decommission. | Owner |

### Ordering dependencies — do not skip

- **Step 1 before step 7.** The final snapshot must contain the *replacement*
  password hash. A snapshot taken earlier carries the exposed hash.
- **Step 5 before step 7.** The backup must represent the last authoritative
  state, so no writes may occur between freeze and download.
- **Step 17 before step 18.** Public ingress must not open until every gate passes.
- **Step 19 before step 20.** Freebuff stays the live rollback target until
  acceptance; it becomes a fallback archive only afterwards.

---

## 0. Known facts from the rehearsal

| Fact | Value |
|---|---|
| Source snapshot | `d1e982a8-8f2b-414f-9c2c-8933ef661959.zip` (Convex snapshot, 129 tables, 802 docs) |
| Import result | 673 application documents, **11 seconds** |
| SHA256 (workstation) | `ce49b9f1d1583d04eca9bc35afa9519fb9388575c592360a58b53f9c302a01a9` |
| Count discrepancies | **0** |
| `_id` preservation | **IDENTICAL** (0 missing / 0 unexpected) |
| `_creationTime` | 100% preserved |
| Relationship orphans | **0** across students/staff/authAccounts |
| Tenant isolation | **PASS** — `ConvexError: You do not have access to this school.` |
| File storage | none in production (0 files) |
| Import window | ~11 s → **data load is NOT the cutover risk** |

> **The maintenance window is dominated by freeze coordination and cutover
> verification, not by the database import.**

---

## 1. Preconditions (all must be true before starting)

- [ ] Owner has issued the explicit **GO**
- [ ] Write-freeze mechanism in place (§2) and **verified** — this is the primary remaining gate
- [x] Existing-credential migration test **PASSED** (Phase 6B)
- [ ] Compromised production password **rotated in Freebuff** (step 1 below)
- [ ] `SEED_SECRET` removed from Freebuff production
- [ ] `VLY_INTEGRATION_KEY` removed from Freebuff **and revoked at the issuer**
- [ ] Git history purge completed and force-pushed (§7)
- [ ] Resend sending domain verified, or email formally deferred
- [ ] Maintenance window agreed and communicated to school users
- [ ] Local workstation backup of Freebuff PROD confirmed present
- [ ] At least one encrypted off-site backup copy exists

---

## 2. Freebuff write freeze

**Recommended: Option A — application maintenance / read-only mode.**

Freebuff must not be deleted, and its database must remain intact so rollback
is possible. Only *writes* need to stop.

Procedure (Owner, in Freebuff):
1. Enable Freebuff's maintenance / read-only mode for
   **SchoolCore Foundation → PROD**.
2. Confirm the app is reachable but no mutations succeed
   (e.g. attempt a harmless read; do not attempt a write).
3. Record the freeze timestamp.

**Rollback:** disable maintenance mode. Writes resume immediately.

**Fallback if maintenance mode is unavailable:** announce the window, then
proceed — the import is 11 s, so the exposure window is small, but this is
weaker and must be a conscious choice. **Deleting the Freebuff deployment is NOT
an acceptable freeze** — do not assume deletion preserves the database; that is
unverified and destroys the rollback target.

---

## 3. Acquire the FINAL production backup

Rehearsal data must **not** be reused. Writes are frozen first, then:

1. Freebuff → SchoolCore Foundation → **Database → Prod → Download backup**
2. Save to `E:\AI-Development\Backups\SchoolCore\production\final\`
3. Record SHA256, byte size, download timestamp
4. Verify ZIP structure: `README.md`, 129 × `<table>/documents.jsonl`, `_storage/`
5. Verify auth component tables present: `authAccounts`, `authSessions`,
   `authRefreshTokens`, `authVerifiers`
6. Record source counts per table
7. Transfer to `/opt/schoolcore/backups/migration-rehearsal/` (mode 600, root)
8. **Re-verify SHA256 on the server — must match exactly**

**STOP if the SHA256 differs.**

---

## 4. Pre-cutover self-host backup

```bash
D=/opt/schoolcore/backups/pre-production-cutover-$(date +%Y%m%d-%H%M%S)
sudo install -d -m 0700 -o root -g root "$D"
sudo docker exec schoolcore-postgres pg_dump -U convex -Fc schoolcore \
  > "$D/postgres-schoolcore.dump"
# + source SHA, image digest manifest, compose config,
#   env-var NAMES only, JWT/JWKS presence (not values), rollback steps
# verify with: pg_restore -l  (must list entries)
```

This is the rollback target for a failed cutover.

---

## 5. Final import (validated procedure)

```bash
# 1. stop public ingress
cd /opt/schoolcore/deploy
docker compose -f docker-compose.convex.yml stop schoolcore-frontend cloudflared
#    verify: all three hostnames return HTTP 530

# 2. verify target identity (internal network)
ADMINKEY=$(grep '^CONVEX_SELF_HOSTED_ADMIN_KEY=' /opt/schoolcore/deploy/.env | cut -d= -f2-)
#    must resolve to instance: schoolcore

# 3. import (replacement semantics - NOT append)
docker run --rm --network schoolcore-net \
  -e CONVEX_SELF_HOSTED_URL="http://backend:3210" \
  -e CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMINKEY" \
  -v /opt/schoolcore/app/source/schoolcore:/src -w /src \
  -v /opt/schoolcore/backups/migration-rehearsal:/snap:ro \
  convex-cli:1.46.0 sh -c 'convex import /snap/prod-snapshot.zip'

# 4. verify counts, IDs, relationships, auth, tenant isolation
#    (reuse the Phase 6A verification queries in REHEARSAL-RESULTS.md)

# 5. existing production owner/admin login test

# 6. ONLY after every gate passes
docker compose -f docker-compose.convex.yml start cloudflared schoolcore-frontend
```

**Never use `--append`.** Never import into Convex Cloud. Never touch
`/srv/platform`.

---

## 6. Acceptance gates — ALL must pass

### SOURCE
- [ ] Freebuff writes frozen and verified
- [ ] Fresh PROD backup downloaded **after** freeze
- [ ] Snapshot SHA256 recorded and re-verified on server
- [ ] Source per-table counts recorded

### SELF-HOST
- [ ] Pre-cutover backup created and valid
- [ ] Target instance confirmed `schoolcore`
- [ ] Import succeeded
- [ ] Zero unexplained table-count differences
- [ ] `_id` spot-check matches
- [ ] Relationship spot-check: 0 orphans
- [ ] Auth account counts match
- [ ] Tenant-isolation smoke test **PASS**
- [ ] **Existing production password login PASS**

### INFRASTRUCTURE
- [ ] PostgreSQL healthy, no SQLite fallback
- [ ] Convex backend healthy
- [ ] Frontend healthy
- [ ] Cloudflare tunnel healthy
- [ ] Zero SchoolCore host-published ports
- [ ] Dashboard private (no public route)
- [ ] `/srv/platform` unaffected
- [ ] OMV / Tailscale / Syncthing healthy

**Only after every box is ticked may users be directed to
`https://schoolcore.ooflowdesk.com`.**

---

## 7. Git history purge — before cutover

**Current remote state — every ref descends from exposed commit `27ebd15`:**

| Ref | SHA | Exposed |
|---|---|---|
| `main` | `d4cc5b4` | **YES** |
| `migration-backup` | `b15a5a6` | **YES** |
| `phase5-selfhost-readiness` | `4be9de7` | **YES** |
| 22 annotated tags | various | **ALL YES** |

> ⚠️ **`migration-backup` is a public branch containing the old secret. A purge
> that rewrites only `main` is defeated by it.** All three branches and all 22
> tags must be rewritten together.

Procedure (destructive — separate explicit approval required):
1. Install `git-filter-repo`
2. Make a **private/offline** pre-purge mirror (outside GitHub)
3. Fresh clone; export all 22 tag names/targets
4. `git filter-repo --path .env.keys --invert-paths --replace-text <file> --tag-rename '' ''`
5. Verify: `git log --all --full-history -- .env.keys` empty;
   `git tag --contains 27ebd15` empty; Phase 5/6 docs intact
6. Re-add `origin` (filter-repo removes it)
7. Force-push **all three branches and all 22 tags** with `--force-with-lease`
8. Verify remotely
9. Consider a GitHub Support request to purge cached blobs (repo is public)

**Do not squash the Phase 5A/5B documentation commits.**

---

## 8. Rollback

| Stage | Action |
|---|---|
| **A. Before import** | No action needed. Freebuff live. Restore nothing. |
| **B. During import** | `docker compose down` on the self-host project (volumes preserved). Freebuff live. |
| **C. After import, before ingress** | Restore the `pre-production-cutover-*` dump. Re-apply env vars (the env store lives in the DB and is wiped by the restore). Re-run `convex deploy`. Freebuff stays live. |
| **D. After ingress, before acceptance** | Stop `schoolcore-frontend` + `cloudflared`. Restore the pre-cutover backup. Tell users to use Freebuff. |
| **E. After user acceptance** | **See §9 — Freebuff is no longer a clean rollback target.** |

**Primary principle: Freebuff remains intact until SchoolCore is accepted.**

There is deliberately **no bidirectional merge design.** Once users write to
self-host, rollback means data loss for anything written after cutover.

---

## 9. OWNER ACCEPTANCE POINT

> **Before acceptance:** Freebuff PROD is fully live and is the rollback target.
> Restoring it is a clean operation.
>
> **After acceptance:** users are writing to self-host. Freebuff becomes a
> **fallback archive**, not an active rollback target. Reverting would discard
> post-cutover writes.
>
> The Owner must explicitly declare acceptance. From that moment, rollback
> means: freeze self-host, restore Freebuff, accept the data divergence.

---

## 10. Email status

`RESEND_API_KEY` is configured. `RESEND_FROM_EMAIL` is **unset/unverified**.

**EMAIL DELIVERY NOT PRODUCTION READY.** Email OTP has no frontend login surface
today, so this does **not** block password-based cutover. Recommended future
sending subdomain: `mail.ooflowdesk.com` — **the Owner must use the exact
SPF/DKIM records Resend generates at verification time.** Do not invent DNS
records. Do not send production email until verified.

---

## 11. JWT policy

**Keep the 60-minute default.** No redesign, no blacklisting.

Documented behaviour: an access JWT remains independently valid until expiry
even after logout. Refresh/session state is managed separately. Revisit
`jwt.durationMs` after production stabilises.

---

## 12. Exposed Freebuff secrets

| Variable | Action |
|---|---|
| `SEED_SECRET` | **Remove** from Freebuff production. It only authorises `seed:seedAll`, which must never run again. Removal is strictly safer than rotation. |
| `VLY_INTEGRATION_KEY` | **SAFE TO REMOVE** from this app's env — the only reader (`src/lib/vly-integrations.ts`) is never imported. Also **rotate/revoke at the VLY issuer**, since removal from the app does not invalidate it there. |

Both were visible in an Owner screenshot. Never displayed or reproduced here.
