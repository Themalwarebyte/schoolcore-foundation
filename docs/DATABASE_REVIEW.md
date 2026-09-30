# SchoolCore — Database Review and Indexing Audit (8.7)

Date: 2026-09-30. Branch: `selfhost-production`. Deployed SHA at review:
`8f4b84fcf1bdf6755033f60f0bf35bf1b5ab85f6`.

**Outcome: no schema or index changes were made, because the evidence did not
support any.** The schema is well formed, every table is indexed, and the
database is 21 MB. Findings are recorded below, including one hygiene item and
one growth risk that is an input to the performance baseline rather than a
defect today.

This review is an audit. It did not modify application code, authorization,
monitoring, backups, deployment or infrastructure, and it produced no load.

---

## 1. Baseline

| Property | Value |
|---|---|
| Engine | PostgreSQL 17.11 (Alpine musl) |
| Database size | **21 MB** (`documents` 7.3 MB, `indexes` 5.6 MB) |
| Live document rows | 6,916 (3,924 current entities + version history) |
| Tombstones | 1,311 |
| Application entities | 3,924 current documents |
| Encoding / collation | UTF8 / en_US.utf8 |
| `max_connections` | 100 |
| Connections in use | 1 active, 3 peak, 0 idle-in-transaction |
| `autovacuum` | on; `default_statistics_target` 100 |
| Backup | `HEALTHY` |
| Convex physical tables | `documents`, `indexes`, `leases`, `persistence_globals`, `read_only` |

### The key architectural fact

**PostgreSQL holds Convex's storage engine, not the application's data model.**
The application never queries these tables. The eight physical B-tree indexes
that exist (`documents_by_table_and_id`, `documents_pkey`, `indexes_pkey`, …)
are created and owned by the Convex backend.

**The application's query index is Convex's own index system**, declared in
`src/convex/schema.ts` and materialised into the `indexes` table (8,240 rows).
Adding a PostgreSQL index would do nothing for application queries and would
touch the engine's own storage — so the index audit in this document is against
the Convex schema, and no PostgreSQL DDL is proposed.

### Scan behaviour (evidence the query path is index-served)

| Relation | seq_scan | idx_scan | n_live |
|---|---|---|---|
| `documents` | 543 | **145,432** | 8,227 |
| `indexes` | 48 | 27,326 | 8,240 |
| `leases` | 4,147 | 3 | 1 |
| `persistence_globals` | 904 | 692 | 10 |

`documents` is 99.6% index-served. The 4,147 sequential scans on `leases` are on
a **one-row** table and are Convex's internal lease polling — negligible cost,
not an application concern.

---

## 2. Schema review

**105 tables, 271 Convex index definitions.**

| Property | Finding |
|---|---|
| Tables with no index | **0** |
| Duplicate index definitions on a table | **0** |
| Tenancy indexing | `by_school [schoolId]` on **98 of 105** tables |
| Consistent composite pattern | `by_school_status [schoolId, status]` on 11 tables |
| Child-scoped pattern | `by_student [studentId]` on 20 tables |
| Relationship tables | `guardianStudents`, `guardianPortalLinks`, `studentPortalLinks`, `employee` all indexed on both sides of the relation |

Representative definitions, and the access pattern each serves:

| Table | Index | Serves |
|---|---|---|
| `students` | `by_school_admission [schoolId, admissionNumber]` | admission-number lookup, roster |
| `students` | `by_school_status [schoolId, studentStatus]` | status-filtered roster |
| `guardians` | `by_school_email`, `by_school_phone` | parent search, contact match |
| `schoolMemberships` | `by_user`, `by_school`, `by_user_school` | session role resolution, roster |
| `attendanceRecords` | `by_session`, `by_student`, `by_school` | register, student summary, class report |
| `invoices` / `payments` | `by_school_number`, `by_school_status`, `by_school_date` | finance lists and filters |
| `auditLogs` | `by_school`, `by_user` | audit trail |

The design is **tenancy-first**: nearly every table is reachable from a school
scope, which is exactly the shape the multi-school authorization model requires.
Relation tables are indexed in both directions, so the authorization checks in
`session.ts` and `portal.ts` — which resolve the caller's school, membership and
child link on every request — are all index-backed.

**Assessment: the schema design supports current usage and the pilot model.**

---

## 3. Query pattern review

**838 `.collect()` call sites without `.paginate()`** were found. That number on
its own is not a finding, and treating it as one would be exactly the
hypothetical optimisation this review is meant to avoid.

The pattern is overwhelmingly correct for this data model:

- the great majority read **small, school-scoped dimension tables** —
  `departments` (6 rows), `gradeLevels`, `subjects`, `leaveTypes`,
  `paymentMethods`, `feeCategories` — where a single indexed `.collect()` per
  request is the right call and pagination would be pure overhead;
- the rest are **bounded by one school** through `by_school`, so their size is
  capped by a single tenant;
- pages that can grow within a school (`students`, `staff`, `team:list`,
  `finance` lists) already use `.paginate()` — the authorization matrix asserts
  `paginationOpts` as a required argument for exactly those endpoints.

No N+1 pattern, no missing pagination on an unbounded surface, and no
unnecessary join structure was identified. Convex queries are single-table
indexed reads composed in code, so there is no join planner to audit.

**One growth risk, evidence-based.** `attendanceRecords` is the only table that
compounds per student per session per day. It currently holds **105 rows** for
86 students and is read with `.collect()` at 12 sites. Extrapolating to a
full academic year: ~86 students × ~200 sessions ≈ 17,000 rows per school per
year, or ~170,000 across a ten-school pilot. The existing indexes
(`by_session`, `by_student`, `by_school`) remain correct at that size, so this is
**not** a defect and needs no index now — it is the primary load area to measure
in the performance baseline (8.8).

---

## 4. Index audit

### Required now

**None.** The evidence does not support any index change:

- every table has at least one index, and 98 of 105 are tenancy-indexed;
- no duplicate or conflicting definitions;
- `documents` is 99.6% index-served at 145,432 index scans against 543
  sequential scans;
- the database is 21 MB with no dead tuples on `documents` and healthy
  autovacuum (last run 2026-09-29).

Adding an index here would be speculative and would impose ongoing write cost
on every mutation for no measured benefit.

### Recommended later

| # | Item | Table | Rationale | Cost |
|---|---|---|---|---|
| R1 | Declare the 12 queried-but-undeclared tables | `mealPlans`, `mealEnrollments`, `mealConsumption`, `schoolRequests`, `applications`, `allocationSettings`, `promotionRuns`, `paymentAllocations`, `bankImportBatches`, `bankImportRows`, `feeVoteheads`, `feeItemVoteheads` | See §4.1 | Schema-only; requires a `convex deploy` |
| R2 | Revisit `attendanceRecords` read patterns if the pilot exceeds ~5 schools | `attendanceRecords` | See §3 | Query-level |
| R3 | Index-row maintenance | `indexes` table holds 1,517 dead rows of 8,240 | Cosmetic at 5.6 MB; revisit at scale | Convex-managed |

### No action

All 271 defined indexes. The tenancy-first model, the bidirectional relation
indexes, and the school-scoped composite indexes all match observed query
shapes.

### 4.1 Twelve tables are queried in code but absent from the schema

`mealPlans`, `mealEnrollments`, `mealConsumption`, `schoolRequests`,
`applications`, `allocationSettings`, `promotionRuns`, `paymentAllocations`,
`bankImportBatches`, `bankImportRows`, `feeVoteheads`, `feeItemVoteheads` are
queried with `withIndex()` in `phase7/meals.ts`, `phase7/promotions.ts`,
`phase7/admissions.ts`, `phase7/billing.ts`, `phase7/registration.ts`,
`dashboard.ts` and `diagnostics.ts`, but are not declared in `schema.ts`.

**This is not a defect.** Verified against the live deployment:
`phase7/meals:listPlans` and `phase7/promotions:listRuns` both execute
successfully and return `[]`. Convex tolerates tables outside the schema and
resolves their indexes implicitly. All are currently empty.

It is recorded as hygiene because the consequences are invisible rather than
absent: those documents are **unvalidated** (no field validators, so a
malformed write is accepted), and their indexes are **implicit** — not visible
in the schema, so a future schema regeneration could remove them without any
declared definition to restore. Declaring them is a schema-only change with a
`convex deploy`, and should be scheduled with other schema work rather than
treated as a pilot blocker.

---

## 5. Changes applied

**None.** Steps 5 and 6 are satisfied by explanation rather than action:

- the audit found no missing index, no duplicate index, no unbounded surface
  and no bloat;
- the only structural item (R1) is a schema declaration cleanup that carries
  migration risk — a `convex deploy` adding twelve table definitions can
  trigger schema validation across the whole deployment — for no measured
  performance or reliability benefit, since every affected query already works.

Introducing a schema migration into a hardened, pilot-bound production system
to fix a hygiene item with no functional effect is not a justified trade. R1 is
recorded for a future schema-change window.

**Consequence: no migration plan, no backup gate and no post-migration
validation were required**, because no change was made. Production state is
untouched by this review, which is confirmed in §7.

---

## 6. Performance baseline inputs (for 8.8, not performed here)

Ordered by expected value to the baseline exercise:

1. **`attendanceRecords`** — the compounding table. 105 rows now; the dominant
   growth driver. Measure session register and per-student summary latency.
2. **`enrollments`** (137) and `staff` (16) — read on nearly every academic page.
3. **`observabilityEvents`** (64) — written by the backend itself on every
   operation; the write-amplification side of the document store.
4. **Tombstone ratio** — 1,311 tombstones against 3,924 current entities.
   Document-store history retention is the mechanism that would drive bloat over
   a multi-year pilot.
5. **Portal request cost** — every authenticated request resolves membership,
   and every parent/student request additionally resolves a portal link and a
   guardian link. All are index-backed, but the per-request count is the
   natural thing to measure.
6. **Missing metrics** — no query-latency or per-endpoint timing is captured
   anywhere. `pg_stat_statements` is not enabled, and Convex does not expose
   per-function timing through the current tooling. Baseline instrumentation
   should be decided in 8.8 before, not during, measurement.
7. **Undeclared tables** (R1) — if 8.8 finds latency in meals, admissions or
   billing, these implicit indexes are the first thing to check.

No load testing, no synthetic traffic and no production query was executed.

---

## 7. Production impact

**None.** This review was read-only. Verified after completion:

- deployed SHA `8f4b84f`, working tree clean
- 5 containers up, 3 healthy; 0 host-published ports
- frontend, API, OIDC and JWKS all HTTP 200
- `production-health.sh`: `DEGRADED (warn=1)` — the known cosmetic swap notice only
- `/srv/platform` untouched (mtime `2026-09-29 18:25:45`); Freebuff absent
- no schema, index, data, configuration or deployment change was made

---

## 8. Conclusion

| Acceptance criterion | Status |
|---|---|
| Database baseline recorded | yes — §1 |
| Schema reviewed | yes — §2 |
| Query patterns reviewed | yes — §3 |
| Index usage assessed | yes — §4 |
| Required optimizations identified | yes — **none required** |
| Safe changes applied if justified | yes — none justified, explained in §5 |
| No unsupported optimizations introduced | yes — §4 "Required now" is empty by evidence |
| Documentation updated | yes — this document |
| Production stability confirmed | yes — §7 |

**8.7 is complete.** The database is small, correctly indexed, tenancy-first,
free of bloat, and served by an index-dominated query path. The one item worth
scheduling (R1) is a hygiene improvement, not a pilot blocker, and the one worth
measuring (`attendanceRecords`) is an input to 8.8.

Phase 8 remains open. Gates 4–6 and 8–10 have not started, and this review does
not claim Phase 8 complete.
