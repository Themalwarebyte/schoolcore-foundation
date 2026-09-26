# Production Deployment Guide

This guide covers taking SchoolCore from a repository checkout to a real
production launch with **no demo or test data**. For the demo accounts and how
demo data is kept separate, see [`docs/demo-accounts.md`](./demo-accounts.md).

> **Golden rule:** a fresh production deployment starts **empty**. Demo data,
> demo accounts and SMOKE test records only exist if the demo seed action has
> been run against that deployment — so on production, simply never run it.

---

## 1. Repository checkout

```bash
git clone <your-repository-url> schoolcore
cd schoolcore
bun install          # Bun is the package manager for this project
```

Requirements:

| Tool    | Version      | Notes                                      |
| ------- | ------------ | ------------------------------------------ |
| Bun     | 1.1+         | Installs deps, runs scripts, dev tooling   |
| Node    | 18+          | Required by Vite build tooling             |
| Convex  | via `bunx`   | CLI is fetched automatically (`convex` in devDependencies) |

## 2. Create the Convex deployment

```bash
bunx convex dev --once     # follow the prompts to create/log in and link
```

- `--once` typechecks and pushes functions, regenerating `src/convex/_generated`.
- For the production deployment use `bunx convex prod` workflows or create the
  production deployment in the Convex dashboard and set `CONVEX_DEPLOYMENT`
  accordingly (see below).

## 3. Environment configuration

All secrets are managed through the platform secret manager / the Convex
deployment environment — **never committed to the repository**.

**Frontend hosting environment** (build-time, `VITE_`-prefixed):

| Variable          | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `VITE_CONVEX_URL` | Convex deployment URL the browser talks to. Must point at the **same** deployment that hosts the auth tables, backend functions, and (if used) seeded accounts. |

**Convex deployment environment** (server-side):

| Variable                  | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `PLATFORM_ADMIN_EMAIL`    | Bootstrap super admin email (default `admin@schoolcore.dev`).   |
| `PLATFORM_ADMIN_NAME`     | Optional bootstrap super admin display name.                    |
| `PLATFORM_ADMIN_PASSWORD` | Required. Bootstrap **refuses** to create the platform admin without it — there is no default. |
| `SEED_SECRET`             | Optional guard for the demo seed action. On production, prefer leaving it **unset** so the seed cannot run at all. |

**Optional integrations** (all server-side; each feature degrades gracefully
when unset — queues mark messages `failed: "… integration is not configured"`,
M-Pesa actions return a null config instead of throwing):

| Variable               | Enables                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `MPESA_CONSUMER_KEY`   | M-Pesa (all four `MPESA_*` below required together)            |
| `MPESA_CONSUMER_SECRET`| M-Pesa                                                        |
| `MPESA_SHORTCODE`      | M-Pesa paybill/till                                            |
| `MPESA_PASSKEY`        | M-Pesa STK push                                                |
| `MPESA_CALLBACK_SECRET`| Shared secret for M-Pesa callback verification                 |
| `MPESA_ENV`            | `sandbox` (default) or `production`                            |
| `SMS_API_KEY`          | SMS channel of the communications module                       |
| `EMAIL_API_KEY`        | Email channel of the communications module                     |
| `WHATSAPP_API_KEY`     | WhatsApp channel of the communications module                  |
| `VLY_EMAIL_OTP_API_KEY`| Email delivery for OTP invitations/activation                  |

The platform integration key (`VLY_INTEGRATION_KEY`) is injected automatically
by the platform — never set it by hand and never expose it to the client.

Do **not** set Convex system variables by hand: `CONVEX_SITE_URL` (the
deployment's `*.convex.site` HTTP-actions domain) and `CONVEX_DEPLOYMENT_NAME`
are provided by Convex itself. `src/convex/auth.config.ts` reads
`process.env.CONVEX_SITE_URL` at runtime — never point it at the frontend URL
or `localhost`.

```bash
# Example: configure the production deployment environment
bunx convex env set PLATFORM_ADMIN_EMAIL "principal@yourschool.ac.ke"
bunx convex env set PLATFORM_ADMIN_PASSWORD "<strong-random-value>"
# Intentionally NOT set on production: SEED_SECRET
```

## 4. Backend deployment

```bash
bunx convex dev --once     # dev deployment: typecheck + push + codegen
# or for the production deployment:
bunx convex deploy         # pushes functions to the production deployment
```

Schema is code: `src/convex/schema.ts` (+ `schemaPhase7.ts`) **is** the
database. Pushing creates tables and indexes; schema validation applies on
every push. There are no separate migration scripts.

## 5. Frontend build & deployment

```bash
bun run build              # tsc -b && vite build → dist/
```

Deploy `dist/` to your static host (platform preview, CDN, Vercel, Netlify,
nginx, etc.) with `VITE_CONVEX_URL` set at build time. Enable SPA fallback
routing (all unknown paths serve `index.html`) — the app uses BrowserRouter.

## 6. Domain setup

1. Point your domain at the static host (per-host instructions).
2. The Convex deployment URL (`VITE_CONVEX_URL`) is independent of your domain;
   no reverse proxy to Convex is needed.
3. Serve over HTTPS only; Convex Auth issues/validates JWTs against the
   deployment's own `*.convex.site` domain.

## 7. Authentication URLs

- Sign-in lives at `/auth` (client route). Users who hit a protected route are
  redirected to `/auth?returnTo=<original-path>`, and after sign-in land back
  on that path.
- Account activation & password reset share the public `/activate` and
  `/reset-password` routes (`?token=<one-time-code>`). Invited users set their
  own password there — no temporary passwords are ever issued. Invite codes are
  stored as SHA-256 hashes and expire after 7 days.
- For custom-domain deployments, no extra callback configuration is required:
  auth tokens are issued and validated by the Convex deployment itself
  (self-issued JWT via `CONVEX_SITE_URL` OIDC discovery).

## 8. Integration callback URLs

- Payments (e.g. M-Pesa callbacks) and OTP/SMS providers read their credentials
  from the deployment environment only — credentials are **never stored in the
  database** (enforced and verified by the security audit suite).
- Configure provider dashboards to post callbacks to your HTTPS endpoint. For
  payment callbacks the app exposes dedicated HTTP endpoints on the Convex
  deployment's `*.convex.site` domain; unknown/duplicate references and forged
  payloads are rejected server-side (covered by `scripts/security-audit.mjs`
  sections F2–F4).
- The frontend never receives or stores provider secrets.

## 9. Production bootstrap (no demo data)

A fresh deployment is **empty** — no schools, no users, nothing to clean up.
Initial setup:

1. `bunx convex deploy` (or the platform push) creates the schema.
2. Set `PLATFORM_ADMIN_EMAIL` + `PLATFORM_ADMIN_PASSWORD` in the deployment
   environment. The bootstrap super admin is created idempotently by the
   bootstrap step (also invoked by the seed — but you will **not** run the seed
   on production; the bootstrap alone is enough).
3. Sign in as the super admin → **School Requests / platform console** is
   reachable; the public landing page lets schools register themselves.
4. Register the real school(s) → super admin approves → the school's admin
   completes **School Setup** (`/onboarding`): profile → academics → invite
   admins → import students/staff → activate. Checklist progress is computed
   from real database state.

**If `SEED_SECRET` was ever set on a production deployment and the seed was
run**, treat it as a demo/eval database, not a production launch. The safe
reset procedure:

1. Verify `SEED_SECRET` is unset (`bunx convex env list`) so the seed cannot
   run again.
2. Never run seed/verification scripts against it again.
3. Create a new, clean Convex deployment for production, set the production
   environment variables above, push functions, and point `VITE_CONVEX_URL` at
   it. Deployments are disposable; starting clean is cheaper and safer than
   surgically deleting seeded rows.
4. Delete the old deployment when the new one is verified.

(Do not automatically delete data on the current deployment during a live
verification pass — cleanup is a deliberate, scheduled operation.)

## 10. Deployment verification

After each deploy:

```bash
bunx convex dev --once        # backend typecheck + push (dev)
bun tsc -b --noEmit           # frontend typecheck
bun run build                 # production build must succeed
```

Backend verification suites run against a live deployment URL and are
harness-safe (SMOKE-prefixed data only, auto-reversed). Run them against a
**staging** deployment, not production:

```bash
SMOKE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/security-audit.mjs
SMOKE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/phase7-verify.mjs
```

Manual smoke checks after go-live:

- Landing page loads; `/auth` sign-in works with the bootstrap admin.
- Register a real school → approve in platform console → School Setup checklist
  advances as each step completes (progress is computed from real state).
- Invite a user → activation link works → invited user lands in the school.
- Create a term invoice → record a payment → receipt renders.

## 11. Rollback notes

- **Frontend:** redeploy the previous `dist/` build (keep the last known-good
  build artifact; static hosts make this a one-command rollback).
- **Convex functions:** push the previous commit with
  `bunx convex deploy`; Convex functions are versioned with your code.
- **Schema:** Convex schema pushes are additive-safe; reverting a schema change
  that removed a field requires first confirming no documents depend on it.
  When in doubt, roll forward with a fix rather than rolling the schema back.
- **Environment variables:** changes take effect on the next function
  invocation; re-verify with the manual smoke checks above.
- **Data:** user data is never rolled back. If a bad release corrupted data,
  restore from Convex backups (dashboard → deployment → Backups) before
  re-deploying the fixed build.

## 12. Related documentation

- `README.md` — developer setup, environment variables, seeded demo data
- `docs/demo-accounts.md` — demo credentials (**development only**) and the
  demo/production separation rules
