# SchoolCore Test Primary School pilot — release handoff (14 November 2026)

## Scope and baseline

- Proposed branch: `feature/test-school-import-landing-2026-11-14` from current `origin/selfhost-production` (last known branch SHA at authoring: `e4fcb86`).
- Production application at authoring: `2a5f974`; source package based on earlier repository snapshot `cf01f1e` with changes confined to the file list in the patch README.
- This is a **review patch**, not a production-tested or deployed release.
- Do not touch `/srv/platform` or Freebuff. Do not create a new `HHS-001` tenant or import real student data until Test Primary School acceptance passes.

## Workflows

1. Platform Super Admin uses `/platform/launch` to see **school-level status only** and `/platform/schools` to provision or select `TPS-TEST-001` and create the school administrator.
2. The school administrator uses `/onboarding/workbook` to upload **one .xlsx workbook**, preview all structural and server errors, correct the file and type the exact school code to confirm.
3. The importer is **only for an empty pilot tenant**; each expected worksheet must exist, max 200 data rows across 20 data sheets (60 per sheet), max 4 MB XLSX. It prevents partial imports in a single Convex mutation; upload/preview does not commit records.
4. Imported staff are **records only**; accounts and school-scoped permissions must be invited separately. Fees are staged inactive. Historical opening balances await an **independent school accountant** at `/finance/opening-balances`; no imported payment is treated as verified provider settlement.
5. Class, guardian, teacher, dormitory, room, bed, and transport links are resolved within the school; parent/student portals should then display authorized data after accounts are created and linked.

## Required checks before any deployment

- Review patch diff against current `origin/selfhost-production`, especially `src/convex/_generated/api.d.ts`, `src/main.tsx`, `src/pages/Landing.tsx` and the layout components.
- Run `bun install --frozen-lockfile`, `bun run typecheck`, `bun test scripts/school-workbook-pilot.test.ts`, `bun run test:unit`, `bun run lint`, `bun run build` locally.
- Open a PR; require GitHub Actions CI success on the final head SHA and explicit approval.
- Pilot on a **separate disposable isolated Convex deployment**, and exercise school-admin-versus-platform-admin access, preview, invalid workbook rejection, successful confirm, re-upload denial, accountant approval, cross-school student/guardian/finance isolation, class/bed capacity, and all portal browser states.
- These isolated backend, browser and 38/113 authorization checks were NOT run at patch authoring. Do not mark them PASS based on code review.
- Before production deploy: fresh local and offsite backup, previous Compose image saved, rollback SHA/image confirmed, no live M-Pesa/Standard Chartered activity.

## Explicit limitations / open gates

- This version is **pilot-sized and empty-tenant only**, not the final queued importer for large populated schools. Existing real schools need a reviewed merge/update/deduplication strategy.
- Booking/payment integration is not enabled by these changes. M-Pesa callbacks, verified Standard Chartered settlement and end-to-end reconciliation remain separate launch blockers.
- Imported opening balances are reviewed snapshots, not receipts or reconciled payment events; require supporting finance evidence and approval.
- Staff's `proposedPortalRole` is NOT automatically provisioned; invite each account through the existing identity service.
- The Super Admin is explicitly excluded from the **new** workbook API and screen; broader pre-existing SchoolCore APIs must still be audited to enforce platform/operator least privilege across all student, guardian and finance data.
- Super Admin Launch Center monitors setup flags, not a full authoritative readiness certification.
- Test Primary School must be created deliberately by the Super Admin; patch does not create it automatically or enable live accounts.
- These new Convex functions may require codegen, runtime and transaction-size corrections discovered by CI/staging; do not overwrite production and hope they work.

## Minimum acceptance evidence

- School `TPS-TEST-001` exists exactly once; admin portal accesses it.
- Populated workbook 22 tabs, 150 data rows, 12 fictional students, 10 guardians; successful import has no duplicate keys or orphan relationships.
- Preview bad-code, duplicate admission number, missing guardian, wrong bed, invalid balance errors, with correct worksheet, row and field; none is committed.
- Student/parent staff and finance restrictions verified using separate identities and, where applicable, cross-school fixtures.
- Account balance shown only after independent accountant review, no generated receipts for historical payments.
- Browser verifies premium black/gold landing, mobile responsiveness and keyboard focus, Super Admin Launch Center, school-admin importer, accountant finance review, parent/student scoped boarding.
- Release note records CI run, pre-deploy backup local id/offsite snapshot, deployed Git SHA, Docker image, Convex function deployment outcome, rollback reference, smoke tests, remaining blockers.
