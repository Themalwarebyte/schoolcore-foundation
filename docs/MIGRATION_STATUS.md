# Migration Status — Live Checklist

> **Status: MIGRATION COMPLETE (2026-09-29).** The Freebuff to self-host
> migration was executed and accepted. See
> **"Phase 6B/7 - PRODUCTION CUTOVER COMPLETED (2026-09-29)"** further down this
> same file, which is the authoritative record.
>
> **Current state is not in this file.** For the deployed SHA, open pilot
> blockers and known risks read
> [`SCHOOLCORE_CURRENT_STATE.md`](./SCHOOLCORE_CURRENT_STATE.md). For remaining
> work read [`PHASE8_ROADMAP.md`](./PHASE8_ROADMAP.md).
>
> **What follows this correction is historical record and is preserved as
> written.** The block below described the pre-cutover position and is retained
> because it is the evidence of what was decided and when:
>
> > **Status at the time (pre-cutover):** **PHASE 6B AUTH GATE CLOSED** - the
> > Freebuff to self-host migration is proven end-to-end against a real PROD
> > snapshot, including an **existing production password**. Remaining cutover
> > blockers are operational and security items, not migration compatibility.
> > Convex Cloud / Freebuff production remains **live and untouched** - no
> > permanent data migration, no cutover.
> >
> > **Rules in force at the time:** no data migration yet · no production
> > modification · no Convex Cloud changes · no secret values in the repo · no
> > destructive actions · no git-history purges.
>
> Confirmed decisions and the host-specific execution runbook live in
> [`SELF_HOST_EXECUTION_CHECKLIST.md`](./SELF_HOST_EXECUTION_CHECKLIST.md)
> (schoolcore.ooflowdesk.com on gman-02 — **Cloudflare Tunnel** ingress).
> The Convex dashboard is **intentionally unrouted and private**; Cloudflare
> Access is deferred by Owner decision (billing/setup) and MUST be in place
> before any dashboard route is ever created.

---

## How to use

- Checkbox legend: `[ ]` not started · `[x]` complete · items marked
  **(N/A — decision)** are closed by an explicit Owner decision rather than
  work.
- Every item links to the authoritative procedure in the prep docs.
- Blockers / owner decisions are called out inline with
  **OWNER DECISION REQUIRED**.
- Update the Progress snapshot and Changelog at the bottom whenever this file
  changes.

### Progress snapshot

> **Corrected 2026-09-30.** Phases 4, 6 and 7 below are marked as they were
> *before* cutover and are contradicted by the
> "Phase 6B/7 - PRODUCTION CUTOVER COMPLETED" section later in this file. The
> **Corrected as at cutover** column records the actual outcome. The original
> Status column is preserved as written. Current state beyond cutover is in
> [`SCHOOLCORE_CURRENT_STATE.md`](./SCHOOLCORE_CURRENT_STATE.md).

| Phase | Name | Status (as originally written) | Corrected as at cutover |
| --- | --- | --- | --- |
| 0 | Preparation (docs, plans, audits) | ✅ **DONE** | ✅ DONE |
| 1 | Repository security items below | ☐ Not started (dotenvx key confirmed orphaned) | ✅ DONE — see below |
| 2 | Infrastructure (gman-02, Docker, firewall, tunnel) | ✅ **DONE** | ✅ DONE |
| 3 | Self-hosted Convex (empty backend + PostgreSQL 17) | ✅ **DONE** | ✅ DONE |
| 4 | Data migration | REHEARSED against a real Freebuff PROD snapshot - final import pending cutover | ✅ **DONE** — 666 documents imported 2026-09-29 |
| 5 | Application verification | ✅ **DONE** (Phase 5A code + Phase 5B deployment) | ✅ DONE |
| 6 | Email migration (Resend) | PARTIAL - EMAIL DELIVERY NOT PRODUCTION READY | ✅ **DONE** — Resend delivery verified in production |
| 7 | Cutover | BLOCKED - write-freeze + owner security actions | ✅ **DONE** — cutover completed, owner accepted |

The §2–§7 checkbox items below are a **pre-cutover snapshot frozen at
2026-09-26**. Many remain unchecked because they were completed after the
freeze and were never back-filled. They are preserved as written for audit.
Where they conflict with the outcome above, the outcome is correct.

---

## 1. Repository Security

Reference: [`SECRET_MANAGEMENT_GUIDE.md`](./SECRET_MANAGEMENT_GUIDE.md) · Production Audit P1.

### 1.1 Secret rotation
- [x] Audit: no secrets tracked anywhere in the repo (Production Audit P1 — verified).
- [x] Rotation needed: **none found** — nothing requires rotation today (N/A — verified).
- [ ] At cutover: set fresh values for all §3.2–3.3 server vars on the new host (never copy-paste the Cloud values where rotation is cheap — platform admin password, M-Pesa credentials if re-issued, `RESEND_API_KEY` is new by construction).
- [ ] Post-cutover: record rotation schedule (platform admin password, API keys) in the server runbook — cadence **OWNER DECISION REQUIRED**.
- [ ] Go-live check: confirm `SEED_SECRET` is **absent** on the production server.

### 1.2 Git history cleanup
- [x] Audit: no secrets in tracked files; nothing in history requires rotation (P1).
- [x] Decision recorded: **no history purge** (standing rule) — leaked values would be rotated, not rewritten (N/A — decision).
- [ ] Before cutover: re-run the repo secret scan (`scripts/security-audit.mjs` P1-equivalent checks) as a final gate.
- [ ] Never commit migration archives: add `migration/` to `.gitignore` when `scripts/migration/` lands (see [`scripts/README-migration.md`](../scripts/README-migration.md) §1).

### 1.3 Documentation updates
- [x] `docs/production-deployment.md` §3 updated: `RESEND_API_KEY` (future), `VLY_EMAIL_OTP_API_KEY` marked sunset-at-cutover.
- [x] Self-host prep doc set created (6 documents + this one).
- [ ] Update `.env.example` (manual Owner edit — platform blocks agent edits): add `RESEND_API_KEY=` placeholder.
- [ ] Mark each doc's `> Status:` banner as EXECUTED as its phase completes.
- [ ] Post-cutover: revise `docs/production-deployment.md` for self-host assumptions (§2 Convex deployment creation, §6 domain setup).

### 1.4 Dotenvx removal (proposals — Owner approval pending)
- [x] Audit: zero dotenvx dependency in code, scripts, CI, or docs (SECRET_MANAGEMENT_GUIDE §2).
- [ ] **OWNER DECISION REQUIRED:** approve cleanup C1 (delete local untracked `.env.keys`).
- [x] C2 (code adjustments): none required — verified no code references dotenvx (N/A — verified).

---

## 2. Infrastructure

Reference: [`SERVER_DEPLOYMENT_GUIDE.md`](./SERVER_DEPLOYMENT_GUIDE.md) §2–§6 · sizing in [`SELF_HOSTING_GUIDE.md`](./SELF_HOSTING_GUIDE.md) §4.

### 2.1 Host selection
- [ ] Choose provider/VM (Docker-capable Linux, sizing per SELF_HOSTING_GUIDE §4) — **OWNER DECISION REQUIRED**.
- [ ] Provision OS user (`schoolcore`), SSH key-only + fail2ban, `unattended-upgrades`.

### 2.2 Docker
- [ ] Install Docker Engine 24+ and Compose v2.
- [ ] Create persistent layout: `/var/lib/schoolcore/{convex,backups}`.
- [ ] Add `deploy/Dockerfile` + `deploy/compose.yaml` to the repo at execution time (proposed shapes in SERVER_DEPLOYMENT_GUIDE §3).
- [ ] Verify app image builds off-box (never build on the VM — OOM history).

### 2.3 Networking & ingress (Cloudflare Tunnel — confirmed)
- [x] Hostnames confirmed: `schoolcore.ooflowdesk.com` (app) · `schoolcore-api.ooflowdesk.com` (backend) · `schoolcore-dashboard.ooflowdesk.com` (dashboard).
- [ ] Cloudflare Tunnel created; `cloudflared` connector running on `gman-02` (outbound-only — no inbound web ports).
- [ ] Three public hostnames routed as proxied CNAMEs to the tunnel (SERVER_DEPLOYMENT_GUIDE §4.1).
- [ ] Firewall: default-deny incoming; allow 22 only.

### 2.4 TLS (Cloudflare edge — confirmed)
- [ ] Cloudflare edge certificates active for all three hostnames (no origin certs).
- [ ] WebSockets enabled; Always-HTTPS; HSTS after stability.

### 2.5 Backups
- [ ] Backup tooling configured (`restic` or equivalent) per SERVER_DEPLOYMENT_GUIDE §5.
- [ ] Off-site target selected (S3-compatible or second host) — **OWNER DECISION REQUIRED**.
- [ ] First **tested restore** completed (quarterly cadence thereafter).
- [ ] Confirm backup target is treated as secret-sensitive (includes env file).

### 2.6 Monitoring
- [ ] Uptime probes: app URL + backend HTTP endpoint.
- [ ] Tunnel connector health monitored (alert if `cloudflared` disconnects).
- [ ] Disk alerts (data volume > 80%), container restart-loop alerts.
- [ ] Alert channel decided (email via Resend post-Phase 6, or SMS) — **OWNER DECISION REQUIRED**.

---

## 3. Self-hosted Convex

Reference: [`SERVER_DEPLOYMENT_GUIDE.md`](./SERVER_DEPLOYMENT_GUIDE.md) §3/§8 · [`CONVEX_SELF_HOST_MIGRATION_PLAN.md`](./CONVEX_SELF_HOST_MIGRATION_PLAN.md) §3.

### 3.1 Deployment
- [ ] Backend container running (official self-hosted image, per version-pinned docs).
- [ ] Persistent data volume attached; restart policies `unless-stopped`.

### 3.2 Version pinning
- [ ] Pin backend image version to match Convex Cloud-era CLI (`convex ^1.46.0` in devDependencies) — verify export/import compatibility (CONVEX plan §8 item 1).
- [ ] Record the pinned version + image digest in the server runbook.

### 3.3 Environment setup
- [ ] `/etc/schoolcore/schoolcore.env` created (0600 root:root) from SECRET_MANAGEMENT_GUIDE §4 template.
- [ ] `SEED_SECRET` deliberately absent; `NODE_ENV=production`; `SITE_URL`/`CONVEX_SITE_URL`/`VITE_CONVEX_URL` match public hostnames.

### 3.4 Function deployment
- [ ] `bunx convex push` against self-hosted backend creates all 125 tables + 315 indexes (schema source: `src/convex/schema.ts` + `schemaPhase7.ts`).
- [ ] Record pushed git SHA in the migration manifest (schema-parity gate, README-migration §5).

### 3.5 Dashboard
- [ ] Dashboard container running; hostname configured.
- [ ] **Cloudflare Access** application protecting the dashboard (not public) — SERVER_DEPLOYMENT_GUIDE §9.

---

## 4. Data Migration

Reference: [`CONVEX_SELF_HOST_MIGRATION_PLAN.md`](./CONVEX_SELF_HOST_MIGRATION_PLAN.md) §4–§5 · [`scripts/README-migration.md`](../scripts/README-migration.md).

> Whole-deployment unit only — never partial/per-table (ID-space reasons, CONVEX plan §2.2). Always into an **empty** target.

### 4.1 Export
- [ ] `scripts/migration/export.mjs` implemented + manifest format agreed (README-migration §2).
- [ ] **Rehearsal export** from Cloud → staging archive (no freeze needed).
- [ ] Final export during the cutover freeze (§7).

### 4.2 Import
- [ ] `scripts/migration/import.mjs` implemented (refuses non-empty target).
- [ ] Rehearsal import into staging self-host instance.
- [ ] Final import during cutover window.

### 4.3 Validation
- [ ] `scripts/migration/validate.mjs` implemented (7 checks, README-migration §3).
- [ ] Rehearsal validation fully green (counts, IDs, relationships, tenancy, audit logs, storage, users/permissions).
- [ ] Functional suites green against target: security-audit (71), phase7 (111), phase2 (72), phase3 (51), engines (23).
- [ ] Known gap accepted: `smoke.ts` not run (needs `SEED_SECRET`; manual workflow checks substitute — README-migration §7).

### 4.4 Tenant isolation testing
- [ ] `security-audit.mjs` tenant-isolation sections pass on the target.
- [ ] Manual cross-school probes: signed-in user from school A cannot read school B records (spot-check students/invoices/announcements via API).
- [ ] Every school-scoped document verified to carry non-empty `schoolId` (validator check) — 121/125 tables; 4 platform-scoped tables excluded by design.

---

## 5. Application Verification

> Run against the self-hosted target after data import. Suites cover the engine level; manual checks cover the user-visible workflow end-to-end. Map of suites: `scripts/` (security 71, phase7 111, phase2 72, phase3 51, engines 23).

- [ ] **Authentication** — admin sign-in; password set/reset via `/activate` + `/reset-password` (one-time codes, 7-day expiry); parent/guardian portal access; session persistence across restart.
- [ ] **Schools** — school request → approval → onboarding (profile, academics, users, activate) via platform console; multi-school switching for staff in several schools.
- [ ] **Students** — student records, guardian links, enrollments; bulk import (preview → commit) round-trip on migrated data.
- [ ] **Teachers** — staff records, teacher allocations, timetable surfaces.
- [ ] **Attendance** — daily + per-lesson registers; history/analytics views.
- [ ] **Exams** — assessments, marks entry, results workflow (submit → approve → publish), report cards, promotions.
- [ ] **Finance** — fees/fee items, invoices, payments & receipts, student accounts, reconciliation; M-Pesa callback path only if credentials configured on the target (degrades gracefully otherwise).
- [ ] **Reports** — report cards, financial reports, dashboards/analytics render on migrated data.

---

## 6. Email Migration

Reference: [`EMAIL_RESEND_MIGRATION.md`](./EMAIL_RESEND_MIGRATION.md).

> Code abstraction lands as Phase 4 of SELF_HOSTING_GUIDE §3 — before cutover. Current Cloud email paths stay untouched until then.

- [ ] Resend account created (tier per expected volume — **OWNER DECISION REQUIRED**; FREE = 100/day adequate for pilots).
- [ ] Sending domain verified (SPF/DKIM DNS records) — **OWNER DECISION REQUIRED** (domain).
- [ ] From-address convention set (e.g. `SchoolCore <noreply@mail.…>`).
- [ ] Email provider abstraction implemented (`emailProvider.ts` + 2 call-site changes; behaviour unchanged on Cloud until `RESEND_API_KEY` set).
- [ ] `RESEND_API_KEY` added to the target env file (server-side only, never `VITE_*`, never committed).
- [ ] OTP test: request sign-in code → delivered, correctly branded, no spam folder.
- [ ] Comm-queue test: email-channel bulk job transitions queued → sent with provider message id; failure path still records `failureReason` correctly.
- [ ] `VLY_EMAIL_OTP_API_KEY` provider retired at cutover (confirmed): remove the VLY OTP fallback (EMAIL_RESEND_MIGRATION §5 step 5).

---

## 7. Cutover

Reference: [`CONVEX_SELF_HOST_MIGRATION_PLAN.md`](./CONVEX_SELF_HOST_MIGRATION_PLAN.md) §6 · rollback: §6.3 + [`SELF_HOSTING_GUIDE.md`](./SELF_HOSTING_GUIDE.md) §6.

### 7.1 Freeze window
- [ ] Freeze mechanism chosen (no in-product maintenance mode exists — procedural freeze per CONVEX plan §8 item 2) — **OWNER DECISION REQUIRED**.
- [ ] Window scheduled + communicated to schools (avoid term-start invoicing / exam weeks) — **OWNER DECISION REQUIRED** (date, target ≤ 60 min).
- [ ] Freeze executed; source deployment write-frozen; final export taken.

### 7.2 Final backup
- [ ] Pre-cutover backup of target data volume + config archived (encrypted, off-site).
- [ ] Migration archive (final export) stored encrypted; manifest recorded (schema SHA, CLI version).
- [ ] Import + structural validation green inside the window before any DNS change.

### 7.3 Cloudflare routing switch
- [ ] Functional suites green on target.
- [ ] Public hostnames re-routed to the `gman-02` tunnel (instant; instantly reversible).
- [ ] Post-cutover smoke: sign-in, attendance mark, invoice create, announcement send.
- [ ] Unfreeze announcement; hyper-care monitoring begins.

### 7.4 Rollback readiness
- [ ] Decision tree rehearsed/printed: abort before DNS (source untouched) → roll-forward vs DNS-back after switch (CONVEX plan §6.3).
- [ ] Convex Cloud deployment kept **read-only operational** for the grace period (recommend 2 weeks) — **OWNER DECISION REQUIRED** (duration).
- [ ] Post-switch data-reconciliation plan agreed (M-Pesa callbacks received during freeze, any writes on self-host before rollback).
- [ ] Decommission plan for Cloud after grace period (Phase 7; requires Owner sign-off — **no deletion without explicit approval**).

---

## 5A. Application / auth / frontend code readiness (Phase 5A)

> Repository-only phase. Nothing was deployed. Convex Cloud untouched.
> Branch: `phase5-selfhost-readiness` (based on `origin/main` `d4cc5b4`).

### 5A.1 Self-host auth strategy
- [x] Standard Convex Auth provider stays first, `domain: process.env.CONVEX_SITE_URL`.
- [x] Freebuff `customJwt` provider made **opt-in** (`src/convex/auth/freebuff.ts`).
- [x] **Deployment requirement discovered:** the Convex Auth CLI requires every env var referenced anywhere in the auth-config import graph to be *set* in the target deployment, even when the code guards for absence. This is transitive and is not evaded by moving the reference or by computed lookup. **Self-host must set `VLY_CONVEX_AUTH_ISSUER` to an empty value** to satisfy the CLI while keeping the provider unregistered.
- [ ] Convex Cloud: confirm `VLY_CONVEX_AUTH_ISSUER` is still set to the real issuer (federated sign-in must keep working until cutover).
- [ ] Self-host: `npx convex env set VLY_CONVEX_AUTH_ISSUER ""` (empty).

### 5A.2 Resend email
- [x] `src/convex/emailProvider.ts` created — Resend-first, legacy VLY fallback, explicit failure when unconfigured.
- [x] `auth/emailOtp.ts` transport swapped; OTP generation, 6-digit length, 15-min expiry, provider id `email-otp` and verification behaviour unchanged.
- [x] No OTP value or Resend error body (may echo recipients) written to logs.
- [x] `RESEND_FROM_EMAIL` supported; documented that a **verified sending domain is required** for real recipients (fallback is Resend onboarding, owner-mailbox-only).
- [ ] Owner: provision Resend domain + set `RESEND_FROM_EMAIL` / `RESEND_API_KEY` on the self-host deployment.
- [ ] Communications-queue email channel (`phase6/communications.ts`) is still a **stub** — wiring it to the provider is deliberately deferred, see `EMAIL_RESEND_MIGRATION.md` §2.

### 5A.3 Frontend container
- [x] `Dockerfile.frontend` (multi-stage, bun build → nginx runtime), base images pinned **by digest**.
- [x] `deploy/nginx-frontend.conf` — SPA fallback, long cache on hashed assets, `index.html` explicitly no-cache, `/healthz`, dotfiles denied, security headers.
- [x] `.dockerignore` excludes `.env*`, keys, backups, docs, `node_modules` — no secret can enter the build context.
- [x] Service name `schoolcore-frontend`, internal port 80, attaches to `schoolcore-net`; **no host port**.
- [ ] Build the image and start it (Phase 5B). `schoolcore.ooflowdesk.com` currently returns the expected 502 because this container does not exist yet.

### 5A.4 Build variables
- [x] Frontend consumes only `VITE_CONVEX_URL`, `VITE_VLY_APP_ID`, `VITE_VLY_MONITORING_URL`. No new `VITE_` variable invented.
- [x] Built bundle scanned: no `RESEND_API_KEY`, `JWT_PRIVATE_KEY`, `JWKS`, `INSTANCE_SECRET`, `POSTGRES_PASSWORD`, admin key, tunnel token or VLY key. No `127.0.0.1`.
- [x] `VITE_CONVEX_URL` must be the **backend** (3210) origin, never the `.convex.site`/site origin — the Convex client throws for `.convex.site`. Documented at the call site.

### 5A.5 Local validation (this phase)
- [x] `bun install --frozen-lockfile` — 405 packages, `bun.lock` unchanged.
- [x] Convex codegen generated from a **local Docker deployment** (no production, no gman-02).
- [x] `tsc --noEmit` app + convex: clean.
- [x] `bun run lint`: 0 errors (48 pre-existing warnings).
- [x] `bun run build`: success.
- [ ] Verification scripts (`scripts/*.ts`) not run — they need a seeded deployment and must never be pointed at production.

### 5A.6 Auth key generation (NOT done — procedure only)
- [ ] Generate `JWT_PRIVATE_KEY` + `JWKS` **on gman-02** and set them on the self-hosted deployment through the authenticated Convex CLI. Never in this repo, never in chat. Procedure: `SELF_HOSTING_GUIDE.md`.

---


---

## 6A / 6B. Migration verification results

All checks executed against a **real Freebuff PROD snapshot**
(`d1e982a8-...zip`, sha256 `ce49b9f1...a01a9`).

| Gate | Result |
|---|---|
| PHASE 6A rehearsal | **PASS** |
| Real PROD snapshot import | **PASS** (673 docs, 11 s) |
| Table counts | **PASS** - 0 discrepancies |
| `_id` preservation | **PASS** - identical sets |
| `_creationTime` preservation | **PASS** - 100% |
| Relationship integrity | **PASS** - 0 orphans |
| Tenant isolation | **PASS** - cross-tenant blocked |
| Auth component migration | **PASS** - accounts/sessions/tokens |
| **Existing production password migration** | **PASS** |
| Application user resolution | **PASS** |
| Tenant resolution | **PASS** |
| Self-host JWT issuance | **PASS** |
| Anonymous public-data exposure | **PASS** - 0 endpoints exposed data |
| Clean-state restore | **PASS** - 0 production records remain |

No email address, password, hash, JWT, refresh token, or personal record
content is recorded in this document.

### Remaining blockers (operational / security, not migration)

    1. Freebuff **write-freeze mechanism** unverified - primary cutover gate
    2. Compromised production password **rotation in Freebuff** (before final backup)
    3. `SEED_SECRET` removal from Freebuff production
    4. `VLY_INTEGRATION_KEY` removal + issuer-side revocation
    5. Git history purge (all 3 branches + 22 tags) - COMPLETE, pushed
    6. Resend sending domain verification - COMPLETE
    7. Off-site backup provider selection
    8. Owner maintenance window and explicit GO

### Phase 6C - email and signing-key readiness

| Item | Status |
|---|---|
| Resend sending domain | `mail.ooflowdesk.com` - **VERIFIED** (since 2026-08-03, eu-west-1) |
| SPF | `send.mail.ooflowdesk.com` -> `include:amazonses.com` |
| DKIM | `resend._domainkey.mail.ooflowdesk.com` |
| Sender | `SchoolCore <noreply@mail.ooflowdesk.com>` |
| Direct transport test | **PASS** (Resend HTTP 200, accepted) |
| Final delivery state | **delivered** |
| Owner mailbox receipt | **confirmed** by the owner |
| **EMAIL STATUS** | **PRODUCTION READY** |
| AUTH OTP TRANSPORT | CONFIGURED |
| FRONTEND OTP FLOW | **NOT ENABLED** (no UI exists; password sign-in only) |
| Self-host JWT signing keypair | **ROTATED** - old pair compromised, new RS256 pair active |
| **JWT AUTH STATUS** | **PRODUCTION READY** |

The self-host `JWT_PRIVATE_KEY` was partially exposed in command output by an
agent error (a multiline secret was parsed out of `convex env list`). It was
rotated immediately: the old keypair is deactivated and its tokens no longer
verify. No Freebuff or Convex Cloud signing material was involved.

The owner/admin mailbox is recorded in the runbook as an **operational
convention for administrative sends** (infrastructure alerts, owner
notifications, controlled delivery tests). It is deliberately **not** wired into
application code: no `PLATFORM_ADMIN_EMAIL` bootstrap credential was created or
restored, and no new environment variable was introduced. It must never be used
as a sender address, as a student/guardian/staff address, or as a credential.


### Phase 6C - encrypted off-site backup (Google Drive)

| Item | Status |
|---|---|
| Provider | **Google Drive** (encrypted off-site tier) |
| Account | dedicated backup account, owner-controlled |
| Remote / scope | `schoolcore-drive` / `drive.file` (files it creates only) |
| Folder / repository | `SchoolCore-Backups` / `restic` sub-path |
| Restic | **0.18.0**, repository encrypted, password-wrapped master key |
| Restic password | generated on gman-02, root:root 0600, **off-server copy verified** |
| First snapshot | created and readable; `restic check` **no errors** |
| Restore test | **PASS** - disposable PostgreSQL restore, plaintext shredded |
| Retention | 14 daily / 8 weekly / 12 monthly / 2 yearly, Restic-managed |
| Schedule | systemd timer 02:30 Europe/London (04:30 EAT during BST), Persistent=true |
| Health check | **HEALTHY** |
| Plaintext artefacts on Drive | **none** - only the encrypted repository is stored |

Backup never requires application downtime: the PostgreSQL logical dump runs
against the live container while the SchoolCore stack keeps serving.


### Phase 6B/7 - PRODUCTION CUTOVER COMPLETED (2026-09-29)

| Item | Value |
|---|---|
| Completion date | 2026-09-29 |
| Source deployment | Freebuff / Convex Cloud `kindhearted-goldfish-282` (**PAUSED ARCHIVE**) |
| Final source snapshot | `0ad7eaf0-ba69-45c6-8bbf-3bea8e7c364a.zip` (101,268 bytes) |
| Snapshot SHA256 | `539ef46b08df9b82c1c17710593faf67ad3c8310ccf40de5f8b152abab19e765` |
| Transfer verification | SHA256 matched workstation and server exactly |
| Import | **666 documents**, replacement semantics, **12 seconds** |
| Count verification | **PASS** - every table signature delta 0 |
| `_id` preservation | **PASS** - sampled IDs found in destination across 6 tables |
| `_creationTime` preservation | **PASS** |
| Relationship integrity | **PASS** - 0 orphans across 5 relationship types |
| Tenant isolation | **PASS** - cross-tenant blocked, own-school allowed, anonymous blocked |
| Migrated authentication | **PASS** - existing production credential authenticates on self-host |
| Application smoke test | **PASS** |
| Owner browser acceptance | **PASS** - `SCHOOLCORE SELF-HOST PRODUCTION ACCEPTED` |
| Public endpoint health | **PASS** - frontend / API / OIDC / JWKS all HTTP 200 |
| Convex dashboard | private, no public DNS |
| SchoolCore host-published ports | **0** |
| `/srv/platform` | untouched throughout |
| First live production backup | snapshot `bea9a61c`, 2026-09-29T16:28:38Z, dump 3,127,482 B |
| Off-site backup | **PASS** - Restic/Google Drive, `restic check` no errors, health HEALTHY |
| Rollback | **READY** - pre-cutover backup, frozen Freebuff snapshot, 5 Restic snapshots |

### Production endpoints
| Purpose | URL |
|---|---|
| Frontend | `https://schoolcore.ooflowdesk.com` |
| Convex API | `https://schoolcore-api.ooflowdesk.com` |
| Convex site / OIDC | `https://schoolcore-site.ooflowdesk.com` |
| Convex dashboard | internal only, no public route |

## Changelog

| Date | Change |
| --- | --- |
| 2026-09-26 | Checklist created. Phase 0 (preparation) complete; all execution items open. |
| 2026-09-26 | Owner decisions updated: Resend email (`RESEND_API_KEY`; VLY provider retired at cutover), Cloudflare Tunnel ingress + Access-protected dashboard, hostnames finalized, portability = restore state + secrets + Cloudflare routing. |
| 2026-09-27 | **Phase 4 complete** — empty self-hosted Convex on gman-02: PostgreSQL 17.11, Cloudflare Tunnel connected, API + site hostnames live, dashboard private/unrouted, restore test passed. |
| 2026-09-27 | **Phase 5A** — branch `phase5-selfhost-readiness` off `d4cc5b4`. Opt-in Freebuff provider, Resend email adapter, frontend container + nginx config, `.env.example` corrected. Dashboard Access deferred by Owner decision (billing); dashboard stays unrouted. |
| 2026-09-27 | **Phase 5B DEPLOYED** — commit `df14e98` deployed to gman-02. Convex functions/schema deployed to the self-hosted backend (PostgreSQL, no SQLite). Convex Auth configured with self-generated RS256 keys. `schoolcore-frontend` built and serving; `schoolcore.ooflowdesk.com` returns HTTP 200. Password auth verified end-to-end with controlled synthetic test data. Post-deployment backup created. **No production data migrated; Convex Cloud untouched.** |
| 2026-09-28 | Phase 6B authorization fix applied — `/activate` route added, `VLY_INTEGRATION_KEY` / `SEED_SECRET` removed from the self-host deployment, `SECURITY.md` updated with the no-auto-provisioning guarantee. |
| 2026-09-29 | **Phase 6B/7 PRODUCTION CUTOVER COMPLETED** — 666 documents migrated with every verification PASS (counts, IDs, creation times, relationships, tenant isolation, existing-credential authentication, owner browser acceptance). See the cutover section above. |
| 2026-09-29 | **Phase 8 opened.** Authorization validation found two pilot-blocking defects; both subsequently fixed — student horizontal access (`db1fe52`) and PB-2 `staff:get` (`d9ba8b7`). |
| 2026-09-30 | **Monitoring corrective pass** — three critical defects found and fixed in the monitoring and alerting implementation, including an alerting path that had never been able to send a DEGRADED or CRITICAL alert. |
| 2026-09-30 | **Documentation reconciliation** — banner and Progress snapshot corrected; historical record preserved as written; authoritative current state moved to `SCHOOLCORE_CURRENT_STATE.md` and `PHASE8_ROADMAP.md`. No application, dependency, infrastructure or deployment change. |

---

## Standing reminder

> **Superseded 2026-09-30.** The reminder below applied **before** cutover and
> is preserved as written. Cutover completed on 2026-09-29, so the "until cutover
> completes and the grace period ends" condition has been reached.
> Freebuff/Convex Cloud is now a **PAUSED ARCHIVE / ROLLBACK REFERENCE** — not
> resumed, not deleted, and not to be resumed casually. The "no gate may be
> skipped" rule still applies to Phase 8; see `PHASE8_ROADMAP.md`.

No item above may be executed ahead of its phase gate, and **no gate may be
skipped**: preparation → infrastructure → self-hosted Convex → data
rehearsal → verification → email → cutover. The current Freebuff/Convex Cloud
deployment must remain fully functional until cutover completes and the
grace period ends.
