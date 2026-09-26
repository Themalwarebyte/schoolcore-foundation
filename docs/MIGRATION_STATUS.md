# Migration Status — Live Checklist

> **Status:** PREPARATION COMPLETE · EXECUTION NOT STARTED. This is the
> working checklist for the Cloud → self-hosted migration. Update it as each
> item completes. Documentation only — nothing here has been executed; the
> Freebuff/Convex Cloud deployment remains live and untouched.
>
> **Rules in force:** no data migration yet · no production modification · no
> Convex Cloud changes · no secret values in the repo · no destructive
> actions · no git-history purges.
>
> Confirmed decisions and the host-specific execution runbook live in
> [`SELF_HOST_EXECUTION_CHECKLIST.md`](./SELF_HOST_EXECUTION_CHECKLIST.md)
> (schoolcore.ooflowdesk.com on gman-02).

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

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Preparation (docs, plans, audits) | ✅ **DONE** |
| 1 | Repository security items below | ☐ Not started |
| 2 | Infrastructure | ☐ Not started |
| 3 | Self-hosted Convex | ☐ Not started |
| 4 | Data migration (rehearsal → final) | ☐ Not started |
| 5 | Application verification | ☐ Not started |
| 6 | Email migration (Resend) | ☐ Not started |
| 7 | Cutover | ☐ Not started |

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

### 2.3 Networking
- [ ] DNS records: app, API/backend, dashboard hostnames — **OWNER DECISION REQUIRED** (names).
- [ ] Firewall: default-deny incoming; allow 22/80/443 only.
- [ ] Reverse proxy routes: app → SPA, api → Convex backend, dashboard → admin UI (SERVER_DEPLOYMENT_GUIDE §4.1).

### 2.4 TLS
- [ ] ACME certificates issuing + auto-renewing (Caddy recommended).
- [ ] Verify TLS on all three hostnames; enable HSTS after stability.

### 2.5 Backups
- [ ] Backup tooling configured (`restic` or equivalent) per SERVER_DEPLOYMENT_GUIDE §5.
- [ ] Off-site target selected (S3-compatible or second host) — **OWNER DECISION REQUIRED**.
- [ ] First **tested restore** completed (quarterly cadence thereafter).
- [ ] Confirm backup target is treated as secret-sensitive (includes env file).

### 2.6 Monitoring
- [ ] Uptime probes: app URL + backend HTTP endpoint.
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
- [ ] IP-allowlist or SSO gate applied (not public) — SERVER_DEPLOYMENT_GUIDE §9.

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
- [ ] Sunset decision at cutover: remove VLY OTP fallback (EMAIL_RESEND_MIGRATION §5 step 5).

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

### 7.3 DNS switch
- [ ] Functional suites green on target.
- [ ] DNS / reverse proxy re-pointed to self-host (TTL pre-lowered).
- [ ] Post-cutover smoke: sign-in, attendance mark, invoice create, announcement send.
- [ ] Unfreeze announcement; hyper-care monitoring begins.

### 7.4 Rollback readiness
- [ ] Decision tree rehearsed/printed: abort before DNS (source untouched) → roll-forward vs DNS-back after switch (CONVEX plan §6.3).
- [ ] Convex Cloud deployment kept **read-only operational** for the grace period (recommend 2 weeks) — **OWNER DECISION REQUIRED** (duration).
- [ ] Post-switch data-reconciliation plan agreed (M-Pesa callbacks received during freeze, any writes on self-host before rollback).
- [ ] Decommission plan for Cloud after grace period (Phase 7; requires Owner sign-off — **no deletion without explicit approval**).

---

## Changelog

| Date | Change |
| --- | --- |
| 2026-09-26 | Checklist created. Phase 0 (preparation) complete; all execution items open. |

---

## Standing reminder

No item above may be executed ahead of its phase gate, and **no gate may be
skipped**: preparation → infrastructure → self-hosted Convex → data
rehearsal → verification → email → cutover. The current Freebuff/Convex Cloud
deployment must remain fully functional until cutover completes and the
grace period ends.
