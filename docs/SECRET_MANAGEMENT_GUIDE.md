# Secret Management Guide

> **Decision (Owner):** self-hosted deployment uses **server-managed
> environment configuration**. No dotenvx, no `.env.keys`, no encrypted
> env-in-repo tooling. No secret values are ever committed to this
> repository.

---

## 1. Rules

1. **Never commit secrets.** `.gitignore` already excludes `.env`, `.env.*`
   (except `!.env.example`) plus key/cert patterns — keep it that way.
2. `.env.example` is a **placeholder template only**. Current tracked content
   is placeholders (`VITE_CONVEX_URL`, `CONVEX_SITE_URL`, `CONVEX_DEPLOYMENT`
   — all blank). Verified 2026-09; keep it that way.
3. Secrets live in **one** place per environment:
   - Current Freebuff deployment: the platform's deployment environment
     (Keys UI / `convex env set`) — unchanged for the live system.
   - Self-hosted server: `/etc/schoolcore/schoolcore.env` (root-owned, 0600)
     or Docker secrets / a vault — Owner's choice per environment.
4. Secrets never pass through the migration archive (CONVEX_SELF_HOST_
   MIGRATION_PLAN §4.4); they are re-created on the server.
5. Frontend env vars are **public by nature** — only `VITE_*` build-time
   values and URLs. No secret may be `VITE_`-prefixed.

---

## 2. Historical dotenvx note (no longer applicable)

The repository previously carried a root-owned `.env.keys` file (416 bytes,
untracked, matched by the `.env.*` ignore rule) consistent with a dotenvx
key file from the project template. **A full-repo audit (2026-09) found:**

- No `dotenvx` dependency in `package.json` or `bun.lock`.
- No `dotenvx` invocation in any npm/bun script, CI config, or doc.
- No `DOTENV_KEY` / `.env.keys` reference in any source file.

Conclusion: **no code or script depends on dotenvx today.** The only
dotenvx-era artifact is the untracked `.env.keys` file itself. The
self-hosted target (§4) reads plain environment variables; nothing needs to
be code-changed to drop dotenvx.

### Prepared (not executed) cleanup — requires Owner approval

| # | Action | File | Risk |
| --- | --- | --- | --- |
| C1 | Delete local untracked `.env.keys` (after confirming it encodes nothing still needed) | `.env.keys` | None — untracked, unreferenced |
| C2 | No change needed — no dotenvx dep/script/invocation exists | `package.json`, CI | — |
| C3 | Doc-only follow-up: if any future runbook mentions dotenvx, replace with this guide | `docs/*` | — |

These are **proposals**. Nothing was deleted in this preparation phase.

---

## 3. Environment variable inventory

Authoritative source: `docs/production-deployment.md` §3 (mirrored here for
the self-hosted server). Values are **never** written in this repo.

### 3.1 Frontend (build-time, `VITE_`-prefixed)

| Variable | Required | Purpose | Placeholder in `.env.example` |
| --- | --- | --- | --- |
| `VITE_CONVEX_URL` | ✔ | Convex deployment URL the browser connects to. Must match the backend serving auth + data. | yes (blank) |
| `CONVEX_SITE_URL` | ✔ | Site URL used for auth flows. | yes |

### 3.2 Server (Convex deployment env → self-host: compose env file)

| Variable | Required | Purpose |
| --- | --- | --- |
| `SEED_SECRET` | **MUST stay unset in production** | Gates the demo seed action; seed refuses to run without it. No fallback exists. |
| `PLATFORM_ADMIN_EMAIL` | ✔ (bootstrap) | Super admin bootstrap email |
| `PLATFORM_ADMIN_NAME` | optional | Super admin display name |
| `PLATFORM_ADMIN_PASSWORD` | ✔ (bootstrap) | No default — bootstrap refuses without it |
| `CONVEX_DEPLOYMENT` | CLI convenience | Names the deployment for local CLI workflows |
| `NODE_ENV` | recommended | `production` on the server |
| `SITE_URL` / `CONVEX_SITE_URL` | ✔ | Public base URLs for links (email links, callbacks) |

### 3.3 Optional integrations (all degrade gracefully when unset)

| Variable | Enables | Degrades to |
| --- | --- | --- |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` / `MPESA_SHORTCODE` / `MPESA_PASSKEY` | M-Pesa payments | `mpesaEnv()` returns null; payment actions report not-configured |
| `MPESA_CALLBACK_SECRET` | Callback verification | Callbacks rejected |
| `MPESA_ENV` | sandbox vs live selection | sandbox default per `payments.ts` |
| `SMS_API_KEY` | SMS channel | comm queue marks messages `failed: "<channel> integration is not configured"` |
| `EMAIL_API_KEY` | Email channel (comm queue) | same graceful failure |
| `WHATSAPP_API_KEY` | WhatsApp channel | same graceful failure |
| `VLY_EMAIL_OTP_API_KEY` | Email OTP sign-in (VLY gateway) | OTP send throws "Email OTP is not configured" |
| `VLY_INTEGRATION_KEY` | AI features via `@vly-ai/integrations` | AI actions unavailable |
| `VLY_APP_NAME` | OTP email app label | defaults to template string |
| `RESEND_API_KEY` (**future**) | Email via Resend (OTP + comm queue) — see EMAIL_RESEND_MIGRATION | not yet read by code |

> **Freebuff-era keys** (`VLY_EMAIL_OTP_API_KEY`, `VLY_INTEGRATION_KEY`) are
> sunset at cutover: the OTP gateway is replaced by Resend; the AI
> integration is an Owner decision (SELF_HOSTING_GUIDE §8).

---

## 4. Self-hosted server secret setup (target procedure)

### 4.1 File-based (simplest, recommended for single-VM)

```bash
sudo install -d -m 700 /etc/schoolcore
sudo install -m 600 /dev/null /etc/schoolcore/schoolcore.env
sudoedit /etc/schoolcore/schoolcore.env   # fill values per §3
```

```ini
# /etc/schoolcore/schoolcore.env  (never committed; root-owned 0600)
NODE_ENV=production
SITE_URL=https://app.schoolcore.example
CONVEX_SITE_URL=https://app.schoolcore.example
VITE_CONVEX_URL=<backend public URL>
RESEND_API_KEY=<from Resend dashboard>
PLATFORM_ADMIN_EMAIL=...
PLATFORM_ADMIN_PASSWORD=...   # bootstrap only; can be removed post-bootstrap
# MPESA_* / SMS_API_KEY / WHATSAPP_API_KEY as needed
# SEED_SECRET deliberately ABSENT in production
```

Compose wires it via `env_file:` (SERVER_DEPLOYMENT_GUIDE §4) — the file is
read at container start; no dotenvx, no pre-encrypted blob, no `.env.keys`.

### 4.2 Docker secrets / vault (alternative)

For multi-host or stricter audit needs, mount secrets via Docker secrets or
inject from a vault agent; the application contract is unchanged — it reads
`process.env.*` only. Document the chosen mechanism in the server runbook.

### 4.3 Rotation & handling rules

- Rotate any credential suspected of exposure; never re-add a leaked value
  anywhere in the repo (no history purge is planned — leaked values are
  rotated instead, per the no-history-purge rule).
- Server backups that include the env file must be encrypted; the backup
  section of SERVER_DEPLOYMENT_GUIDE treats `/etc/schoolcore` as sensitive.
- Restrict shell access; the env file is root-readable only.
- `SEED_SECRET`: verify it is **absent** on the production server as part of
  go-live checklist (production-deployment.md's golden rule).

---

## 5. GitHub hygiene (standing)

- Pre-commit/CI check recommendation (future): a lint rule or CI grep for
  high-entropy assignments in tracked files. Not implemented in this
  preparation phase.
- `docs/production-deployment.md` §3 and this guide document variable
  **names and purposes only** — safe to keep public in the repo.
- `.env.example` is the only tracked env-shaped file and must contain only
  empty placeholders (platform currently blocks agent edits to it; if
  `RESEND_API_KEY` documentation is desired there later, it is a manual
  Owner edit — docs cover it meanwhile).
