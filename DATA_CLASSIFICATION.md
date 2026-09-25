# SchoolCore — Data Classification

**Version:** 1.0 · **Date:** 2026-09-25 · **Scope:** All Convex tables, files, logs, and outbound messages in SchoolCore.

---

## 1. Purpose & Tiers

This document classifies every category of data handled by SchoolCore so that access control, retention, logging, and incident-response decisions can be made consistently. Four tiers are used:

| Tier | Name | Definition |
|---|---|---|
| **P0** | Restricted | Compromise enables fraud, impersonation, or platform takeover. Never displayed, logged, or exported in plaintext. |
| **P1** | Sensitive Personal | Financial, health, and compensation data. Disclosure causes serious harm to a data subject or school. |
| **P2** | Personal | Identifiable personal data about students, guardians, and staff. Default-protected within the tenant. |
| **P3** | Operational | Non-personal business and reference data (catalogs, settings, logs without payloads). |

Handling rules by tier:

- **P0** — secret material only: env vars, hashes. Never leave the server. Never in DB as plaintext, never in client bundles, never in audit logs, never in exported files.
- **P1** — server-side enforcement via fine-grained permissions (`medical.*`, `payroll.*`, `finance.*`); every access to confidential subcategories is audit-logged; excluded from global search, exports require the owning permission, and never enter AI insights or bulk communications.
- **P2** — tenant-scoped (`schoolId` on every row) and role-gated (`students.view`, `hr.view`, …); parents see only their linked children; students see only their own records.
- **P3** — still tenant-scoped where it belongs to a school; readable by any member of that school with the module's `view` permission.

---

## 2. Credentials, Tokens & Secrets — P0

| Data | Where it lives | Rules |
|---|---|---|
| Password hashes (Scrypt) | `authAccounts` (Convex Auth internal) | Never returned by any query; verification server-side only. |
| Platform admin password | Env var `PLATFORM_ADMIN_PASSWORD` | Required to provision a super admin; bootstrap **refuses** to run with a default (no code fallback — fixed this audit). |
| Seed secret | Env var `SEED_SECRET` | Seed refuses to run when unset (no fallback). |
| M-Pesa credentials | `MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY/CALLBACK_SECRET` | Server-side only; DB stores masked metadata only (`integrations.displayMetadata`). |
| SMS/Email/WhatsApp keys | `SMS_API_KEY`, `EMAIL_API_KEY`, `WHATSAPP_API_KEY`, `VLY_EMAIL_OTP_API_KEY` | Server-side only; honest `not_configured` states when absent. |
| One-time invite/activation codes | `activationTokens.tokenHash` | SHA-256 hash stored; raw code exists only in the queued email body (P0-equivalent while valid); TTL 7 days; single use. |
| OTP email codes | Convex Auth transient state | 15-minute TTL, provider-managed. |
| QR identity tokens | `qrTokens.token` | Opaque random tokens carrying no personal data; resolve server-side only; revocable. |
| Biometric / GPS device secrets | `secretRef` fields | Device references only — no biometric templates are ever stored. |

**Audit-log rule (enforced by convention in `src/convex/audit.ts`):** never log passwords, tokens, or secrets. Descriptions are human sentences, not payloads.

---

## 3. Financial Data — P1 (with P2 contact fields)

| Data | Tables | Access | Notes |
|---|---|---|---|
| Fee invoices, items, voteheads | `invoices`, `invoiceItems`, `feeVoteheads` | `finance.view` / `billing.view` | Tenant-scoped; school admins only. |
| Payments, receipts, references | `payments`, `receipts` | `payments.create` to record, `receipts.view` to read | Duplicate reference numbers rejected (replay guard); single reversal path requires `payments.approve`. |
| Payment allocations / reconciliation | `paymentAllocations`, `providerTransactions`, bank import staging | `finance.*` (phase7 billing) | Provider transactions are the reconciliation source of truth; no silent posting on amount mismatch. |
| Bank statements staged for import | phase7 billing staging rows | `finance.manage` | Treat as P1: may contain external customer data. |
| Salaries & payslips | `salaryStructures`, `payrollRuns`, `payslips` | `payroll.view` / `payroll.manage`; **self-service `myPayslips` returns only the caller's own slips** | Never in global search, exports, AI insights, or parent/student portals. |

---

## 4. Medical Data — P1

| Data | Tables | Access | Notes |
|---|---|---|---|
| Medical profiles (conditions, allergies, medications, notes) | `medicalProfiles` | `medical.view` / `medical.manage` | Every profile read is audit-logged (`auditMedicalAccess`). |
| Nurse visits (complaints, treatment, disposition) | `medicalVisits` | `medical.view` / `medical.manage` | Teacher role has **no** medical permissions (verified). |
| Medical documents | `files` rows referenced by medical flows | as above | Stored in DB, never public URLs. |

**Exclusions:** medical data never appears in `globalSearch`, `exports`, `announcements`, bulk messages, or AI insights (string-scan verified in `scripts/security-audit.mjs` G4).

---

## 5. Student, Guardian & Staff Personal Data — P2

| Data | Tables | Access |
|---|---|---|
| Student identity (name, DOB, gender, admission no.) | `students` | `students.view`; parents see only linked children; students only themselves |
| Admissions applications | `admissionApplications` (phase7) | `admissions.view` / `admissions.decide` |
| Guardian identity & contact | `guardians`, `guardianStudents` | `guardians.view`; the guardian directory is staff-only |
| Staff records, contracts, leave | `staff`, `contracts`, `leaveRequests` | `hr.view` / `hr.manage`; staff see own leave balances |
| Staff performance / appraisal notes | HR module tables | `hr.view` — treat disciplinary content as P1-sensitive in practice |
| Attendance records | `attendanceRecords` | `attendance.view`; parents see children's records |
| Behavior/discipline incidents | discipline tables | `discipline.view` |
| Boarding/transport/meal assignments | Phase 5/7 tables | module `view` permissions; parent scope limited to own children |
| Photographs / registration certificates / staff docs | `files` (inline bytes) | Upload gated per module; downloads permission-checked **and tenant-checked**; staff-document access is audit-logged |

---

## 6. Operational & Reference Data — P3

| Data | Tables | Access |
|---|---|---|
| Academic structure (grades, streams, terms, assessments) | academics tables | school-scoped `view` permissions |
| Library catalog, inventory items/assets, transport routes/vehicles, menus | respective module tables | module `view` |
| Fee categories, payment methods, chart of accounts | config tables | `finance.view` / `financial_reports.view` |
| Announcements | `announcements` | audience-scoped |
| Feature flags, plans, subscriptions | `featureFlags`, `plans`, `schoolSubscriptions` | school flags: `integrations.manage`; platform objects: platform session |
| Audit logs | `auditLogs` | `audit_logs.view` / `dashboard.view`; **append-only** (no update/delete mutations exist — verified) |
| Device/GPS events | `deviceEvents`, `gpsPings` | `gps.view`; retention pruning job removes old pings |
| Communication queue | `commMessages` | `communications.view`; message bodies may contain P1/P2 content — treat as the source tier |

---

## 7. Public / Unauthenticated Surface

- **Registration request** (`submitRequest`, `attachRequestDocument`): the only public write path. Inputs validated; documents limited to 5 MB and kind-allowlisted (registration certificate, logo, supporting); stored tenant-less until approved.
- **Registration status by email** (`requestStatusByEmail`): returns only the requester's own status.
- Everything else requires a session; the HTTP surface is auth routes only (`convex/http.ts`).

---

## 8. Data Flow Rules (Summary)

1. Every tenant row carries `schoolId`; cross-tenant reads/writes throw `You do not have access to this record.` via `getSchoolRecord`.
2. Secrets stay in env vars; DB stores masked or hashed forms only.
3. P1 categories are excluded from search, AI, bulk comms, and exports of other modules.
4. Confidential access (medical profiles, staff documents, portal documents) is audit-logged.
5. Client bundles contain only `VITE_*` config (Convex URL); no P0/P1 values reach the browser except data the session is permitted to render.
6. Outbound messages queue through `commMessages`; raw one-time codes exist only inside a recipient's own email, never in dashboards or logs.
