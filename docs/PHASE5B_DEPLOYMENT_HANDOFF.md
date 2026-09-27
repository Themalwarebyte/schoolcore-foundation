# Phase 5B Deployment Handoff

> **STATUS: DEPLOYED (2026-09-27).** The approved commit
> `df14e982ac4bda6ae704f0b737a79addcc2a66e8` is live on `gman-02`.
> Password authentication is verified end-to-end against synthetic test data.
> **No production data was migrated and Convex Cloud was not modified.**
>
> Sections A–H below are the original pre-deployment instructions, retained for
> reference and for future-server reuse. **Section L is the deployment record.**

---

## L. Deployment record (2026-09-27)

### Deployed source
| Item | Value |
|---|---|
| Commit | `df14e982ac4bda6ae704f0b737a79addcc2a66e8` |
| Branch | `phase5-selfhost-readiness` |
| Base | `d4cc5b423082a863b9e5fa385e7d58ebbdc9a828` |
| Server location | `/opt/schoolcore/app/source/schoolcore` |

### Convex deployment
- Dry-run: **clean** — no index deletions, schema validation passed
- Functions/schema deployed to `https://schoolcore-api.ooflowdesk.com`
- Backend: **PostgreSQL 17.11**, `Connected to Postgres database: schoolcore`, **0 SQLite files**
- Frontend/CodeGen: application tables created (129 objects)

### Convex Auth (self-hosted)
- `JWT_PRIVATE_KEY` + `JWKS`: **newly generated on gman-02**, RS256. Set on the
  deployment via `convex env set --from-file` (a multi-line PEM cannot be passed
  as a CLI argument). Generation files were mode 600 and shredded.
- `CONVEX_SITE_URL`: Convex **built-in**; cannot be set with `convex env set`
  (`EnvVarNameForbidden`). It is derived by the backend from
  `CONVEX_SITE_ORIGIN=https://schoolcore-site.ooflowdesk.com`.
- OIDC issuer resolves to `https://schoolcore-site.ooflowdesk.com`; JWKS serves
  the RSA key. **No Freebuff dependency.**
- JWT lifetime: **60 minutes**.

### Frontend
- Image `schoolcore-frontend:df14e98` (multi-stage, digest-pinned bases)
- Service `schoolcore-frontend`, internal port 80, `schoolcore-net`, **no host port**
- `read_only` rootfs, `cap_drop: ALL` + only `CHOWN/SETUID/SETGID/DAC_OVERRIDE`
  (nginx needs these to chown its cache dirs and drop privileges)
- **Fixed during deployment:** nginx `add_header` does not inherit into
  `location` blocks that declare their own, and the SPA fallback internally
  redirects to `/index.html` — so the security headers were silently dropped.
  They are now repeated per-location and confirmed served.
- `https://schoolcore.ooflowdesk.com` → **HTTP 200**

### Controlled TEST data
Created with the application's own `seed:seedAll` (the only supported bootstrap
path) using a generated `SEED_SECRET` and a generated test admin password.
**All synthetic**: 2 schools, 80 students, 11 staff, 67 guardians. No real
personal, financial, health or examination data. Credentials live only in
`/opt/schoolcore/deploy/.env` (mode 600).

### Password authentication — verified
| Check | Result |
|---|---|
| Correct password | **ACCEPTED**, JWT issued |
| `auth:isAuthenticated` | `true` |
| `users:currentUser` | resolves to the test admin |
| Session persistence | **YES** across repeat calls |
| Wrong password | **REJECTED** |
| Logout | **OK**; client token cleared → `isAuthenticated: false` |
| Freebuff dependency | **NONE** |

**Finding — logout does not revoke the JWT server-side.** After `auth:signOut`
the client is anonymous, but replaying the pre-logout token still authenticates.
This is inherent to stateless JWT auth (the token is self-contained), not a
configuration defect. Exposure is bounded by the **60-minute** token lifetime.
Anyone needing true revocation must shorten the token lifetime or add
server-side session revocation.

### Email status
**APPLICATION READY · EMAIL DOMAIN VERIFICATION PENDING.**
`RESEND_API_KEY` is configured but `RESEND_FROM_EMAIL` is not, so the code falls
back to Resend's onboarding address (owner-mailbox only). No email was sent.
This does not affect password authentication.

### Backup
`/opt/schoolcore/backups/post-app-deploy-20260927-172651/` — logical
`pg_dump` (1.6 MB, verified), source commit, row counts, redacted env keys,
image manifest, TEST-data identifiers. The Phase 4 baseline backup is preserved.

### Rollback
```bash
D=/opt/schoolcore/deploy/docker-compose.convex.yml
docker compose -f $D stop schoolcore-frontend                 # frontend only
docker compose -f $D stop schoolcore-frontend convex-backend convex-dashboard cloudflared
docker compose -f $D down                                    # keeps volumes
```
None of these touch `/srv/platform` (`caddy`, `convex` projects), OMV,
Tailscale, Syncthing, the firewall, or Convex Cloud.

### Outstanding before production cutover
1. Rotate/remove the seeded demo accounts (their passwords are in the README)
2. Verify a Resend sending domain and set `RESEND_FROM_EMAIL`
3. Remove `SEED_SECRET` and the bootstrap admin variables from the deployment
4. Migrate real production data (Phase 6) — **not started**
5. Git history purge — still mandatory
6. Cloudflare Access before any dashboard route
7. Review the 60-minute JWT logout window

---

## A. Source

| Item | Value |
|---|---|
| Repository | `https://github.com/Themalwarebyte/schoolcore-foundation.git` |
| Branch | **`phase5-selfhost-readiness`** |
| Final commit | **see §N / the handoff report for the exact SHA** |
| Based on `origin/main` | **`d4cc5b423082a863b9e5fa385e7d58ebbdc9a828`** |
| Commits ahead of `main` | 2 (Phase 5A + Phase 5B handoff) |

```bash
git clone --branch phase5-selfhost-readiness \
  https://github.com/Themalwarebyte/schoolcore-foundation.git
```

## B. Self-host public URLs

| Purpose | URL |
|---|---|
| Frontend | `https://schoolcore.ooflowdesk.com` |
| Convex API (backend, 3210) | `https://schoolcore-api.ooflowdesk.com` |
| Convex site / HTTP Actions (3211) | `https://schoolcore-site.ooflowdesk.com` |
| Convex dashboard | **INTERNAL ONLY** — `http://schoolcore-convex-dashboard:6791` |

> There is **no public dashboard route and must not be created.** Cloudflare
> Access is deferred (billing). If a dashboard route is ever needed, Access
> deny-by-default must exist **first**.

## C. Frontend build variable

| Variable | Value |
|---|---|
| `VITE_CONVEX_URL` | `https://schoolcore-api.ooflowdesk.com` |

- **Must be the API origin (3210), never the site origin.** Pointing it at
  `https://schoolcore-site.ooflowdesk.com` is wrong, and pointing it at any
  `*.convex.site` URL makes the Convex client throw at start-up.
- No other `VITE_` variable is required. `VITE_VLY_APP_ID` and
  `VITE_VLY_MONITORING_URL` are optional Freebuff developer-tooling values and
  should be left unset on self-host.
- **Never place a secret behind a `VITE_` prefix.** Those values are compiled
  into the public client bundle.

## D. Self-hosted Convex deployment environment

Set with the Convex CLI against the **self-hosted** deployment (§E):

| Variable | Value |
|---|---|
| `CONVEX_SITE_URL` | `https://schoolcore-site.ooflowdesk.com` |
| `SITE_URL` | `https://schoolcore.ooflowdesk.com` |
| `JWT_PRIVATE_KEY` | **generate securely on gman-02** — never in the repo |
| `JWKS` | **generate securely on gman-02** — never in the repo |
| `RESEND_API_KEY` | already server-side on gman-02 |
| `RESEND_FROM_EMAIL` | Owner-configured sender (see §O of the report) |
| `VLY_CONVEX_AUTH_ISSUER` | **`""` (empty, but SET)** — see below |

### ⚠️ `VLY_CONVEX_AUTH_ISSUER` must be set to an empty value

The Convex Auth CLI performs a static environment check over the auth config
and **fails `convex dev`/`convex deploy` if any referenced variable is not set
in the target deployment** — even when the code guards for absence. This was
verified to be transitive across imports and is not evaded by indirection.

Setting it to an empty string satisfies the CLI while the runtime guard keeps
the Freebuff `customJwt` provider **unregistered**, so self-hosted SchoolCore
has no Freebuff issuer, no `freebuff.com` dependency and no JWKS endpoint.

```bash
npx convex env set VLY_CONVEX_AUTH_ISSUER ""   # empty on self-host ONLY
```

On **Convex Cloud** it must remain set to the real issuer so federated
sign-in keeps working. Do not apply this change to the cloud deployment.

## E. Self-host deployment selector

| Variable | Value |
|---|---|
| `CONVEX_SELF_HOSTED_URL` | `https://schoolcore-api.ooflowdesk.com` |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | server-side secret (already on gman-02) |

Never commit either. Both already exist in `/opt/schoolcore/deploy/.env`
(mode 600) on gman-02.

## F. Infrastructure variables (externally managed)

Already provisioned on gman-02. **Documented here for completeness only — do
not copy values into the repo or this document.**

- `INSTANCE_SECRET`
- `POSTGRES_PASSWORD`
- `TUNNEL_TOKEN`

## G. Deployment order for Kilo

1. **Fetch the approved branch.**
   ```bash
   git clone --branch phase5-selfhost-readiness <repo>
   ```
2. **Generate `JWT_PRIVATE_KEY` / `JWKS` on gman-02.** Run the Convex Auth
   key generator (`jose`, RS256) and write the output straight into the
   self-hosted deployment environment. Never print into chat, never commit,
   never reuse the Convex Cloud values.
3. **Set the deployment environment variables** listed in §D against the
   self-hosted deployment only.
4. **Confirm cloud production is untouched** — verify no cloud deployment id
   appears in the selector, and that `.env.local` / `CONVEX_DEPLOYMENT` is not
   pointed at Convex Cloud.
5. **Dry-run the Convex deployment.**
   ```bash
   npx convex deploy --env-file /opt/schoolcore/deploy/.env --dry-run
   ```
6. **Review** the reported schema, indexes and function diffs.
7. **Deploy Convex functions to the EMPTY self-hosted backend.**
   ```bash
   npx convex deploy --env-file /opt/schoolcore/deploy/.env
   ```
8. **Verify health / auth routes** — `https://schoolcore-api.ooflowdesk.com`
   returns the Convex deployment banner; `https://schoolcore-site.ooflowdesk.com`
   responds on the HTTP-actions listener.
9. **Build `schoolcore-frontend`** with `VITE_CONVEX_URL=https://schoolcore-api.ooflowdesk.com`
   using `Dockerfile.frontend` (multi-stage, digest-pinned bases).
10. **Start the frontend container** on `schoolcore-net`, service name
    `schoolcore-frontend`, internal port 80, **no host port**.
11. **Verify** `https://schoolcore.ooflowdesk.com` changes from the expected
    502 (origin pending) to the SchoolCore UI.
12. **Test password authentication only**, with controlled test data.
13. **Do NOT migrate cloud production data.**

## H. Dry-run guidance

Use the current Convex CLI (`convex@1.46.0`, matching the local build) against
the self-hosted deployment.

```bash
npx convex deploy --env-file /opt/schoolcore/deploy/.env --dry-run
```

### How the target deployment is actually selected

Verified against `convex deploy --help` (convex 1.46.0) — there is **no
`--url` and no `--admin-key` flag**. The target is chosen by, in order:

1. `CONVEX_DEPLOYMENT` environment variable (the project's default production
   deployment) — **must NOT be set**, or the CLI will target whatever it names.
2. `CONVEX_DEPLOY_KEY` environment variable.
3. `--env-file <path>` — a file in the same format as `.env.local`. The help
   text states this is for "choosing the deployment, e.g. `CONVEX_DEPLOYMENT`
   or `CONVEX_SELF_HOSTED_URL`".

`/opt/schoolcore/deploy/.env` (mode 600) already contains
`CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY`, so `--env-file`
against that file selects the self-hosted deployment **and** keeps the admin
key out of shell history, process listings and the command line.

### Safety rules

- **Verify the selector before deploying.** Confirm the file's
  `CONVEX_SELF_HOSTED_URL` is `https://schoolcore-api.ooflowdesk.com` and that
  no `CONVEX_DEPLOYMENT` points at Convex Cloud.
- **Always dry-run first.** `--dry-run` prints the generated configuration
  without deploying.
- **Never** run a deploy without the explicit self-host env file.
- `convex deploy` also regenerates `convex/_generated` and typechecks by
  default (`--typecheck try`, `--codegen enable`), so it doubles as a
  verification step.

## I. Resend status (email feature)

- `RESEND_API_KEY` — provisioned on gman-02.
- `RESEND_FROM_EMAIL` — **Owner must supply.** No sender is committed.
- Transport selection is automatic: `RESEND_API_KEY` present → Resend; else the
  deprecated VLY gateway (cloud only); else a clear "not configured" failure.

**Password login can be tested before Resend domain verification.** Resend
domain verification is a prerequisite for the *email* features (OTP sign-in and
invitations) only — it is **not** a blocker for bringing up the basic
password-authenticated frontend.

## J. Known gaps carried into Phase 5B

- **`src/convex/phase6/communications.ts` email delivery is still a stub.**
  `providerReady` gates on `EMAIL_API_KEY` but no provider send is implemented
  for any channel. This is separate from the Convex Auth OTP transport (which
  IS implemented) and is deliberately out of Phase 5B scope.
- PWA manifest branding is now `SchoolCore`. The env-gated Freebuff developer
  toolbar / integrations remain in the bundle by design (they are inert when
  `VITE_VLY_APP_ID` is unset).
- Git history still contains the historical `DOTENV_PRIVATE_KEY_LOCAL` and the
  pre-fix VLY email OTP literal. The dotenvx key was assessed as an **orphaned
  key** (no ciphertext payload ever committed, so it decrypts nothing), but the
  history purge is still **mandatory before production cutover**.

## K. Security checklist before deploying

- [ ] No secret in the git diff or in `dist/`
- [ ] `.dockerignore` excludes `.env*`, keys, backups, docs
- [ ] Frontend image receives no backend secrets
- [ ] `.env` on gman-02 remains mode 600, never committed
- [ ] Cloudflare Access exists before any dashboard route is created
- [ ] No data migrated from Convex Cloud
