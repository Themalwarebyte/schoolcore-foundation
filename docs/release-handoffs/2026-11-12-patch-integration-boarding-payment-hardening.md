# Release Handoff — Boarding Portal Visibility & Payment Authorization Hardening

- **Date:** 2026-11-12 (updated 2026-11-12 for PR/CI and remaining release-gate status)
- **PR:** [#3 — SchoolCore: Boarding Portal and Payment Authorization Hardening](https://github.com/Themalwarebyte/schoolcore-foundation/pull/3) (OPEN, MERGEABLE, base `selfhost-production` ← head `patch-integration-2026-11-12`)
- **Patch commit:** `404c2acb324a17478237306d82b1caaec22253f3`
- **Original deployed / rollback baseline SHA:** `cf01f1ef548684e68fdda705d6adf025fc34d73e` (`selfhost-production`, currently deployed)
- **Patch archives reviewed (server):** `/home/ghub/schoolcore-incoming/2026-11-12/SchoolCore-Boarding-Portal-Patch-2026-11-12.zip`, `/home/ghub/schoolcore-incoming/2026-11-12/SchoolCore-Payment-Authorization-Hardening-Review-2026-11-12.zip`
- **Local integration branch:** `patch-integration-2026-11-12` (clean)

## CI / PR status (recorded)
- **GitHub Actions CI: PASSED** for `404c2ac` (PR #3, `pull_request`)
  - Workflow: `CI` / job: `typecheck, unit tests, lint, build`
  - Result: **1 successful check, 0 failures, 0 pending**
  - Run/job: https://github.com/Themalwarebyte/schoolcore-foundation/actions/runs/43307008204/job/131492843121
  - Completed: `2026-11-12T21:08:14Z` (started `2026-11-12T21:07:04Z`)
- **Checks via `gh pr checks 3`:** `typecheck, unit tests, lint, build  pass  1m10s`
- PR not merged; no deployment performed.

## Files reviewed / integrated
| Patch | File | Action | Notes |
|---|---|---|---|
| Boarding | `src/convex/portal.ts` | modified | Added `currentBoardingForStudent`, `parentChildBoarding`, `studentBoarding` (read-only, school-scoped, fail-closed). |
| Boarding | `src/pages/portal/BoardingStatusCard.tsx` | added | Read-only boarding status card. |
| Boarding | `src/pages/portal/ParentDashboard.tsx` | modified | Renders per-child boarding status. |
| Boarding | `src/pages/portal/StudentViews.tsx` | modified | Renders own boarding status. |
| Payment hardening | `src/convex/phase6/payments.ts` | modified | Tightened `initiatePayment` and `myPaymentRequests` (linked-parent/invoice/permission checks, school-scoped). |
| Both | `REVIEW_PATCH_README.md` (archives) | reviewed | Guidance/limitations noted; not committed. |

## Changes made (summary)
- **Boarding portal (read-only):** parent sees dorm assignment only for linked/authorized active child (`portal.parent` + `authorizeChild`/active guardian-student link in school); student sees only own assignment (`portal.student` + `studentIdentity`). Active allocation resolved in same school with fail-closed checks on hostel/room/bed tenant/relationship consistency; ended/historical allocations excluded. Day/unassigned states surfaced explicitly. No schema/permission/account/write-path changes.
- **Payment authorization hardening (minimal):** `initiatePayment` requires active linked parent-child for parent role or `payments.create` for non-parent actors; validates supplied invoice is payable and belongs to same student. `myPaymentRequests` enforces school context, school-scoped student lookup, parent-child link, student-self, or `payments_external.view`; responses remain masked. **Does not complete M-Pesa** (no HTTP callback route in `src/convex/http.ts`, reconciliation stub, STK/callback/idempotent posting not end-to-end proven here; do not enable live processing).

## Static validation (completed earlier; not repeated)
- TypeScript typecheck: **PASS** (local).
- Unit tests: **PASS** — 23 pass, 0 fail, 64 expect() calls.
- Lint: **PASS with warnings** — 0 errors, 24 pre-existing warnings outside patched scope.
- Production build: **PASS**.
- CI (PR #3): **PASS** as recorded above.

## Runtime / browser validation — evidence status
**No runtime tests and no browser rendering validation were executed in this pass.** Code review was **not** substituted for runtime testing.

### Isolated environment availability check (evidence)
- Local Convex endpoints unreachable: `http://127.0.0.1:3210` → connection refused; `http://127.0.0.1:3211` → connection refused.
- `.env.local` present with local/dev-style values only (`CONVEX_DEPLOYMENT=anonymous`-kind, `VITE_CONVEX_URL`/`VITE_CONVEX_SITE_URL` localhost); no `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, or `P8_IDS` configured for live authz/runtime suites.
- No staging/isolated Convex deployment URL, admin credentials, or disposable test identities provided for `404c2ac`.
- `scripts/phase8-authz.test.ts` requires `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, `P8_IDS` and targets a live deployment via `convex run --identity` (not runnable without provided env/fixtures). Existing portal/payment verification scripts (`scripts/phase4-verify.mjs`, `scripts/e2e-auth.mjs`) require a reachable Convex deployment and known test accounts.
- No browser E2E framework configured (no Playwright/Cypress project); frontend rendering validation requires a running frontend bound to a target backend.
- Docker is installed locally (`docker` available, daemon reachable, Compose v5.5.1) but the repo contains no ready isolated Convex stack/seed for disposable runtime testing; provisioning one was not performed.
- Production (`gman-02`, currently `cf01f1e`) is **not** an isolated environment and was not modified.

**Conclusion:** an isolated Convex environment with disposable test data for `404c2ac` is **unavailable** in this workspace. Per gate 5, a controlled production deployment and post-deployment testing plan is provided below for owner approval.

## Remaining release gates

### 1) Boarding and payment authorization runtime tests (isolated, disposable data) — NOT EXECUTED
**Required target:** deploy `404c2ac` to an isolated Convex environment with disposable `TEST-`/`P8-` fixtures; **no real M-Pesa payment initiated** (see gate 4).

| Area | Test case | Expected |
|---|---|---|
| Boarding | Parent linked to active child in same school calls `portal:parentChildBoarding` | Returns own child's boarding only (`assigned` with hostel/room/bed, or `not_assigned`/`day` as applicable) |
| Boarding | Parent calls `portal:parentChildBoarding` for unlinked same-school child | Denied/not linked |
| Boarding | Parent calls `portal:parentChildBoarding` for cross-school child ID | Denied / no access |
| Boarding | Student calls `portal:studentBoarding` | Returns only own boarding |
| Boarding | Ended/historical allocation or inconsistent tenant refs | Fail-closed (no leaked/invalid assignment) |
| Payment | Linked parent calls `phase6/payments:myPaymentRequests` for own child | Allowed, school-scoped, masked phone |
| Payment | Linked parent calls for unlinked/cross-school student | Denied |
| Payment | Student calls for self / for other | Self only (per implementation); other denied |
| Payment | Staff with `payments_external.view` vs without | Allowed only with permission |
| Payment | Parent calls `phase6/payments:initiatePayment` for own linked child, payable same-student invoice | Passes auth/invoice checks (then config/STK gate; must not hit live M-Pesa) |
| Payment | Parent calls `initiatePayment` for unlinked child | Denied: "You can only pay for your own children." |
| Payment | Parent supplies invoice not payable / wrong student | Denied |
| Payment | Teacher/student/non-authorized actor without `payments.create` calls `initiatePayment` | Denied: no permission to initiate payments |
| Payment | Cross-school student/invoice context | Denied / school-scope enforced |

**Suggested execution (on isolated env with `404c2ac` deployed and disposable identities):** run targeted `convex run --identity` calls (authz-harness style) or extend a verification script for `portal:parentChildBoarding`, `portal:studentBoarding`, `phase6/payments:initiatePayment`, `phase6/payments:myPaymentRequests` across parent/student/teacher/admin/cross-school identities; capture ALLOWED/DENIED and returned payload scopes. Re-run relevant `bun run test:authz` / matrix rows touching `portal`/payments if fixtures/credentials (`CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, `P8_IDS`) are provided. **Not executed.**

### 2) Parent/student portal rendering in a browser — NOT EXECUTED
**Required:** run frontend (`bun run dev`/preview or deployed frontend) against isolated backend with disposable accounts.
- **Parent portal:** sign in as parent with linked child(ren); verify child switcher; boarding card shows correct state per child (`assigned` with hostel/room/bed, `day`, or `not_assigned`); no other students' boarding visible.
- **Student portal:** sign in as student; verify own boarding card/state only.
- **UX/safety:** loading/undefined states render safely; no sensitive cross-tenant data in UI/network responses.
- **Status:** no browser run performed (no running stack/E2E harness). Manual validation steps above must be executed and evidenced (screenshots/notes) before release.

### 3) Cross-school isolation, unauthorized access rejection, correct boarding allocation visibility — NOT EXECUTED (runtime)
- Backend guards reviewed in code: `requirePermission` (`portal.parent`/`portal.student`), `parentIdentity`/`studentIdentity`, `authorizeChild` (active guardian-student link in session school), `getSchoolRecord`, fail-closed boarding reference/tenant consistency, `payments.create`/`payments_external.view` and link checks in payments.
- **Runtime evidence required but not obtained:** deny unlinked same-school, deny cross-school forged IDs, confirm only linked/self records and correct active allocation visibility. Must be proven on `404c2ac` in isolated/disposable context (gate 1 matrix).

### 4) Ensure no real M-Pesa payment is initiated during testing
- `initiatePayment` performs real Daraja OAuth + STK `fetch` to Safaricom when M-Pesa env is configured; it fails closed with "Mobile money is not configured..." when config is absent.
- **Mandatory test controls:** run runtime tests in an environment with **no live `MPESA_*` credentials** (omit `MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY/CALLBACK_SECRET` or use non-routable/test-only config that cannot reach live settlement). Do **not** supply production merchant credentials. Do **not** trigger STK prompts to real customer numbers. Assert authorization/validation behavior at safe boundaries (denials, invoice/link checks, config-disabled response) without initiating live charges.
- `src/convex/http.ts` exposes auth routes only (no `/mpesa/callback` HTTP route) — reduces callback exposure but does not by itself permit live STK testing.
- **No real M-Pesa payment was initiated during this work.**

### 5) Controlled production deployment and post-deployment testing plan (OWNER APPROVAL REQUIRED)
Isolated environment unavailable; **no silent substitution of code review for runtime testing**. If and only if owner explicitly approves, execute:

**Preconditions (all required):**
- Owner approval to deploy `404c2ac` (or merge PR #3) and to run controlled post-deploy tests on production.
- CI green confirmed (done) and PR/review disposition accepted by owner.
- Change window identified; rollback owner on standby.
- Test accounts/fixtures are disposable, clearly labeled, and scoped to non-production-impacting data; **no live M-Pesa credentials enabled** for tests.
- Confirm `/srv/platform` and Freebuff remain untouched throughout.

**Deployment steps (per `docs/PRODUCTION_RELEASE_WORKFLOW.md`):**
1. Fresh verified backup (hard gate): `ssh gman-remote 'sudo -n /opt/schoolcore/scripts/backup.sh'` then `sudo -n /opt/schoolcore/scripts/backup-health.sh` — require `backup ... COMPLETE`, local copy, `offsite : ok snapshot=<id>`, `retention: applied`, and `BACKUP HEALTH: HEALTHY` (capture outputs; confirm snapshot id matches manifest).
2. Move server deployment artifact to approved SHA (no branch-name deploy): fetch `selfhost-production`/PR ref as appropriate, `git checkout --quiet 404c2acb324a17478237306d82b1caaec22253f3`, verify `HEAD == 404c2ac...` and clean tree under `/opt/schoolcore/app/source/schoolcore`.
3. Backend deploy (Convex): run `convex deploy` from `convex-cli:1.46.0` on `--network schoolcore-net` with `CONVEX_SELF_HOSTED_URL=http://backend:3210` and admin key from `/opt/schoolcore/deploy/.env` (do not record secrets). Require `Schema validation complete` and no unexpected index drops. (Patches introduce no schema migrations.)
4. Frontend deploy: rebuild/redeploy `schoolcore-frontend` from `404c2ac` per standard release path if frontend assets changed (boarding UI changed) — do not leave UI/backend mismatched.
5. Health checks: `sudo -n /opt/schoolcore/scripts/production-health.sh` and endpoint checks (frontend, Convex API, OIDC discovery, JWKS 200 as applicable); confirm Postgres healthy, 0 SchoolCore host-published ports, `/srv/platform` unchanged/healthy, Freebuff paused.

**Post-deployment runtime & browser validation (disposable fixtures, production):**
6. Create/identify disposable `TEST-`/`P8-` fixtures in isolated test school/records (or approved existing test school) via application-supported mutations; record IDs out-of-band for cleanup. Do not mutate real tenant data.
7. Execute gate 1 runtime matrix (boarding + payment authz) against production deployment **running `404c2ac`** with disposable identities; capture pass/fail evidence for linked-parent, unlinked, cross-school, student-self, unauthorized actor, and `payments_external.view` cases.
8. Execute gate 2 browser checks against production URL with disposable parent/student accounts (boarding visibility and rendering states).
9. Verify gate 4: confirm no live M-Pesa creds active in test context and no STK/live payment initiated; review `paymentRequests`/provider/audit side effects for test fixtures only.
10. **Cleanup:** disable/revoke disposable test logins, remove/neutralize fixtures where application-appropriate, verify no orphan links, no active test sessions, and original records unchanged.
11. Re-run targeted authz smoke/regression relevant to touched areas (`portal`, payments) if feasible; record results.

**Stop/rollback triggers:** any health degradation, authz/isolation failure, unexpected payment/provider side effect, inability to prove no live M-Pesa initiation, or failed cleanup containment → stop and execute rollback (gate 6).

### 6) Rollback plan to production commit `cf01f1e`
- **Baseline (last known-good):** `cf01f1ef548684e68fdda705d6adf025fc34d73e` on `selfhost-production` (currently deployed; frontend image recorded as `schoolcore-frontend:8f4b84fcf1bdf6755033f60f0bf35bf1b5ab85f6` at prior verification — redeploy matching `cf01f1e` frontend artifact/image).
- **Scope:** patches are Convex/frontend logic changes; **no schema migrations introduced**.
- **Code rollback:**
  1. `REPO=/opt/schoolcore/app/source/schoolcore; SHA=cf01f1ef548684e68fdda705d6adf025fc34d73e`
  2. `git -C "$REPO" fetch --quiet origin selfhost-production && git -C "$REPO" cat-file -e "${SHA}^{commit}" && git -C "$REPO" checkout --quiet "$SHA"`
  3. Verify `git -C "$REPO" rev-parse HEAD == $SHA` and clean tree.
  4. Redeploy backend: `docker run --rm --network schoolcore-net -e CONVEX_SELF_HOSTED_URL="http://backend:3210" -e CONVEX_SELF_HOSTED_ADMIN_KEY="$AK" -v "$REPO:/src" -w /src convex-cli:1.46.0 sh -c "timeout 600 convex deploy 2>&1"` (require schema validation complete).
  5. Redeploy frontend image/artifacts built from `cf01f1e` to restore UI parity.
  6. Re-run `sudo -n /opt/schoolcore/scripts/production-health.sh`, endpoint checks, and targeted smoke tests (authz/portal/payment permission paths).
- **Data:** code rollback does **not** undo data written by reverted code; if any bad data written, assess separately (restore only if necessary and with delta understood). Convex env-var store considerations apply only on DB restore.
- **Backups:** retain/use latest verified pre-deploy local+off-site backup as restore point if needed (do not restore without assessing post-snapshot delta).

### 7) Scope / non-interference confirmation
- **`/srv/platform` will not be touched.**
- **Freebuff will not be touched** (remains paused / no write actions).
- No merge of PR #3 and no deployment will occur without explicit owner approval.

## Outstanding risks
- **Runtime unverified on `404c2ac`:** boarding visibility, parent/student portal rendering, payment authorization behavior, cross-school isolation, and unauthorized-access rejection have **not** been runtime/browser-tested for this commit; regressions remain possible despite CI/static review.
- **Payment scope incomplete:** M-Pesa remains partial (no HTTP callback route in `http.ts`, reconciliation stub, no evidenced live merchant/callback/env wiring, no end-to-end settlement proof). Hardening reduces auth exposure but does not make M-Pesa production-complete.
- **Environment gap:** no isolated Convex test environment available/provided; controlled production post-deploy testing carries higher operational risk and requires strict disposable-fixture discipline and owner approval.
- **Authz regression not re-run on patch:** 38-case/113-row authz evidence exists for `cf01f1e`, not `404c2ac`.
- **Prior containment residuals (separate):** P8 fixture disabled state not conclusively read back in earlier pass; P9 orphan/duplicate/mixed-state residuals require separate reviewed migration.
- **Broader launch blockers unchanged:** Gate 8.9 fresh onboarding rehearsal incomplete; SCB automated API/integration not evidenced (manual import only); infra/cutover blockers (gdrive OAuth, restic init/off-server password custody, GitHub sensitive-data cleanup, Freebuff password rotation, `SEED_SECRET` deletion, `VLY_INTEGRATION_KEY` removal/revocation, gates 8.5/8.7/8.10-8.13) remain open.

## Exact release recommendation
**RELEASE: BLOCKED (do not merge/deploy `404c2ac` / PR #3 yet).**

**Rationale:** CI is green (1/1 pass) and static validation is acceptable, but required runtime release gates are unmet: no isolated runtime execution for boarding/payment authorization, no browser validation of parent/student portal rendering, and no runtime proof of cross-school isolation/unauthorized rejection/correct boarding visibility on `404c2ac`. `test:authz`/matrix not re-run on the patch. Isolated Convex environment is unavailable.

**Required to unblock (minimum):** owner approval + (preferred) execute gates 1–3 in an isolated Convex environment with disposable test data and no live M-Pesa initiation, including browser checks and documented evidence; or, if owner explicitly accepts risk, execute the controlled production deployment and post-deployment testing plan above with fresh verified backup, successful health/smoke, disposable-fixture containment/cleanup, and no `/srv/platform` or Freebuff impact — then reissue recommendation based on actual runtime evidence. Rollback to `cf01f1e` is prepared and must remain ready.
