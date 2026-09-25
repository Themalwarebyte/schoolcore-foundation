# SchoolCore — Backup & Recovery

**Version:** 1.0 · **Date:** 2026-09-25 · **Scope:** Convex database (all schools), uploaded files, configuration, and the SaaS deployment itself.

---

## 1. Platform Responsibilities (Convex-managed)

SchoolCore is a Convex-native application: **all persistent state lives in Convex** (tables + inline file bytes in the `files` table). Convex provides the following platform guarantees:

| Capability | Provided by | Notes |
|---|---|---|
| Storage durability | Convex underlying storage | Writes are replicated; single-node failures do not lose committed transactions. |
| Point-in-time browse | Convex Dashboard → Data | Historical table browsing for troubleshooting. |
| Deployment isolation | `kindhearted-goldfish-282` (this deployment) | Dev/prod separation reduces accidental destructive writes. |
| Function-level safety | ACID transactions | Multi-table writes (payments + ledger + audit) commit atomically or not at all. |

**What Convex does NOT provide automatically:** logical exports you control, cross-region copies, or application-level retention. Sections 3–5 cover those.

---

## 2. What Must Be Recoverable

| Asset | Where | Priority | RPO target | RTO target |
|---|---|---|---|---|
| Student/guardian/staff records | `students`, `guardians`, `staff`, memberships | Critical | ≤ 24 h | ≤ 8 h |
| Financial ledger (invoices, payments, allocations) | `finance` tables | Critical | ≤ 1 h (finance is the audit-sensitive core) | ≤ 8 h |
| Payroll & HR records | `payrollRuns`, `payslips`, `staff` documents | Critical | ≤ 24 h | ≤ 24 h |
| Medical records | `medicalProfiles`, `medicalVisits` | Critical (legal retention) | ≤ 24 h | ≤ 24 h |
| Academic history (enrollments, scores, promotion history) | academics tables | High | ≤ 24 h | ≤ 24 h |
| Uploaded documents | `files` (bytes inline) | High | ≤ 24 h | ≤ 24 h |
| Audit logs | `auditLogs` | Critical (append-only) | ≤ 1 h | ≤ 8 h |
| Configuration (voteheads, categories, methods, flags) | config tables | Medium | ≤ 7 d | ≤ 24 h |
| Auth accounts | Convex Auth internal tables | Critical | ≤ 24 h | ≤ 8 h |

---

## 3. Backup Strategy

### 3.1 Logical export (recommended cadence)

Run via the Convex CLI from a trusted machine (git-bash/CI):

```bash
# Full logical export (snapshots all tables) — weekly, and before any risky change
bun convex export --deployment kindhearted-goldfish-282 --output-path backup-$(date +%Y%m%d).zip

# Export a single critical table — daily for finance
bun convex export --table invoices --output-path invoices-$(date +%Y%m%d).zip
bun convex export --table payments --output-path payments-$(date +%Y%m%d).zip
bun convex export --table auditLogs --output-path auditlogs-$(date +%Y%m%d).zip
```

**Handling of exports:** every export contains P0/P1/P2 data. Store encrypted (age/gpg with a key in a separate location), restrict download to the platform administrator, and delete local copies after upload to secure storage.

**Retention:** keep daily table exports 30 days; weekly full exports 12 months; then per legal retention needs (financial and student records typically 7+ years — archive those exports, do not delete).

### 3.2 Snapshot before changes

Take a full export before each of the following:
- schema migrations (`convex dev` pushes that add/alter tables)
- seed/repair script runs (`seedAll`, `prod-repair`)
- promotion/term-rollover operations
- platform account or subscription changes

### 3.3 Application-level redundancy already in place

- **Audit logs are append-only** (no update/delete functions exist) — the audit trail survives user error by construction.
- **Idempotent writes** (payment reference dedup, import duplicate-skip, promotion re-runs) — re-running a recovery action does not double-post.
- **Atomic transactions** — a half-applied payment/ledger state cannot persist.

---

## 4. Recovery Procedures

### 4.1 Accidental data corruption (application level)

1. Freeze writes: suspend the school's subscription via platform (`platformSetSubscriptionStatus: suspended`) if the corruption is school-scoped.
2. Identify the affected window from `auditLogs` (last good action → first bad action).
3. Rebuild affected rows from the most recent export (manual re-import via the phase7 import flows with `duplicateStrategy: "skip"`, or scripted `ctx.db.patch` by the platform admin).
4. Document the incident in the audit trail (an `recordAudit` entry via an admin action).

### 4.2 Lost / corrupted Convex deployment (platform level)

1. Provision a fresh deployment and deploy code (`bun convex dev --once` against the new URL).
2. Set required env vars (`SEED_SECRET`, `PLATFORM_ADMIN_PASSWORD`, `VLY_*`, `MPESA_*`, provider keys) — **never** defaults.
3. Restore data from the latest full export using `convex import` per table (respecting FK order: schools → users/auth → students/guardians/staff → academics → finance → other modules).
4. Re-provision the platform super admin (bootstrap now refuses default passwords — set `PLATFORM_ADMIN_PASSWORD` first).
5. Point the frontend `VITE_CONVEX_URL` at the new deployment; verify with `bun scripts/security-audit.mjs <url>` and `bun scripts/phase7-verify.mjs <url>`.

### 4.3 Auth lockout (super admin unavailable)

1. Verify the account exists and is active (`accounts.getUserAccessInfo` via diagnostics bridge).
2. If disabled: re-enable via `accounts` admin mutation with a platform session of a second super admin.
3. If no super admin can sign in: set `PLATFORM_ADMIN_EMAIL` to the intended admin + `PLATFORM_ADMIN_PASSWORD`, run the seed/bootstrap action once to attach the `super_admin` membership (bootstrap is idempotent), then remove the password env var if policy requires.
4. Sessions of compromised accounts: `accounts.deleteSessionsInternal` invalidates all tokens immediately (used by admin reset flows).

### 4.4 Compromised credentials / tokens

- Platform admin: rotate `PLATFORM_ADMIN_PASSWORD` + `deleteSessionsInternal` for that user.
- M-Pesa or provider keys: rotate at the provider, update env vars, redeploy functions.
- Invite/activation codes: hashed and single-use with 7-day TTL; force expiry by marking the `activationTokens` row `revoked` (or ignore — they cannot be replayed without the email).
- QR identity tokens: revoke via the identity module (`qrTokens.active = false`); tokens carry no personal data.

---

## 5. Retention & Pruning

| Data | Retention | Mechanism |
|---|---|---|
| GPS pings | Rolling window | Scheduled `pruneOldPings` job (verified executing) |
| OTP codes | 15 min | Convex Auth TTL |
| Invite/activation tokens | 7 days | `expiresAt` + lazy expiry on resolve |
| Payment requests (failed/pending) | Reconciliation horizon | Kept; status-final and idempotent |
| Audit logs | Indefinite (append-only) | No delete path exists |
| Everything else | Until tenant/platform deletes | Application mutations only |

---

## 6. Verification Checklist (run quarterly)

- [ ] Full export completes without errors and the archive decrypts.
- [ ] `bun scripts/security-audit.mjs <url>` → 0 failed.
- [ ] `bun scripts/phase7-verify.mjs <url>` → 0 failed.
- [ ] Restore drill: import one non-critical table (e.g. `announcements`) into a **scratch deployment** from the latest export.
- [ ] `platformHealth` reports all components; integration states honest.
- [ ] Audit log spot-check: recent actions for privileged users present.
- [ ] Env var audit: `PLATFORM_ADMIN_PASSWORD` and `SEED_SECRET` set; no defaults relied upon.
