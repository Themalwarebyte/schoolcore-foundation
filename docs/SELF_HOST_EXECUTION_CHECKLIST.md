# Self-Host Execution Checklist — schoolcore.ooflowdesk.com

> **Status:** PREPARATION. This is the gated execution runbook for the
> self-host rollout. **Nothing in it has been executed.** No deploy, no data
> migration, no production modification. The current Freebuff/Convex Cloud
> deployment remains live and untouched until final cutover (§7).
>
> Companion docs: [`MIGRATION_STATUS.md`](./MIGRATION_STATUS.md) (phase
> tracker) · [`SELF_HOSTING_GUIDE.md`](./SELF_HOSTING_GUIDE.md) (architecture)
> · [`SERVER_DEPLOYMENT_GUIDE.md`](./SERVER_DEPLOYMENT_GUIDE.md) (procedures)
> · [`SECRET_MANAGEMENT_GUIDE.md`](./SECRET_MANAGEMENT_GUIDE.md) (secrets) ·
> [`CONVEX_SELF_HOST_MIGRATION_PLAN.md`](./CONVEX_SELF_HOST_MIGRATION_PLAN.md)
> (data plan) · [`EMAIL_RESEND_MIGRATION.md`](./EMAIL_RESEND_MIGRATION.md)
> (email) · [`scripts/README-migration.md`](../scripts/README-migration.md)
> (tool contract).

---

## Confirmed decisions (Owner)

| Decision | Value |
| --- | --- |
| Target domain | `https://schoolcore.ooflowdesk.com` |
| Initial server | `gman-02` |
| Portability | Future server migration = restore deployment state + restore secrets + change Cloudflare routing only (§8) |
| Public ingress | **Cloudflare Tunnel** — outbound `cloudflared` connector on `gman-02`; no inbound web ports |
| Dashboard protection | **Cloudflare Access** (edge SSO/allowlist) |
| Convex backend | Self-hosted Convex (official image, version-pinned) |
| Application backend | **No rewrite** — existing Convex functions pushed as-is |
| Secrets | Server-managed env config (`/etc/schoolcore/schoolcore.env`) — **no dotenvx** |
| Email | Resend (`RESEND_API_KEY`), replacing VLY OTP gateway at cutover |
| Current deployment | Freebuff/Convex Cloud stays live and untouched until final cutover |

### Hostname plan

| Hostname | Purpose | Upstream |
| --- | --- | --- |
| `schoolcore.ooflowdesk.com` | Public app (SPA) | `app` container (nginx serving `dist/`) |
| `schoolcore-api.ooflowdesk.com` | Convex backend HTTP + WebSocket (`VITE_CONVEX_URL`) | `convex` container |
| `schoolcore-dashboard.ooflowdesk.com` | Convex dashboard (admin) — **Cloudflare Access**-protected | `dashboard` container via `cloudflared` |

> **Ingress confirmed:** Cloudflare Tunnel. `cloudflared` connects **outbound**
> to Cloudflare; TLS terminates at the edge; ports 80/443 stay closed on
> `gman-02`. WebSockets must be enabled in Cloudflare (Convex client).

---

## Gate table (do not skip)

| Gate | When | Exit criterion |
| --- | --- | --- |
| G1 | Before §1 | All §1 items checked |
| G2 | Before §5 rehearsal | §2–§3 complete; restore test done |
| G3 | Before §6 | Email abstraction code merged + OTP test passed |
| G4 | Before §7 cutover | Full rehearsal (§5) + application verification (§5.4) green |

---

## 1. Pre-deployment requirements

Reference: [`MIGRATION_STATUS.md`](./MIGRATION_STATUS.md) §1 · [`SECRET_MANAGEMENT_GUIDE.md`](./SECRET_MANAGEMENT_GUIDE.md).

### 1.1 Git cleanup completion
- [ ] Final repo secret scan green (`scripts/security-audit.mjs` P1 checks) — no secrets tracked anywhere.
- [ ] dotenvx cleanup approved + done: local `.env.keys` deleted (untracked, unreferenced — SECRET_MANAGEMENT_GUIDE §2 C1).
- [ ] `migration/` added to `.gitignore` (when `scripts/migration/` lands) — archives never enter git.
- [ ] `.env.example` (manual Owner edit): add `RESEND_API_KEY=` blank placeholder.
- [ ] Working tree clean; release tag cut (`git tag selfhost-<date>`); note the SHA — it becomes the schema-parity reference for all §5 manifests.

### 1.2 Secret rotation
- [ ] Fresh values prepared for the new host (never reuse Cloud values where rotation is cheap): `PLATFORM_ADMIN_EMAIL`/`NAME`/`PASSWORD`, M-Pesa credentials (re-issued if practical), `MPESA_CALLBACK_SECRET`.
- [ ] `SEED_SECRET` deliberately **absent** from the production env set.
- [ ] `RESEND_API_KEY` created fresh (§6) and stored server-side only.
- [ ] Rotation schedule recorded in the server runbook — cadence **OWNER DECISION REQUIRED**.

### 1.3 Backup verification
- [ ] Backup tooling installed + configured on `gman-02` (restic or equivalent; SERVER_DEPLOYMENT_GUIDE §5).
- [ ] Off-site target configured (S3-compatible or second host) — **OWNER DECISION REQUIRED** (choice made, credentials stored server-side).
- [ ] First **tested restore** completed (restore a canary file; record RTO/RPO observed).
- [ ] Backup encryption confirmed (backups include `/etc/schoolcore` env file → secret-sensitive).

### 1.4 Server readiness
- [ ] `gman-02` provisioned: Ubuntu 22.04+ LTS, sizing per SELF_HOSTING_GUIDE §4 (4+ vCPU / 8–16 GB / 100 GB+ SSD for multi-school production).
- [ ] SSH: key-only, no root login, fail2ban; `schoolcore` service user created.
- [ ] Unattended security upgrades enabled.
- [ ] Disk, RAM, and outbound HTTPS (Resend, M-Pesa, SMS, Cloudflare Tunnel connector) verified.
- [ ] Clock sync (NTP) verified — timestamps matter for auth + audit logs.

---

## 2. Server setup

Reference: [`SERVER_DEPLOYMENT_GUIDE.md`](./SERVER_DEPLOYMENT_GUIDE.md) §2–§4.

### 2.1 Docker & Compose
- [ ] Docker Engine 24+ installed (get.docker.com).
- [ ] Docker Compose v2 plugin installed (`docker compose version` verified).
- [ ] `schoolcore` user added to `docker` group.

### 2.2 Storage directories
- [ ] `/var/lib/schoolcore/convex` — Convex data volume (created, correct ownership for the backend image).
- [ ] `/var/lib/schoolcore/backups` — staging for local backup snapshots.
- [ ] `/etc/schoolcore/` — secrets dir, `root:root 0700`.

### 2.3 Firewall & ingress
- [ ] `ufw` default-deny incoming; allow 22 (SSH) only — **no inbound 80/443** (Cloudflare Tunnel connects outbound).
- [ ] `cloudflared` installed (container or systemd service) and authenticated to the `schoolcore` tunnel — token/credentials stored server-side only.
- [ ] Tunnel public-hostname routes configured for all three hostnames (§2.6).
- [ ] **Cloudflare Access** application protecting the dashboard hostname.

### 2.4 TLS
- [ ] Edge certificates active for all three hostnames (Cloudflare-managed; nothing to renew on the origin).
- [ ] Always-HTTPS enforced; **WebSockets enabled** (Convex client requirement).
- [ ] HSTS enabled after stability window.

### 2.5 Local routing (behind the tunnel)
- [ ] `cloudflared` routes each public hostname to its local service (`app` / `convex` / `dashboard`); a local reverse proxy is optional.
- [ ] SPA fallback (`try_files … /index.html`) on the app container.
- [ ] Compression and request-size limits sane (file uploads via Convex storage).

### 2.6 Domain configuration (Cloudflare)
- [ ] `ooflowdesk.com` zone on Cloudflare; the three hostnames created as **proxied CNAMEs to the tunnel** (`<tunnel-id>.cfargotunnel.com`).
- [ ] Confirm what `schoolcore.ooflowdesk.com` serves before cutover — it must either point at the current deployment or be unpublished; the production switch happens only in §7.3.
- [ ] Routing changes are near-instant (no TTL dependency) — both the cutover switch and rollback are fast.

---

## 3. Self-hosted Convex deployment

Reference: SERVER_DEPLOYMENT_GUIDE §3/§8 · CONVEX_SELF_HOST_MIGRATION_PLAN §3.

### 3.1 Containers
- [ ] `convex` backend container running (official self-hosted image) with `/var/lib/schoolcore/convex` mounted, `restart: unless-stopped`.
- [ ] `dashboard` container running.
- [ ] `app` (SPA) container running (§4.1) — may deploy later in the sequence; proxy returns 503 until then.

### 3.2 Environment variables
- [ ] `/etc/schoolcore/schoolcore.env` created (`0600 root:root`) from SECRET_MANAGEMENT_GUIDE §4 template; wired into containers via `env_file:`.
- [ ] Required set present: `NODE_ENV=production`, `SITE_URL=https://schoolcore.ooflowdesk.com`, `CONVEX_SITE_URL=https://schoolcore-api.ooflowdesk.com`, `PLATFORM_ADMIN_EMAIL/NAME/PASSWORD`, `RESEND_API_KEY` (from §6).
- [ ] Optional integrations as needed: `MPESA_*`, `SMS_API_KEY`, `WHATSAPP_API_KEY` — all degrade gracefully if absent.
- [ ] `SEED_SECRET` confirmed **absent**; no `VLY_*` keys provisioned (sunset).
- [ ] No dotenvx anywhere — plain env vars only.
- [ ] Cloudflare Tunnel token/credentials held server-side only (never committed, never `VITE_*`).

### 3.3 Database / storage
- [ ] Convex data volume persists across container restart (test: restart backend, data intact).
- [ ] File storage confirmed working on the self-hosted backend (upload a canary file via dashboard or test action; delete it after).

### 3.4 Version pinning
- [ ] Backend image version pinned to match the repo's `convex ^1.46.0` CLI; image digest recorded in the runbook.
- [ ] Export/import compatibility verified with the pinned version (CONVEX plan §8 item 1) — small test export/import on a scratch deployment.

### 3.5 Verification
- [ ] `bunx convex push` from the tagged SHA creates all **125 tables + 315 indexes** (schema = `src/convex/schema.ts` + `schemaPhase7.ts`; no backend rewrite).
- [ ] Pushed SHA recorded in the migration manifest (schema-parity gate).
- [ ] Backend HTTP endpoint answers on `https://schoolcore-api.ooflowdesk.com` through the tunnel; dashboard reachable **through Cloudflare Access only**.

---

## 4. Application deployment

### 4.1 Frontend build
- [ ] Built **off-box** (workstation/CI — never on `gman-02`, OOM history): `bun install && bun tsc -b --noEmit && bun run build`.
- [ ] Build-time env: `VITE_CONVEX_URL=https://schoolcore-api.ooflowdesk.com` baked into `dist/`.
- [ ] App image built from `deploy/Dockerfile` (nginx serving `dist/`), tagged, and either pushed to a registry or loaded on `gman-02`.
- [ ] Image tag recorded; compose pins the tag (not `latest`).

### 4.2 Backend deployment
- [ ] Convex functions deployed to the self-hosted backend via `convex push` from the tagged SHA (§3.5) — **no application backend rewrite**.
- [ ] HTTP actions (payment callbacks, etc.) reachable on the API hostname; auth OIDC discovery works against `CONVEX_SITE_URL`.

### 4.3 Environment configuration
- [ ] Cross-check: every env var the code reads (SECRET_MANAGEMENT_GUIDE §3.2–3.3) is either set intentionally or its graceful-degradation path is accepted.
- [ ] `SITE_URL`/`CONVEX_SITE_URL` match the public hostnames exactly (wrong values break email links, activation codes, callbacks).
- [ ] Frontend (`VITE_*`) vs backend (server-side) split respected — nothing secret is `VITE_`-prefixed.

---

## 5. Data migration

Reference: CONVEX_SELF_HOST_MIGRATION_PLAN §4–§5 · scripts/README-migration.

> Whole-deployment unit only, into an **empty** target, IDs/relationships/`schoolId`/users/permissions/audit logs/storage preserved by construction + validator.

### 5.1 Export procedure
- [ ] `scripts/migration/export.mjs` implemented (wraps `bunx convex export`, writes `manifest-<ts>.json` with table counts + schema SHA).
- [ ] **Rehearsal export** from the Cloud deployment (read-only; no freeze needed).
- [ ] Archive stored encrypted; URL/secrets never echoed.

### 5.2 Import procedure
- [ ] `scripts/migration/import.mjs` implemented (refuses non-empty target).
- [ ] **Rehearsal import** into the staging self-host instance (separate volume/compose project from production).

### 5.3 Validation
- [ ] `scripts/migration/validate.mjs` green: row-count parity per table, ID preservation, relationship probes, `schoolId` non-empty on all school-scoped rows, audit-log completeness, `files.storageId` resolution, users/roles parity.
- [ ] Functional suites green against the staging target: security-audit (71), phase7 (111), phase2 (72), phase3 (51), engines (23).
- [ ] `smoke.ts` gap accepted (needs `SEED_SECRET` — manual workflow checks substitute; README-migration §7).

### 5.4 Application verification (staging, on migrated data)
- [ ] **Authentication:** admin sign-in; activation/reset via one-time codes; portal access for guardian/teacher; sessions survive backend restart.
- [ ] **Schools:** platform console; request → approval → onboarding flow; multi-school switching.
- [ ] **Students:** records, guardians, enrollments; bulk import round-trip.
- [ ] **Teachers:** staff records, allocations, timetable surfaces.
- [ ] **Attendance:** daily + per-lesson registers; history/analytics.
- [ ] **Exams:** assessments, marks, results workflow (submit → approve → publish), report cards, promotions.
- [ ] **Finance:** fees, invoices, payments/receipts, student accounts, reconciliation (M-Pesa only if creds configured; graceful otherwise).
- [ ] **Reports:** report cards, financial reports, dashboards render correctly on migrated data.

### 5.5 Rollback (rehearsal level)
- [ ] Failed-import recovery drilled: restore empty volume / re-push empty schema → re-import.
- [ ] Restore-from-backup drill re-confirmed (links G1.3 test to real data volume).
- [ ] Rollback decision tree printed/rehearsed (CONVEX plan §6.3).

---

## 6. Email migration

Reference: EMAIL_RESEND_MIGRATION · G3 gate: abstraction code merged first.

- [ ] **Abstraction implemented** (`emailProvider.ts` + `communications.ts` + `emailOtp.ts` call sites) — Resend path dormant until `RESEND_API_KEY` set; Cloud behaviour unchanged.
- [ ] Resend account created; tier chosen (FREE = 100/day pilots; volume → PRO) — **OWNER DECISION REQUIRED**.
- [ ] **Sending domain verified** in Resend (SPF/DKIM DNS records on a subdomain, e.g. `mail.ooflowdesk.com`).
- [ ] From-address convention set (e.g. `SchoolCore <noreply@mail.ooflowdesk.com>`).
- [ ] `RESEND_API_KEY` added to `/etc/schoolcore/schoolcore.env` on `gman-02` only (never repo, never `VITE_*`).
- [ ] **OTP test:** request a sign-in code → delivered, branded, not spam-foldered.
- [ ] **Comm-queue test:** email bulk job transitions queued → sent with provider id; failure path still records `failureReason`.
- [ ] Rollback verified: unset `RESEND_API_KEY` → falls back to legacy path / graceful failure, no code rollback needed.

---

## 7. Production cutover

Reference: CONVEX_SELF_HOST_MIGRATION_PLAN §6 · G4 gate: full rehearsal + §5.4 green.

### 7.1 Freeze window
- [ ] Window scheduled + communicated (avoid term-start invoicing / exam weeks) — **OWNER DECISION REQUIRED** (target ≤ 60 min).
- [ ] Freeze mechanism executed (procedural — no in-product maintenance mode; CONVEX plan §8 item 2): suspend access/announce; source Cloud write-frozen.
- [ ] Freeze start timestamp recorded.

### 7.2 Final backup
- [ ] Final export from source (Cloud) → archive + manifest (same SHA as pushed schema).
- [ ] Pre-cutover backup of `gman-02` data volume + `/etc/schoolcore` (encrypted, off-site).
- [ ] Import into production self-host (empty target confirmed); structural validation green **before any DNS change**.
- [ ] Functional suites green on production target.

### 7.3 Cloudflare routing switch
- [ ] Re-route the three public hostnames to the `gman-02` tunnel (§2.6) — instant and instantly reversible.
- [ ] Post-switch smoke: sign-in, attendance mark, invoice create, announcement, report-card view.
- [ ] Unfreeze; hyper-care monitoring begins; freeze end timestamp recorded.

### 7.4 Monitoring
- [ ] Uptime probes green: app + API endpoints; dashboard via Cloudflare Access.
- [ ] Tunnel connector health green (alert if `cloudflared` disconnects).
- [ ] Error-rate watch (backend logs/dashboard) for the first 48 h.
- [ ] Disk, container-restart, TLS-expiry alerts active (§1.3/§2 tooling).
- [ ] M-Pesa callbacks received during freeze reconciled; SMS/email queues drained.
- [ ] Convex Cloud deployment kept **read-only operational** for the grace period (recommend 2 weeks — **OWNER DECISION REQUIRED**). No deletion without explicit Owner approval.

---

## 8. Future server migration procedure

> Portability contract (confirmed): migrating `gman-02` → `newhost` requires only **(1) restoring deployment state, (2) restoring secrets, (3) changing Cloudflare routing**. No application changes, no data transformation, no certificate work.

### 8.1 Prepare new host
1. Provision `newhost` (§1.4 baseline), install Docker/Compose (§2.1).
2. Recreate storage dirs (§2.2); deploy the **same compose file + pinned image tags** (§3/§4) — from the registry or re-loaded images.
3. Copy or re-create `/etc/schoolcore/schoolcore.env` (transfer out-of-band, encrypted; or re-enter values from the secret store). **No dotenvx — same env contract.**

### 8.2 Restore data
4. Restore the latest backup snapshot into `/var/lib/schoolcore/convex` on `newhost` (restic restore or volume copy), or take a fresh export/import cycle if a live migration is acceptable.
5. Start the stack; run `scripts/migration/validate.mjs` + functional suites against `newhost`'s API URL (staging hostname or local override first).

### 8.3 Switch over
6. Authorize a `cloudflared` connector for `newhost` (same tunnel) and re-point the three public hostnames' routing to it — instant, no DNS TTL involved.
7. Post-switch smoke (§7.3 list); monitor; decommission `gman-02` after the grace period.

### 8.4 Portability checklist (what makes this possible — keep true)
- [ ] Compose file + `deploy/Dockerfile` versioned in repo (no host-specific state).
- [ ] Image tags pinned; images pullable/pushable to a registry (or `docker save/load` documented).
- [ ] All state in volumes (`/var/lib/schoolcore/*`) — no app state in containers.
- [ ] Secrets fully external to images (`env_file`); re-creatable from the secret store.
- [ ] `VITE_CONVEX_URL` hostname stable (same domain after migration) or rebuild one image with the new API URL.
- [ ] Backups restorable to any Docker-capable host (documented restore command, tested).
- [ ] TLS terminates at Cloudflare's edge — no cert files to move.
- [ ] Cloudflare routing is the only traffic switch (tunnel hostnames re-pointed; instant).
- [ ] `cloudflared` credentials treated as secrets — new host's connector authorized from the secret store.

---

## Changelog

| Date | Change |
| --- | --- |
| 2026-09-26 | Checklist created from confirmed Owner decisions (domain, gman-02, portability, self-hosted Convex, no backend rewrite, server-managed secrets, Resend, Cloud untouched until cutover). Nothing executed. |
| 2026-09-26 | Ingress confirmed: Cloudflare Tunnel + Cloudflare Access; dashboard hostname `schoolcore-dashboard.ooflowdesk.com`; portability contract = restore state + secrets + Cloudflare routing. |
