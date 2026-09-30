# SchoolCore — Production Security Review

Date: 2026-09-29. Branch: `selfhost-production`. Deployment: `gman-02`
(self-hosted Convex, PostgreSQL, nginx, cloudflared).
Reviewer scope: the self-hosted SchoolCore deployment and its repository.

This review covers 8.6 of Phase 8. Phase 8 remains **open**: DR, database
review, performance baseline, onboarding rehearsal, commercial operations,
archive policy, runbook and pilot review are all out of scope here and are not
addressed by this document.

---

## 1. Scope

**In scope**

- Authorization behaviour of the role model, verified against the live
  self-hosted deployment rather than by inspection alone.
- Dependency vulnerability posture, separated into production and development
  reachability.
- Docker health-check coverage of the running containers.
- SSH daemon configuration of the host.
- The production monitoring and alerting path, because a monitoring system that
  cannot alert is a security control that does not exist.

**Explicitly out of scope (not started, not assessed)**

- Disaster recovery and restore rehearsal (8.5).
- Database design, indexing and query review (8.7).
- Performance baseline and capacity (8.8).
- Onboarding rehearsal (8.9).
- Commercial operations (8.10).
- Archive and retention policy (8.11).
- Runbook consolidation (8.12).
- Pilot readiness review (8.13).
- Anything on Freebuff, which remains paused as the write-freeze control, and
  anything under `/srv/platform`, which is a different deployment entirely and
  was not touched.

---

## 2. Methodology

1. **Source first, then execution.** Every authorization judgement was taken
   from the code and then confirmed by calling the live deployment. No verdict
   was inferred from a function name.
2. **Two-source fixture validation.** Fixture mappings were confirmed both from
   stored relationships and through the application's own resolvers before any
   authorization call.
3. **Strict verdict classification.** `ALLOWED`, `DENIED_AUTHORIZATION`,
   `INVALID_ARGUMENTS`, `FUNCTION_ERROR`, `HARNESS_ERROR`. A test was scored
   only when the harness returned a real verdict; parse failures and unknown
   errors were fixed and re-run, never converted into a pass or a fail.
4. **Reachability, not severity alone, drives disposition.** A CVE in a
   production dependency that is not on any reachable code path is recorded at
   its true severity but is not conflated with one that is.
5. **Read-only by default on the host.** No live configuration was changed
   without a verified owner path and a rollback.

---

## 3. Findings and fixes

### 3.1 FIXED — student horizontal access for parent and student roles (CRITICAL)

The confirmed pilot blocker from the authorization validation.

`students:get`, `students:stats` and `students:recent` gated on session
presence (`getSession` / `requireSchoolSession`) rather than on the
`students.view` permission. The parent role (9 permissions) and the student
role (6 permissions) hold no `students.view`, so any parent or student account
could read other students inside its own school.

Impact measured before the fix: `students:get` returned a full student record
(name, date of birth, gender, nationality, boarding status, admission number)
for any same-school student; `students:recent` enumerated the school roll;
`students:stats` returned whole-school aggregates. Cross-school access was
already refused, so this was horizontal intra-tenant escalation, not a tenant
break.

Fixed in `db1fe52`. `students:get` now resolves the caller through the existing
`parentIdentity` / `studentIdentity` portal resolvers and permits only a linked
child or the student's own record; `students:stats` and `students:recent` now
require `students.view` **in addition to** the pre-existing school-context
check, which keeps the change strictly additive.

Verified: regression suite 20 pass / 6 fail before, 26 pass / 0 fail after;
full 101-row matrix 94/6/0 before, 100/0/0 after.

### 3.2 FIXED — production alerting could not deliver any alert (CRITICAL)

Found while completing 8.4. Two independent defects, either of which alone
suppressed every alert, and together guaranteed that **no** DEGRADED or
CRITICAL alert had ever been sent.

**Defect A — state never matched a dispatch arm.**
`production-alert.sh` derived the health state with
`grep '^STATUS=' | cut -d= -f2`. The health script emits
`STATUS=DEGRADED (warn=1)`; splitting on the first `=` yielded `DEGRADED (warn`,
which matched none of the `case` arms `HEALTHY)`, `DEGRADED)`, `CRITICAL|UNKNOWN)`.
The `case` had **no `*)` default**, so control fell straight through: nothing
sent, nothing logged, exit 0. `CRITICAL (critical=1 warn=0)` truncated to
`CRITICAL (critical` and failed the same way. Only `HEALTHY` — whose value
contains no `=` — ever matched.

*Evidence:* the state file contained the literal string `DEGRADED (warn`, and a
simulated run reported `DEGRADED (warn -> DEGRADED => ALERT:degraded` — a
spurious transition on every evaluation.

**Defect B — the alert body was not valid JSON.**
`send_mail` interpolated a multi-line body straight into a JSON string. A
literal newline is an invalid control character inside a JSON string, so the
provider rejected every alert with HTTP 400
`{"name":"validation_error","statusCode":400}` and `send_mail` reported
`alert FAILED to send`.

*Evidence:* replaying the exact payload returned HTTP 400 and
`Invalid control character at: line 1 column 169`; the identical body with
newlines escaped was valid JSON and delivered successfully.

*Fix:* the state is now extracted as the leading uppercase token, a fail-safe
`*)` arm alerts on any unrecognised status instead of falling through, and a
`json_escape` helper escapes backslash, quote, newline, tab and carriage return
in the subject, body and sender before they are embedded.

*Verification after the fix:*

| Check | Result |
|---|---|
| State token from `STATUS=DEGRADED (warn=1)` | `DEGRADED` (was `DEGRADED (warn`) |
| `HEALTHY` branch | recovery notice selected |
| `DEGRADED` / `CRITICAL` / `UNKNOWN` / garbage | correct arm selected in every case |
| Real HEALTHY → DEGRADED transition | `alert sent: SchoolCore DEGRADED` |
| Immediate re-run | `degraded persists, within cooldown - not re-alerting` |
| Direct transport delivery test | **PASS** (provider message id returned) |

Backups: `production-alert.sh.bak-p8pref` (pre state-parsing fix),
`production-alert.sh.bak-p8prejson` (pre JSON-escaping fix).

**Standing caveat:** neither defect was detected by the health check itself,
because the health check reports state correctly and only the *alerting* layer
was broken. A system that can be silently failing to alert is a monitoring gap
in its own right, and §7 records the change made so the alerting path has an
exercised end-to-end test rather than only a transport test.

### 3.3 FIXED — production-reachable Hono advisories (MODERATE, LOW)

`hono@4.12.27` was a direct production dependency and is the HTTP server
(`main.ts` → `Hono`), so its advisories were on the live request path. Upgraded
to `4.13.11`, within the existing `^4.10.7` range — no major version change.
This cleared six MODERATE and one LOW advisory, including a CORS `ReDoS` via
`Access-Control-Request-Headers` and an algorithmic-complexity DoS.

Dependency vulnerability count: **25 → 18**.

---

## 4. Deferred and accepted risks

### 4.1 OPEN — `staff:get` authorization defect (AUTHORIZATION DEFECT, assessed, not patched)

Assessed as instructed and deliberately **not** patched in this pass.

**Roles that can call it:** any signed-in account holding a school membership.
`staff:get` (`staff.ts:52-92`) uses bare `getSession` and never calls
`requirePermission`, so it is not gated on `staff.view`. By contrast
`staff:list`, `staff:stats` and `staff:departments` in the same module all
require `staff.view`. `staff.view` is granted to exactly three roles; neither
`parent` nor `student` holds it.

**Fields returned:** the whole `staff` document plus teacher allocations and
the linked user's name and email. The `staff` table has no `nationalId` and no
salary field, so this is materially less sensitive than the student case, but it
does expose `phone`, `email`, `gender`, `hireDate`, `employmentType`,
`employmentStatus`, free-text `notes`, and `updatedById`.

**School scope:** enforced. `member.schoolId !== session.schoolId` refuses
cross-school reads for every role tested.

**Empirical result** (Greenfield target, live deployment):

| Caller | Result | Expected |
|---|---|---|
| school admin | ALLOWED | ALLOWED |
| teacher | ALLOWED | ALLOWED |
| **parent** | **ALLOWED** | **DENIED** |
| **student** | **ALLOWED** | **DENIED** |
| anonymous | DENIED | DENIED |
| any role, cross-school | DENIED | DENIED |
| parent → `staff:list` / `staff:stats` | DENIED | DENIED (control) |

**Classification: AUTHORIZATION DEFECT.** Same class and same cause as §3.1, in
the module directly adjacent to it.

**Severity judgement:** moderate rather than pilot-blocking. The exposed fields
carry no national identifier, date of birth or compensation, and cross-school
access is refused, so this is intra-tenant exposure of staff contact and
employment metadata — not the child-level personal data of §3.1. It is recorded
as a defect to fix, not as an accepted risk.

**Separate fix plan (executed 2026-09-30 — see §4.1.1, PB-2 CLOSED):**

1. Replace bare `getSession` in `staff:get` with
   `requirePermission(ctx, "staff.view")`, matching `staff:list`.
2. Preserve the tenant check. Note that the current check also refuses the
   platform super admin, because a platform session has a null `schoolId`, so
   a super admin cannot read any staff record. That is a functional
   inconsistency worth resolving deliberately in the same change, in the same
   way `students:get` exempts `session.isPlatform` — but it must be a conscious
   decision, not an accident.
3. Extend `scripts/phase8-authz.test.ts` with staff cases before deploying:
   school admin own / cross-school, teacher own / cross-school, parent denied,
   student denied, anonymous denied, super admin per the decided behaviour.
   Run the suite against the unfixed deployment first to establish it fails,
   then after the fix.
4. Deploy through the release workflow in `PRODUCTION_RELEASE_WORKFLOW.md`,
   including a production backup and a re-run of the full authorization matrix.

`staff:get` has one frontend consumer, the staff-facing `StaffProfile` page,
which holds `staff.view`, so no legitimate flow depends on the current
permissive behaviour.

### 4.2 PILOT BLOCKER — `@auth/core@0.37.4` advisories (CRITICAL, HIGH, MODERATE)

`@auth/core` is a **peer dependency** of `@convex-dev/auth@0.0.90`, which
declares `"@auth/core": "^0.37.0"`.

| Advisory | Severity |
|---|---|
| GHSA-7rqj-j65f-68wh — email normalizer validates before Unicode normalization, homoglyph `@` bypass | CRITICAL |
| GHSA-xmf8-cvqr-rfgj — `getToken()` uncaught exception on malformed `Bearer` headers | HIGH |
| GHSA-x445-f3h2-j279 — OAuth state/nonce/PKCE cookies not bound to their provider | MODERATE |

**Reachability assessment.** The CRITICAL advisory concerns the Auth.js **Email
provider** account normalizer. SchoolCore registers no Auth.js Email provider:
`auth.config.ts` registers a self-issued OIDC provider, an optional Freebuff
federated OIDC provider, and Convex Auth's password provider. Convex Auth
implements JWT handling itself via `jose` and `lucia`, not through the Auth.js
`NextAuth` handler in which the HIGH advisory's `getToken()` lives. A
frontend survey also found no public sign-up or registration entry point; user
accounts are created by school admins through the invite and team-management
flows, so an attacker cannot submit a homoglyph email to account creation. On
that basis the advisories are assessed as **not reachable in the current
configuration**. This is a reasoned conclusion from the provider surface and
the entry points, not a proof; verifying the runtime call graph would be the
way to close it completely.

**Why it is still a pilot blocker rather than a dismissed finding.** The
remediation is not a patch: `@convex-dev/auth` must move `0.0.90 → 0.0.95`,
which moves the peer requirement to `^0.41.1`, and the tree must then be realigned
onto `@auth/core >= 0.41.3`. For a `0.0.x` package every increment is
potentially breaking, and this is the authentication core of a system holding
student personal data. It deserves its own validated pass — CI, production
backup, deploy, full authentication smoke testing including sign-in, JWT
issuance, refresh and every portal role — rather than being folded into a
documentation pass.

**Interim position:** no compensating control is known to be missing, since the
vulnerable code paths are not invoked. This is recorded so it is an owned,
tracked decision before pilot rather than an unnoticed gap.

### 4.3 DEFERRED — `react-router@7.18.1` RSC CSRF advisory (HIGH, not reachable)

GHSA-qwww-vcr4-c8h2 — "RSC Mode CSRF Bypass Allows Action Execution Before 400
Response", affecting `>=7.12.0 <7.18.2`.

**Not reachable.** The advisory is specific to React Router's **RSC mode**.
SchoolCore uses React Router purely in declarative SPA mode — `BrowserRouter`,
`Routes`, `useNavigate`, `Link`, `NavLink`, `useParams`, `useSearchParams`
across 29 import sites — inside a Vite build served as static files by nginx.
There is no React Server Components runtime, no framework mode, no server
actions and no SSR, so the vulnerable path is absent.

**Why deferred rather than patched.** A patched version exists within the
existing `^7.10.0` range (`7.18.4`), so the remediation is a one-line range
change. Applying it, however, changes the Vite build output, and the running
frontend is a baked custom image (`schoolcore-frontend:oauth-pages`) whose
build definition is not in the repository. Rebuilding and redeploying that image
is a larger operational step than a documentation pass should take on its own,
and doing it would put freshly rebuilt frontend assets in front of users for an
advisory that is not reachable.

**Decision:** patch to `>=7.18.2` in the next change that rebuilds and deploys
the frontend image anyway, and treat it as mandatory before pilot. Tracked, not
ignored.

### 4.4 ACCEPTED — development-only dependency advisories (no production exposure)

All remaining advisories reach only the build and lint toolchain, which does
not ship to production and does not process attacker input.

| Package | Version | Severity | Path | Fix |
|---|---|---|---|---|
| `brace-expansion` | 1.1.15, 5.0.7 | HIGH ×5 | `eslint` → `minimatch` | 1.1.18 / 5.0.9 |
| `browserslist` | 4.28.4 | HIGH ×2 | `@vitejs/plugin-react`, `eslint-plugin-react-hooks` | > 4.28.6 |
| `js-yaml` | 4.3.0 | HIGH ×2 | `eslint` | 4.3.2 |
| `nanoid` | 3.3.15 | HIGH ×2 | `vite` → `postcss` | 3.3.18 |
| `postcss` | 8.5.16 | HIGH, MODERATE | `vite` | > 8.5.22 |
| `baseline-browser-mapping` | 2.10.40 | MODERATE | babel helper-compilation-targets | 2.11.0 |

These are DoS and unbounded-memory conditions reachable only by feeding
crafted input to a local build tool or linter. They are not served, not
reachable from a request, and not present in the runtime artifact. The
production frontend build is produced in CI on a throwaway runner.

**Disposition: accepted.** They should be cleared opportunistically when the
toolchain is next refreshed under its own change, not bundled into a security
fix where they would add review surface for no production benefit.

### 4.5 ACCEPTED — SSH `PermitRootLogin without-password` and `X11Forwarding yes`

Assessed read-only; **no live configuration was changed.**

`PermitRootLogin without-password` is the deprecated alias for
`prohibit-password`, which permits key-based root login. On this host
`/root/.ssh/authorized_keys` contains **0 keys**, so key-based root login is
already impossible and the directive is inert. The only authorized key on the
host belongs to the unprivileged `ghub` account, which has passwordless `sudo`.
`sshd -t` passes, so a config test is available as a pre-reload gate.

`X11Forwarding yes` is inert on a headless server with no X server installed and
no X clients, and no `DISPLAY` is ever set. There is no exploit path.

The rest of the daemon configuration is already sound and was verified as
effective values via `sshd -T`: `PasswordAuthentication no`,
`PermitEmptyPasswords no`, `AllowTcpForwarding no`, `PermitTunnel no`,
`GatewayPorts no`, `PermitUserEnvironment no`, `UseDNS no`, `MaxAuthTries 6`,
`LoginGraceTime 120`, and modern post-quantum key exchange with
`mlkem768x25519-sha256`, `sntrup761x25519-sha512` and `curve25519-sha256`.

**Classification: accepted risk.** The change that would be made — setting
`PermitRootLogin no` and `X11Forwarding no` — has no security benefit against
the current state, and both carry a non-zero risk of locking the owner out of a
production host. The task's own condition for changing live SSH configuration
is owner-verified access plus a rollback path; a rollback path for a lockout on
the only production host is not something that can be guaranteed in advance.
Both should be applied in a deliberate SSH change window alongside
`ClientAliveInterval` (currently `0`, so no idle timeout), not opportunistically.

### 4.6 ACCEPTED — no Docker healthcheck on cloudflared and convex-dashboard

Three of five SchoolCore containers already have meaningful health checks:
`schoolcore-frontend` (`wget --spider http://127.0.0.1/healthz`),
`schoolcore-convex-backend` (`curl -f http://localhost:3210/version`) and
`schoolcore-postgres` (`pg_isready -U convex -d schoolcore`).

**`schoolcore-cloudflared` — possible: no. Useful: no.**
`cloudflared` runs `tunnel --no-autoupdate run` and exposes no local HTTP
listener. A check could only confirm the process is alive, which is already
covered by the container's running state and would be cosmetic. The meaningful
question — is the tunnel actually carrying traffic? — is answered only from
outside, by probing the public endpoints.

**`schoolcore-convex-dashboard` — possible: yes. Useful: marginal.**
The dashboard runs `node ./server.js` and does listen on a port, so a
container-local `curl` would work without exposing anything, since zero host
ports are published. But the dashboard is an administrative tool that nothing
in the request path depends on, and the property that actually matters about it
is that it is **private** — which `production-health.sh` already verifies by
asserting it has no public DNS. A process-level healthcheck would add a
restart-on-failure behaviour to a container whose failure has no user impact,
and Docker's default restart policy would then churn a component that is
correctly idle.

**Decision: no healthchecks added. External functional monitoring is
authoritative** — `production-health.sh` probes the real public endpoints
(frontend, Convex API, OIDC discovery, JWKS), asserts the dashboard has no
public DNS, and asserts zero SchoolCore host-published ports, every five
minutes. That measures the property a process check cannot: whether users can
actually reach the system.

---

## 5. Accepted risks summary

| # | Risk | Disposition |
|---|---|---|
| 4.4 | 14 HIGH / 3 MODERATE in dev-only build and lint toolchain | Accepted — not shipped, not request-reachable |
| 4.5 | `PermitRootLogin without-password`, `X11Forwarding yes` | Accepted — inert as configured; changing a production host's SSH carries lockout risk with no benefit |
| 4.6 | No Docker healthcheck on cloudflared / convex-dashboard | Accepted — external functional monitoring is authoritative |

---

## 6. Pilot blockers

| # | Blocker | Severity | Required before pilot |
|---|---|---|---|
| PB-1 | `@auth/core@0.37.4` CRITICAL + HIGH advisories (4.2) | CRITICAL (not reachable in current configuration) | **OPEN** — upgrade `@convex-dev/auth` to `0.0.95` and realign `@auth/core` to `>=0.41.3`; validate with a full authentication smoke pass |
| PB-2 | `staff:get` authorization defect (4.1) | AUTHORIZATION DEFECT (moderate exposure) | **CLOSED** — remediated in `d9ba8b7`, see §4.1.1 |
| PB-3 | `react-router@7.18.1` RSC CSRF (4.3) | HIGH (not reachable) | **OPEN** — raise to `>=7.18.2` in the next change that rebuilds and deploys the frontend image |

Two further items are open but are **not** pilot blockers:

- `academicOps:teacherHome` throws for a contextless platform super admin
  (`academicOps.ts:137`, an unchecked `session.schoolId` cast into `db.get`).
  This is an availability defect on a teacher-facing endpoint, not an isolation
  failure — no data is returned. The same unchecked-cast pattern is present in
  many school-scoped handlers and warrants a dedicated review.
- `phase7/access:permissionMatrix` is readable by any signed-in user
  (`phase7/access.ts:90-100` uses `getSession` only). It exposes permission
  names rather than data, so severity is low, but it does widen the
  authenticated surface intentionally and should be a conscious decision.

---

## 7. Limitations

- Dependency reachability is reasoned from the provider surface, the entry
  points and the deployment shape. It is not derived from a runtime call-graph
  trace; a trace would be the way to close §4.2 completely.
- `bun audit` covers the JavaScript dependency tree only. Container image
  contents (`postgres:17-alpine`, `cloudflare/cloudflared`, the Convex
  backend and dashboard images, the custom frontend image) were not scanned in
  this pass. Convex backend, dashboard, PostgreSQL and cloudflared images are
  all pinned by digest, which is good practice, but pinned is not scanned.
- The authorization matrix covers the role model and the endpoints exercised.
  Write-path authorization was not exhaustively tested; a handful of
  attendance and assessment mutations were exercised, and the remainder is
  inferred from the enforcers in source plus read-path evidence.
- The dataset has no `terms` and no `invoices`, so `results:sheet`,
  `results:preview` and fee/invoice content paths were verified for their
  authorization gate but not for their data behaviour.
- Multi-school users are not representable in this dataset, so the
  first-active-membership behaviour in `getSession` remains untested.
- 1254 tombstoned documents exist in the document store and were excluded from
  all queries; every count in this review is live documents only.
- Freebuff and `/srv/platform` were not examined; both are outside this
  deployment's trust boundary for this pass.

---

## 4.1.1 PB-2 remediation — `staff:get` closed

Remediated 2026-09-30. Deployed commit **`d9ba8b7330bc69cc34408f799f285cb13b57bde7`**,
branch `selfhost-production`, CI run #10 success.

**Root cause.** `staff:get` was the only staff read handler with no role gate:

| Handler | Gate |
|---|---|
| `staff:list` | `requirePermission(ctx, "staff.view")` |
| **`staff:get`** | **`getSession(ctx)` + tenant check** |
| `staff:stats` | `requirePermission(ctx, "staff.view")` |
| `staff:departments` | `requirePermission(ctx, "staff.view")` |
| `staff:create` / `update` / `archive` | `requirePermission` on `staff.create` / `update` / `archive` |

`getSession` proves only that the caller is signed in with an active school
membership. Any such account — including `parent` and `student`, neither of
which holds `staff.view` — could therefore read an individual staff record.

**Change.** One line, using the same helper and permission as its neighbours:

```diff
-    const session = await getSession(ctx);
+    const session = await requirePermission(ctx, "staff.view");
```

The tenant boundary on the following line is untouched. `getSession` was removed
from the import because the file had no other use of it. No other permission,
module, role or frontend file was changed.

**Super-admin decision — secure denial preserved.** `requirePermission` passes
for `super_admin` because `can()` is unconditional, and the existing tenant
check then refuses the record, since a platform session carries a null
`schoolId`. Behaviour is therefore unchanged: DENIED before, DENIED after.
This matches the established convention — school-scoped reads gate on
`requirePermission` and scope by `session.schoolId`, while cross-school platform
reach is provided by separately-named platform endpoints (`platform:*`,
`schools:listSchools`, `phase7/access:accessOverview`). Adding
`session.isPlatform` here would have invented a global-access model this
handler never had.

**Behaviour change worth recording: teachers lose direct-URL `staff:get`.** The
teacher role does **not** hold `staff.view` — `ROLE_PERMISSIONS` grants it to
`school_admin`, `principal` and `accountant` only. Before the fix a teacher could
read a staff record *only* because there was no gate; they were already refused
by `staff:list` and `staff:stats`, and the Staff & Teachers nav item is gated on
`permission: "staff.view"` (`school-layout.tsx:53`), so a teacher never saw that
section. Requiring the permission closes the direct-URL route `/staff/:staffId`
rather than withdrawing access a teacher was ever meant to have. This surfaced
as one failing suite case on the first post-fix run; the expectation was
verified against `ROLE_PERMISSIONS` and corrected, not the code.

**Validation.**

| Stage | Result |
|---|---|
| Before-state, live deployment | parent `ALLOWED`, student `ALLOWED` — both expected `DENIED` |
| Before-state, same repository | parent and student already `DENIED` on `staff:list` and `staff:stats` |
| Regression suite, UNFIXED | **36 pass / 2 fail** — the 2 failures exactly the parent and student cases |
| Regression suite, POST-FIX | **38 pass / 0 fail** |
| Extended authorization matrix, POST-FIX | **113 pass / 0 fail / 0 retest** (101 original + 12 staff rows) |
| Deployed commit | `d9ba8b7`, clean tree, no index deletions, no generated-file drift |
| Dependency drift | none — `package.json`, `bun.lock`, `src/convex/_generated` untouched |

**Residual observation, not fixed.** Platform super admin still receives an
empty page from `staff:list` (its null `schoolId` makes the school index query
match nothing) while being refused `staff:get`. Both are consequences of the
same null `schoolId`, not a deliberate design. Recorded rather than resolved,
because changing it would mean inventing a cross-school access model.

---

## 8. Security review status

| Area | Status |
|---|---|
| Role authorization matrix | **COMPLETE** — 100/100, no unverified category |
| Student horizontal access defect | **FIXED** — `db1fe52` |
| Production alerting path | **FIXED** — two defects, verified end to end |
| Production-reachable dependency findings | **FIXED** — Hono 4.12.27 → 4.13.11 |
| `staff:get` defect | **FIXED** — `d9ba8b7`, PB-2 closed |
| Off-site backup freshness signal | **FIXED** — `production-health.sh` read the oldest snapshot (`MONITORING_AND_ALERTING.md` §7.4) |
| Dependency audit | **COMPLETE** — 18 open, all triaged with disposition |
| Docker healthcheck review | **COMPLETE** — no change, external monitoring authoritative |
| SSH hardening review | **COMPLETE** — no change, accepted risk |

**8.6 security review: COMPLETE**. Of the three pilot blockers, **PB-2 is
closed**; PB-1 and PB-3 remain open and owned.

Phase 8 remains **open**. This document does not claim Phase 8 complete.
