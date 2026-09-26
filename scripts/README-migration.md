# Migration Tool — Documentation (Preparation)

> **Status:** PREPARATION. The scripts described here are **proposed** and
> land in `scripts/migration/` at execution time. Nothing has been run; no
> production data has been touched. Docs precede code so the tool contract is
> agreed before anything executes.

Contract goals: preserve **IDs, relationships, `schoolId` isolation, users,
permissions, audit logs, and storage references** — see
`docs/CONVEX_SELF_HOST_MIGRATION_PLAN.md` §1/§5 for the invariants and
§4 for the procedures these scripts implement.

---

## 1. Scripts (proposed)

| Script | Wraps | Purpose |
| --- | --- | --- |
| `scripts/migration/export.mjs` | `bunx convex export` | Export the source deployment snapshot to `migration/<ts>.zip` + write a manifest |
| `scripts/migration/import.mjs` | `bunx convex import` | Import a snapshot into the EMPTY target backend (refuses non-empty) |
| `scripts/migration/validate.mjs` | Convex HTTP API / CLI | Structural validation of the imported target (§3) |
| `scripts/migration/rollback.mjs` | backup tooling | Restore target to pre-import state / point ops back at source |

Shared conventions (match the repo's verification suites):

- Convex deployment URL passed as `argv[2]`; **never logged or echoed**.
- No secret values handled or printed; secrets stay in the deployment env.
- `.mjs` files, run with `bun scripts/migration/<script>.mjs`.
- Archives and manifests written to `migration/` (add `migration/` to
  `.gitignore` at implementation time — data never enters git).

---

## 2. Manifest format

`export.mjs` writes `migration/manifest-<ts>.json` alongside the archive:

```json
{
  "createdAt": "2026-09-26T12:00:00Z",
  "sourceDeployment": "label-only-not-a-secret",
  "schemaGitSha": "<git sha at export>",
  "convexCliVersion": "1.x.y",
  "archive": "snapshot-20260926-120000.zip",
  "tableCounts": { "students": 1234, "users": 87, "auditLogs": 56789, "...": 0 }
}
```

`validate.mjs` compares target counts against `tableCounts` and reports
`OK / MISMATCH <table> (expected N, got M)`. Zero-tolerance on mismatches
under a cutover freeze (expected delta is zero).

---

## 3. Validation checklist (implemented by `validate.mjs`)

1. **Row-count parity** per table vs manifest (§2).
2. **ID preservation** — sampled `_id`s resolve by get-by-id on target.
3. **Relationship probes** — `students → schoolMemberships → users`,
   `invoices → students`, `enrollments → classSections`, `files → storageId`
   resolution.
4. **Tenancy** — every document in school-scoped tables has non-empty
   `schoolId`; cross-checks `students.schoolId == membership.schoolId`.
5. **Audit logs** — count parity + sampled entry resolution.
6. **Storage** — every `files.storageId` resolves; sampled file fetch
   succeeds.
7. **Users & permissions** — `users`/`roles`/`schoolMemberships` count parity;
   permission model is data-driven, so verbatim copy is the guarantee.

Functional gates on top (run separately against the target URL):
`security-audit.mjs`, `phase7-verify.mjs`, `phase2.test.ts`, `phase3.test.ts`,
`engines.test.ts` — all must pass (same conventions: URL as `argv[2]`, no
echoing).

---

## 4. Import safety rules

- Import **only** into an empty backend (script aborts if any target table is
  non-empty) — never incremental, never merge.
- One archive = one import attempt; a failed import is cleaned by re-pushing
  an empty schema or restoring the volume snapshot (§6), then re-imported.
- The archive contains **data only** — no environment variables or secrets
  transit it.
- Archive stored encrypted at rest; deleted after successful cutover +
  grace period.

---

## 5. Export safety rules

- Record `schemaGitSha` in the manifest; the import target must be pushed
  from the **same sha** (schema parity gate).
- Prefer running inside the agreed freeze window (cutover) — no freeze needed
  for rehearsals against staging.
- Never run export/import from the production VM; workstation-only.

---

## 6. Rollback

| Failure point | Rollback action |
| --- | --- |
| Import fails mid-way | Target backend discarded (volume restored from pre-import snapshot or fresh empty re-push); source Cloud untouched; re-attempt |
| Validation fails | Same as above; investigate before next attempt |
| Post-cutover (DNS switched) problem | Per CONVEX_SELF_HOST_MIGRATION_PLAN §6.3: roll forward preferred; else DNS back to Cloud (kept read-only for grace period); data written post-switch reconciled by Owner decision |
| Archive corruption | Re-export (requires re-freeze if post-rehearsal); never import a corrupted archive |

`rollback.mjs` automates the first two rows: verify target emptiness
procedure, restore-from-snapshot guidance, and re-run validation — the DNS
re-point stays a manual ops step.

---

## 7. Known gaps (documented, deliberate)

- `smoke.ts` requires `SEED_SECRET`, which is deliberately unavailable in
  production runtimes — post-migration smoke uses manual workflow checks +
  the suites listed in §3 instead.
- No maintenance-mode surface exists in-product; the cutover freeze is
  procedural (CONVEX_SELF_HOST_MIGRATION_PLAN §8 item 2).
- Exact CLI flags for `convex import` against self-hosted backends must be
  verified against the Convex version pinned at execution time (both scripts
  print the CLI version they invoke and refuse unknown versions only with a
  warning — final check is human, per the manifest gate).
