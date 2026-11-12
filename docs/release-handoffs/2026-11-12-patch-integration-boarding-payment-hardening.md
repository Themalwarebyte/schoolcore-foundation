# Release Handoff — Boarding Portal Visibility & Payment Authorization Hardening (review patches)

- **Date:** 2026-11-12
- **Original deployed SHA:** cf01f1ef548684e68fdda705d6adf025fc34d73e (selfhost-production)
- **Patch archives reviewed (server):** /home/ghub/schoolcore-incoming/2026-11-12/SchoolCore-Boarding-Portal-Patch-2026-11-12.zip, /home/ghub/schoolcore-incoming/2026-11-12/SchoolCore-Payment-Authorization-Hardening-Review-2026-11-12.zip
- **Integration branch (local):** patch-integration-2026-11-12

## Files reviewed / integrated
| Patch | File | Action | Notes |
|---|---|---|---|
| Boarding | src/convex/portal.ts | modified | Added currentBoardingForStudent + parentChildBoarding + studentBoarding (read-only, school-scoped). |
| Boarding | src/pages/portal/BoardingStatusCard.tsx | added | Read-only boarding status card component. |
| Boarding | src/pages/portal/ParentDashboard.tsx | modified | Renders child boarding status. |
| Boarding | src/pages/portal/StudentViews.tsx | modified | Renders own boarding status. |
| Payment hardening | src/convex/phase6/payments.ts | modified | Tightened initiatePayment and myPaymentRequests authorization/invoice checks. |
| Both | REVIEW_PATCH_README.md (in archives) | reviewed | Guidance/limitations noted; not committed to app source. |

## Changes made
- **Boarding portal (read-only):** parent sees dorm assignment only for linked/authorized active child (portal.parent + uthorizeChild); student sees only own assignment (portal.student + studentIdentity). Active allocation resolved in same school with fail-closed checks on hostel/room/bed tenant/relationship consistency; ended/historical allocations excluded. Day/unassigned states surfaced explicitly. No schema, permission, account, or write-path changes.
- **Payment authorization hardening (review/minimal):** initiatePayment requires active linked parent-child (portal identity/link checks) or payments.create for non-parent actors; validates supplied invoice is payable and belongs to the same student. myPaymentRequests enforces school context, school-scoped student lookup, parent-child link, student-self, or payments_external.view for staff; responses remain masked. **Does not complete M-Pesa** (no STK action/callback/idempotent posting/audit-reconciliation proof; do not enable live processing).

## Tests performed & results
- **TypeScript typecheck:** un run typecheck (tsc app + convex) — **PASS** (exit 0), re-run after minor encoding cleanup in BoardingStatusCard.tsx.
- **Unit tests:** un run test:unit — **PASS** (23 pass, 0 fail, 64 expect() calls).
- **Lint:** un run lint — **PASS with warnings** (0 errors, 24 warnings; pre-existing warnings outside patched scope).
- **Production build:** un run build (Vite) — **PASS** (✓ built in 1m 4s).
- **Live authorization regression (scripts/phase8-authz.test.ts):** **NOT RUN in this environment** (requires CONVEX_SELF_HOSTED_URL, CONVEX_SELF_HOSTED_ADMIN_KEY, P8_IDS; local run fails without env). Prior cf01f1e evidence: 38/38 and 113/113 matrix on production (unchanged by this local integration).
- **Boarding/student/parent permission checks:** **code-reviewed, not runtime-executed** against live backend in this pass (guards: portal.parent/portal.student, uthorizeChild/studentIdentity, same-school fail-closed boarding refs, no cross-student data returned).
- **Payment authorization/cross-school isolation tests:** **code-reviewed, not runtime-executed** (parent-child link, payments.create/payments_external.view, school-scoped student/invoice validation). No end-to-end M-Pesa flow tested (by design/limitation).

## New commit SHA
- To be recorded after local commit on patch-integration-2026-11-12 (see G. Local Git commit in task report).

## Deployment requirements
- Merge/promote reviewed commit to selfhost-production only after required checks/CI pass and release approval.
- Take fresh **local and off-site backup** and verify healthy before deploy (/opt/schoolcore/scripts/backup.sh, /opt/schoolcore/scripts/backup-health.sh).
- Deploy per approved self-host workflow for current commit (frontend/Convex deploy as applicable), regenerate Convex _generated on deploy host if schema/function signatures require, then run /opt/schoolcore/scripts/production-health.sh, endpoint checks, and targeted smoke tests (authz/portal boarding visibility for linked/unlinked/cross-school; payment permission paths). **Do not enable live M-Pesa processing.**
- Prepared commands (do not run in this task): ssh gman-remote 'sudo -n /opt/schoolcore/scripts/backup.sh && sudo -n /opt/schoolcore/scripts/backup-health.sh'; then deploy the approved commit on gman-02 via the standard release path and verify with sudo -n /opt/schoolcore/scripts/production-health.sh.

## Rollback reference
- Pre-integration deployed/source baseline: cf01f1ef548684e68fdda705d6adf025fc34d73e on selfhost-production.
- Roll back by redeploying the last known-good commit (cf01f1e or prior approved SHA) using the standard release/restore procedure, with backups available (local 20261112-023003, off-site Restic c9a6a32 verified healthy at check time). No schema migrations introduced by these patches.
