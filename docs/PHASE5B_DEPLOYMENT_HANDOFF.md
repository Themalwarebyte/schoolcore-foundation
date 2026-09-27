# Phase 5B Deployment Handoff

> **Audience:** Kilo (deployment agent) on `gman-02`.
> **Scope:** deploy SchoolCore to the existing EMPTY self-hosted Convex backend.
> **Not in scope:** migrating Convex Cloud production data, cutover, and the
> communications email channel (still a stub — see §10).
>
> Convex Cloud / Freebuff production **remains live and must not be modified**.
> This handoff targets the self-hosted deployment only.

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
