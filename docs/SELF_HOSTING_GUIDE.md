# SchoolCore — Self-Hosting Guide

> **Status:** PREPARATION. Nothing in this document has been executed against a
> live deployment. The current Freebuff/Convex Cloud deployment remains the
> production system of record until the cutover decision is made
> (**OWNER DECISION REQUIRED**).

---

## 0. Related documents

| Document | Purpose |
| --- | --- |
| [`docs/CONVEX_SELF_HOST_MIGRATION_PLAN.md`](./CONVEX_SELF_HOST_MIGRATION_PLAN.md) | Cloud → self-hosted Convex approach, schema/data migration, verification, cutover |
| [`docs/SERVER_DEPLOYMENT_GUIDE.md`](./SERVER_DEPLOYMENT_GUIDE.md) | Docker, reverse proxy, TLS, backups, monitoring, env setup on the server |
| [`docs/SECRET_MANAGEMENT_GUIDE.md`](./SECRET_MANAGEMENT_GUIDE.md) | No secrets in GitHub; server-managed secrets; env-var inventory |
| [`docs/EMAIL_RESEND_MIGRATION.md`](./EMAIL_RESEND_MIGRATION.md) | Email service audit, Resend abstraction plan, migration steps |
| [`scripts/README-migration.md`](../scripts/README-migration.md) | Migration tool documentation (export/import/validate/rollback scripts) |
| [`docs/production-deployment.md`](./production-deployment.md) | Current deployment walkthrough (§3 env-var inventory is authoritative) |
| [`docs/demo-accounts.md`](./demo-accounts.md) | Demo data & accounts reference |

---

## 1. Current architecture

```
Browser (React SPA — src/)
  │  WebSocket + HTTPS
  ▼
Convex Cloud deployment (managed)
  ├─ Convex functions      src/convex/  (125 tables, 315 indexes)
  ├─ Convex Auth           src/convex/auth/  (session-based; OTP e-mail via VLY gateway)
  ├─ File storage          Convex file storage (files table + storageId references)
  └─ Env/secret store      deployment env (Keys UI / convex env set)
       ▲
       │  HTTPS (server actions)
VLY platform integration (@vly-ai/integrations)
  ├─ AI actions            src/convex/phase6-ai/  (VLY_INTEGRATION_KEY)
  ├─ Email OTP gateway     src/convex/auth/emailOtp.ts  (VLY_EMAIL_OTP_API_KEY)
  └─ Toolbar/dev tooling   vly-toolbar-readonly.tsx  (dev-only)

Static hosting: platform-managed static host serving dist/ (Vite build)
CI/CD: Freebuff platform (managed build: tsc -b && vite build → deploy)
Local: Bun scripts + verification suites in scripts/ (URL-parameterised)
```

### What is Freebuff-specific today

| Dependency | Where used | Self-host impact |
| --- | --- | --- |
| VLY integration SDK (`@vly-ai/integrations`) | `src/lib/vly-integrations.ts`, `src/convex/phase6-ai/` | Must be replaced or disabled; token is VLY-specific |
| VLY email OTP gateway | `src/convex/auth/emailOtp.ts` → `auth.freebuff.app/send_otp` | Replace with Resend (see EMAIL_RESEND_MIGRATION.md) |
| Freebuff static hosting + managed build | deployment pipeline | Replaced by Docker + reverse proxy (SERVER_DEPLOYMENT_GUIDE) |
| Freebuff Keys UI / `convex env set` | secret management | Replaced by server env files/secret store (SECRET_MANAGEMENT_GUIDE) |
| `vly-toolbar-readonly.tsx` | dev toolbar | Dev-only; exclude from self-host build |
| `sst-env.d.ts`, orphan `convex/crons.ts` | legacy artifacts | Cleanup candidates (no importers) |

### What is Freebuff-neutral

- All domain logic (125 tables, 49+ modules) is pure Convex functions.
- Auth is **Convex Auth** (session-based, in-database sessions) — portable.
- Multi-school tenancy is enforced in-function via `schoolId` scoping — portable
  as long as data migrates with `schoolId` intact.
- The React SPA builds to a static `dist/` any web server can serve.
- Root `main.ts` (Hono/Deno) already demonstrates serving `dist/` from a
  generic server — the pattern the Docker target formalises.

---

## 2. Target architecture

```
Docker Compose stack (single VM, or VM per container on larger hosts)
  ┌──────────────────────────────────────────────────────────────┐
  │  reverse proxy (Traefik/Caddy/Nginx) — TLS termination        │
  │    app.schoolcore.example    → app container (static dist/)   │
  │    api.schoolcore.example    → convex backend container       │
  └──────────────────────────────────────────────────────────────┘
       │                                    │
       ▼                                    ▼
  app container                        convex backend container
  (nginx serving dist/,                (self-hosted Convex backend
   container-internal)                  + dashboard, Convex 1.46+)
       │                                    │
       └──────────────┬─────────────────────┘
                      ▼
            persistent volume
      (Convex backend data + file storage)
                      │
                      ▼
              backup volume / remote backup target
```

Key properties:

- **Static SPA** served by any web server; Vite build is platform-neutral.
- **Convex backend self-hosted** via the official self-hosted build (see
  [Convex self-hosting docs](https://docs.convex.dev/production/hosting/self-hosting)).
- **Storage** stays inside Convex (self-hosted backend includes file storage);
  documents reference `storageId`s exactly as today.
- **Secrets** injected via environment variables from the server's secret
  store (no dotenvx, no `.env.keys`) — see SECRET_MANAGEMENT_GUIDE.md.
- **Resend** replaces the VLY email gateway for all e-mail sending.
- **No dotenvx / `.env.keys`** anywhere in the target stack.

---

## 3. Migration phases

| # | Phase | Summary | Status |
| --- | --- | --- | --- |
| 0 | **Preparation** | Docs, scripts, plans, Resend abstraction plan, dotenvx-removal proposal | **DONE (this work)** |
| 1 | **Environment provisioning** | Stand up VM, Docker, reverse proxy, TLS, secret store (SERVER_DEPLOYMENT_GUIDE) | Not started |
| 2 | **Self-hosted Convex backend** | Deploy convex backend + dashboard containers; push schema from repo | Not started |
| 3 | **Function parity** | `convex push` against self-hosted backend; run verification suites from `scripts/` | Not started |
| 4 | **Email → Resend** | Implement provider abstraction + Resend adapter; set `RESEND_API_KEY`; verify OTP + comm queue | Not started (plan ready) |
| 5 | **Data migration rehearsal** | Full export → import → validate cycle on a **staging** self-host instance | Not started |
| 6 | **Cutover** | Final sync, DNS switch, freeze window, go-live | Not started (**OWNER DECISION REQUIRED**) |
| 7 | **Decommission Cloud** | Read-only grace period on Convex Cloud, then retire | Not started |

Each phase has a rollback path (§6). Phases 1–5 are non-destructive to the
current deployment; only Phase 6 touches live traffic.

---

## 4. Server requirements

### Minimum viable (single-school / pilot, < 1,000 students)

| Resource | Requirement |
| --- | --- |
| CPU | 2 vCPU |
| RAM | 4 GB (Convex backend is the largest consumer; reserve 2 GB for it) |
| Disk | 40 GB SSD (data volume + Docker images + backups) |
| OS | Ubuntu 22.04+ LTS (or any Linux with Docker + Compose v2) |
| Software | Docker Engine 24+, Docker Compose v2, `rsync`/`restic` for backups |

### Recommended (multi-school production, the SaaS posture)

| Resource | Requirement |
| --- | --- |
| CPU | 4+ vCPU |
| RAM | 8–16 GB |
| Disk | 100 GB+ SSD, with separate partition/volume for data + backups |
| Network | Static IP, ports 80/443 open; outbound HTTPS (Resend, M-Pesa, SMS) |
| Extras | Off-site backup target (S3-compatible or second host), uptime monitor |

### Sizing notes

- The data model is large (125 tables) but per-school volume is modest
  (school-day records, invoices, audit logs dominate).
- `auditLogs` grows fastest; the production audit recommended TTL policies
  (not yet implemented) — factor retention into disk sizing.
- File storage (student/staff documents) lives in the Convex data volume —
  size for document-heavy schools.
- Build artifacts are built in CI or locally, **not** on the server
  (matches the OOM mitigation already applied to `package.json`).

---

## 5. Deployment workflow

### One-time provisioning

1. Provision VM + DNS (SERVER_DEPLOYMENT_GUIDE §2).
2. Install Docker/Compose; create `schoolcore` network + volumes.
3. Create the secrets file from the template in SECRET_MANAGEMENT_GUIDE §4
   (`/etc/schoolcore/schoolcore.env`, root-owned, 0600).
4. Deploy the stack: `docker compose up -d` (SERVER_DEPLOYMENT_GUIDE §4).
5. Push the schema: `bunx convex push` against the self-hosted backend
   (CONVEX_SELF_HOST_MIGRATION_PLAN §3).

### Routine releases

```bash
# From CI or a workstation with the repo checked out:
bun install
bun run build                      # vite build → dist/
bun tsc -b --noEmit                # type gate (platform check parity)
docker compose -f deploy/compose.yaml build app
docker compose -f deploy/compose.yaml up -d app
# Convex functions:
bunx convex push --cmd "bun tsc -b --noEmit" <self-hosted-deployment-args>
```

- Releases are tagged in git; the compose file pins the app image by tag.
- Never run `bun run build` on the VM itself (memory-limited runners were the
  reason `build` was reduced to `vite build` — keep building off-box).
- Keep the Freebuff deployment building/running from the same repo until
  cutover: the two share the schema but not the deployment.

### Post-release verification

Run the verification suites from `scripts/` against the new deployment URL
(see `scripts/README-migration.md` §Validation): security audit, phase7,
phase2/3, engines tests. All must pass before considering a release live.

---

## 6. Rollback process

| Scenario | Action |
| --- | --- |
| Bad app release | `docker compose ... up -d app` with previous image tag (images retained locally per compose retention policy). Verify suites re-run. |
| Bad function push | Re-push the previous git tag's functions (`git checkout <tag> && bunx convex push`). Schema pushes are append-only in practice; destructive schema changes require the data-rollback path below. |
| Data corruption / bad import | Restore the Convex data volume from the most recent backup snapshot (SERVER_DEPLOYMENT_GUIDE §5), or re-import from the pre-migration export archive (README-migration §6 rollback). |
| TLS/proxy failure | Certificates are re-issued from the ACME provider; configs are versioned in `deploy/` so `git revert` + redeploy restores the prior proxy state. |
| Full-host loss | Re-provision from SERVER_DEPLOYMENT_GUIDE §2, restore data volume from off-site backup, redeploy app image, re-run validation. Target RTO: 2–4 h. |

Rollback **never** touches the still-live Freebuff deployment during phases
1–5; that deployment is itself the macro-level rollback target until cutover
completes.

---

## 7. Guardrails (standing rules for this migration)

1. The current Freebuff/Convex Cloud deployment must remain working at every
   step until cutover completes.
2. No production data migration has been performed; nothing in this
   preparation phase touches live data.
3. No destructive actions: no data deletion, no production modification, no
   git-history purges.
4. No secret values in the repository — templates and placeholders only
   (SECRET_MANAGEMENT_GUIDE).
5. No deploy is executed from this preparation work.

---

## 8. Remaining decisions before Phase 1

| Decision | Owner | Notes |
| --- | --- | --- |
| Target VM / hosting provider | OWNER | Any Docker-capable Linux host works |
| Domain name(s) for app + API | OWNER | Needed for TLS |
| Email domain + Resend account tier | OWNER | FREE/PRO tiers per volume (EMAIL_RESEND_MIGRATION §6) |
| Backup target (S3-compatible vs second host) | OWNER | SERVER_DEPLOYMENT_GUIDE §5 assumes either |
| Cutover date & freeze window | OWNER | Phase 6 entry gate |
| Whether VLY AI features ship in self-host v1 | OWNER | Or deferred/disabled (Self-hosting §1 table) |
