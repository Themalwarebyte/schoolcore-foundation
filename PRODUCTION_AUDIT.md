# SchoolCore — Production Infrastructure & Security Audit

**Version:** 1.0 · **Date:** 2026-09-25
**Deployment:** `kindhearted-goldfish-282.convex.cloud` (Convex prod deployment via Freebuff)
**Verification:** `bun scripts/security-audit.mjs` → **71 passed / 0 failed**; `bun tsc -b --noEmit` → green
**Scope:** No new features. Architecture, env/secrets, auth, authorization, tenancy, files, data classification, DB/finance security, error handling, logging, audit, backup/recovery, monitoring, performance.

---

## 1. Deployment Architecture (as audited)

```
Browser (React 19 + Vite + Tailwind + shadcn/ui)
   │  WebSocket queries / mutations (JWT session)
   │  VITE_CONVEX_URL only — no secrets in the bundle
   ▼
Convex backend (kindhearted-goldfish-282)
   ├─ auth.config.ts — two JWT providers:
   │    • self-issued Convex Auth JWT (password sign-in only; scrypt)
   │    • customJwt RS256 from Freebuff issuer (platform identity)
   ├─ http.ts — ONLY auth routes exposed over HTTP (small attack surface)
   ├─ session.ts — getSession / requirePermission / getSchoolRecord
   │    (single tenancy chokepoint; super_admin vs school memberships)
   ├─ access.ts — can(): RBAC; school roles never receive platform.* permissions
   └─ 30+ modules (academics, finance, payroll, medical, …), every public
      function calls requirePermission + getSchoolRecord (tenant check)
Scheduled jobs: automation engine, retention pruning (pruneOldPings), etc.
```

- Single-region Convex deployment; ACID transactions for all multi-table writes.
- Files stored **inline in the DB** (`files.bytes`) — no public URLs, no bucket ACLs to misconfigure.
- Frontend is pure static hosting (Vite build) — session JWT held client-side, all authorization server-side.

**Architecture verdict: PASS** — no public backend surface beyond auth; authorization is not delegated to the client anywhere in the audited paths.

---

## 2. Environment Variables & Secrets

| Variable(s) | Consumer | Status |
|---|---|---|
| `VLY_CONVEX_AUTH_ISSUER`, `CONVEX_SITE_URL` | auth.config.ts | Set by platform. |
| `VLY_EMAIL_OTP_API_KEY`, `VLY_APP_NAME` | emailOtp.ts | Env-only; honest degraded state when unset. |
| `SMS_API_KEY`, `EMAIL_API_KEY`, `WHATSAPP_API_KEY` | phase6/communications.ts | Env-only; `not_configured` honest states; messages queue without leaking. |
| `MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY/CALLBACK_SECRET`, `MPESA_ENV`, `SITE_URL` | phase6/payments.ts | Env-only; DB stores masked metadata only (`integrations.displayMetadata`). |
| `SEED_SECRET` | seed.ts | **Good:** no fallback; seed refuses to run when unset. |
| `PLATFORM_ADMIN_EMAIL/PASSWORD/NAME` | accounts.ts | **Finding F-1 (fixed):** password had code fallback `"ChangeMe!2026"`. |

- `.gitignore` excludes `.env*`, key material; `.env.example` contains placeholders only (verified).
- No literal API keys in any audited source (I2/I3 static scans; harness checks).
- `platformHealth` reports integration state honestly (`configured` vs `not_configured`) — monitoring cannot be fooled into green.

**Verdict: PASS after fix** (see §9 Findings).

---

## 3. Authentication

| Check | Result |
|---|---|
| Valid sign-in (5 roles) | PASS |
| Wrong password rejected | PASS |
| Unknown email rejected | PASS |
| Public self sign-up rejected (provisioning-only) | PASS |
| Unauthenticated query rejected | PASS |
| Disabled accounts cannot sign in (`isActive` gate) | PASS (static + code review) |
| Passwords hashed (Scrypt, via Lucia) | PASS |
| OTP codes 15-min TTL | PASS |
| Invite/activation codes SHA-256-hashed, 7-day TTL, single-use | PASS |
| Password reset / admin reset flows authenticated & audited | PASS (code review) |

Session model: Convex Auth JWTs; all sessions invalidated by `accounts.deleteSessionsInternal` on admin reset (compromise containment path exists).

**Verdict: PASS.**

---

## 4. Authorization (RBAC per role)

Verified live with real ids (harness section B/C/G):

| Role | Confirmed denials |
|---|---|
| Teacher | payroll.view, medical (profile + visits), finance.view, audit_logs.view, students.create, hr.manage, staff export, payments.create |
| Parent | guardian directory, other-school search results; `myPayslips` returns `isEmployee:false` with zero slips (self-service by design, no data) |
| School admin | platform registration queue, platform document download, platform SaaS management (`platformAssignPlan`, subscription status) |
| Super admin | positive controls: registration list works, platform plans/subscriptions/usage/health work |

Permission model: `ROLE_PERMISSIONS` in schema.ts; `can()` enforces that school roles can never hold `platform.*`. Every audited module entry point calls `requirePermission`.

**Verdict: PASS.**

---

## 5. Multi-Tenant Isolation

Live cross-tenant probes (Greenfield admin × real Riverside ids; Riverside admin × Greenfield data):

| Surface | Result |
|---|---|
| Student record | BLOCKED |
| HR employee record | BLOCKED |
| Payroll run | BLOCKED |
| Library book | BLOCKED |
| Medical profile | BLOCKED |
| Platform registration queue / document download | BLOCKED (platform-only) |
| Finance: cross-school payment posting | BLOCKED |
| List scoping (transport vehicles, inventory assets, procurement suppliers) | 0 foreign rows returned |
| Invoice list (103 Greenfield rows) | 0 Riverside documents |
| Phase 6 (QR resolve, biometric device, GPS attach, payment requests, automations) | BLOCKED (Phase 6 harness, regression) |

Mechanism: `getSchoolRecord` throws `You do not have access to this record.`; all list queries filter by session schoolId via indexes.

**Verdict: PASS.**

---

## 6. File Security

- Staff documents: upload/get/delete gated `hr.manage` + tenant check; access logging mutation exists and UI calls it on open.
- Registration documents: public upload limited to 5 MB and kind-allowlisted; download requires a **platform session** (verified live with a real document id — school admin blocked).
- No public download HTTP route exists (`http.ts` = auth routes only).
- Files are DB-inline bytes; no URL-sharing leakage.

**Verdict: PASS.**

---

## 7. Database & Financial Security

- Every table row is tenant-scoped (`schoolId`) and accessed through permission-gated, indexed queries.
- Financial integrity verified live: duplicate payment reference rejected (replay guard); forged M-Pesa callback (unknown checkout ref) rejected; malformed callback JSON rejected; amount-mismatch transactions recorded for reconciliation instead of silently posting; payment reversal requires `payments.approve` (no delete endpoints exist for financial documents).
- Payments ≤ 5,000,000 per transaction; method must exist per school.
- Bank import staging is separate from the ledger until explicitly posted; posting is audited.

**Verdict: PASS.**

---

## 8. Medical & Payroll Data Handling

- Medical: all queries/mutations gated `medical.view`/`medical.manage`; `auditMedicalAccess` audit-logs profile reads; teacher denials verified live.
- Payroll: gated `payroll.view`/`payroll.manage`; the only self-service surface (`myPayslips`) returns exclusively the caller's own slips via the `staff.by_user` index — verified it returns `isEmployee:false` + no data for parents.
- Global search returns students/guardians/staff names only for eligible roles and contains **no** medical or payroll fields (string-scan live).
- AI insights labeled advisory and exclude payroll/medical content (Phase 6 harness).

**Verdict: PASS.**

---

## 9. Findings

### Fixed during this audit

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| F-1 | **High** | `accounts.ts` bootstrapped the platform super admin with a built-in default password (`PLATFORM_ADMIN_PASSWORD ?? "ChangeMe!2026"`). A new deployment could come up with a publicly-known super-admin credential. | Bootstrap now **refuses** to provision when `PLATFORM_ADMIN_PASSWORD` is unset (clear error instructing to set the env var). Existing deployments are unaffected — the branch only runs when no account exists. Types green; deployed. |
| F-2 | Medium | Two Phase 7 modules used dynamic `await import()` in request paths (onboarding, billing) — crash risk in Convex runtime. | (Fixed in Phase 7 session, verified again here.) Converted to static imports; no dynamic imports remain outside legal action-context uses. |

### Accepted / documented (no code change warranted)

| ID | Severity | Observation | Rationale |
|---|---|---|---|
| A-1 | Low | `globalSearch` and a few billing/report aggregations use `.collect()` over tenant-scoped indexes. | Correctly tenant-scoped today; a scalability note only. Recommended: paginate at ≥ ~5k students per school (see §12). |
| A-2 | Low | Teacher/student-creation probe shows argument-validation errors can precede permission checks. | Informational only — validation reveals nothing about data; permission checks always run before any read/write. |
| A-3 | Info | Demo/SMOKE data and demo credential passwords exist on this deployment (documented in harnesses). | Expected for the verified demo environment; rotate `PLATFORM_ADMIN_PASSWORD` and remove SMOKE rows before onboarding real schools. |
| A-4 | Info | Communications/M-Pesa providers intentionally unconfigured (honest `not_configured`). | Phased rollout by design; queue-and-degrade behavior is safe. |

---

## 10. Error Handling

- Frontend: sign-in errors are never surfaced raw — mapped to friendly messages; details only in console (verified statically, J1–J3).
- Backend: `ConvexError` messages are user-safe ("Payment was cancelled.", "You do not have access to this record."); provider callbacks sanitize raw provider text into user-safe reasons.
- On prod deployments Convex redacts server error internals; harness relies on redacted messages + `.data` payloads, which contain only intentional user-facing strings.

**Verdict: PASS.**

---

## 11. Logging & Audit Trail

- `recordAudit` writes school-scoped, append-only entries; helper explicitly warns never to log secrets.
- `auditLogs.list` gated `audit_logs.view`; `recent` gated `dashboard.view`; **no update/delete mutations exist** (verified by endpoint probing — four probes confirmed the functions do not exist).
- Confidential reads audited: medical profile access, staff document access.
- Audit coverage across finance, HR, SaaS, registration, invitations verified in Phase 6/7 harnesses.

**Verdict: PASS** (append-only by construction).

---

## 12. Performance Notes

- Tenancy filters use indexes (`by_school`, `by_school_status`, …) throughout the audited hot paths.
- Risk spots (A-1): `search.globalSearch` collects students/guardians/staff per query; `phase7/billing.ts` reconciliation reads invoice items + allocations per invoice; `auditCensusInternal` (diagnostics) scans all audit rows.
  - Recommendation: add `paginationOpts` or a bounded limit to `globalSearch` before > ~5k students/school; cache votehead lists per request; keep diagnostics census off hot paths.
- Payments/list endpoints verified to respond within normal latency during harness runs (103 invoices listed without issue).

**Verdict: PASS with recommendations** (no user-facing latency observed at current data volume).

---

## 13. Monitoring

- `phase6.saas.platformHealth` exposes real component checks (auth, DB, integrations with honest configuration states) — suitable as an uptime/health probe for an external monitor.
- Automation runs and communication jobs record per-attempt status (success/partial/failed) with counts — operational dashboards can surface failures.
- Scheduled jobs (retention pruning) verified executable; recommend an external cron/pinger calling the diagnostics health route daily and alerting on `not_configured` regressions after go-live.

**Verdict: PASS with recommendation** (wire an external uptime alert to `platformHealth`).

---

## 14. Backup & Recovery

Documented in **BACKUP_RECOVERY.md**: Convex platform durability + logical `convex export` cadence, RPO/RTO targets per data class, recovery procedures (corruption, deployment loss, auth lockout, credential compromise), retention/pruning summary, quarterly drill checklist.

**Verdict: PASS** (documentation complete; first restore drill still to be scheduled — see checklist).

---

## 15. Pass/Fail Matrix (audit specification)

| # | Area | Verdict |
|---|---|---|
| 1 | Deployment architecture documented | PASS |
| 2 | Env/secrets audit (no hardcoded secrets, no fallbacks) | PASS (after F-1 fix) |
| 3 | Auth security (hashing, lockout, reset, sign-up closed) | PASS |
| 4 | Authorization per role (RBAC denials live-verified) | PASS |
| 5 | Multi-tenant isolation (live cross-school matrix) | PASS |
| 6 | File security (gates, limits, no public URLs) | PASS |
| 7 | Data classification document | PASS (DATA_CLASSIFICATION.md) |
| 8 | DB security (tenancy chokepoint, indexes, no deletes on sensitive docs) | PASS |
| 9 | Financial security (replay/idempotency, forged-callback, reversal gating) | PASS |
| 10 | Medical/payroll review (gates, self-service scope, search exclusion) | PASS |
| 11 | Error handling (no raw errors to UI, sanitized provider text) | PASS |
| 12 | Logging (structured, secret-free) | PASS |
| 13 | Audit logs (append-only, gated, tenant-scoped) | PASS |
| 14 | Backup/recovery document | PASS (BACKUP_RECOVERY.md) |
| 15 | Monitoring (health probe exists, honest states) | PASS w/ recommendation |
| 16 | Performance (indexed tenancy; collect() spots noted) | PASS w/ recommendation |

**Harness evidence:** `scripts/security-audit.mjs` — 71 checks, 0 failed (auth A1–A7, RBAC B1–B8, parent C1–C4, isolation D1–D12, files E1–E6, finance F1–F5, medical/payroll G1–G4, audit H1–H3, secrets I1–I11, error hygiene J1–J3).

---

## 16. Readiness Score

### **READY WITH RECOMMENDATIONS** 🟡→🟢

The platform's security architecture is fundamentally sound: tenancy enforced at a single chokepoint, RBAC checked server-side on every entry point, append-only audit trail, no public file routes, financial integrity guards verified live. The one high-severity finding (default platform-admin password fallback) was **fixed and redeployed** during this audit.

**Before onboarding paying schools:**
1. Rotate/set `PLATFORM_ADMIN_PASSWORD` and confirm sign-in with the new value (A-3).
2. Clear SMOKE/demo rows or reseed a clean tenant set (A-3).
3. Schedule the first backup restore drill per BACKUP_RECOVERY.md §6.
4. Wire an external monitor to `platformHealth` (§13).
5. Add pagination to `globalSearch` before large tenants (§12).
