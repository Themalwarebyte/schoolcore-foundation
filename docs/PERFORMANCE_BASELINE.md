# SchoolCore — Performance Baseline (8.8)

Date: 2026-09-30. Deployed SHA: `8f4b84fcf1bdf6755033f60f0bf35bf1b5ab85f6`.
Host: `gman-02`, 4 cores, 15.9 GB RAM.

**No optimization was applied.** Nothing measured was slow enough to justify
changing code, schema, indexes or architecture, and no target was invented —
the project has no documented performance SLOs, so everything below is a
*reference point for future comparison*, not a pass/fail line.

---

## 1. Methodology

**What was measured, and where.** Two separate layers, because they have
different owners and different remedies:

1. **Origin execution** — Convex function call → runtime → PostgreSQL →
   response. Measured from inside `schoolcore-net`, which excludes Docker
   startup, CLI startup and the public network entirely. This is the number the
   application is responsible for.
2. **Public end-to-end** — HTTPS request from the host through Cloudflare
   Tunnel to the origin. Measured with `curl` against the real public hostnames.
   This is what a user experiences.

**Load discipline.** Strictly sequential, 150 ms between calls, 12–20 samples
per endpoint, `await`ed one at a time. No concurrency, no burst, no load test.
Every function measured is read-only. The isolated `P8-` fixtures were enabled
for the duration of the authenticated measurements and disabled immediately
after; no other data was touched.

**Two earlier attempts produced invalid data and were discarded.** Recording
this because the invalid numbers were superficially excellent and would have
been a serious mistake to report:

| Attempt | Method | Result |
|---|---|---|
| 1 | generated `anyApi` object | `BadConvexFunctionIdentifier` on all 18 queries — the "1.4 ms" figures were **error responses**, not executions |
| 2 | `setAuth({ subject })` | `InvalidAuthHeader` — a raw object is not a signed JWT. Only `auth:signIn` was valid |
| 3 | real sign-in per role, issued token reused | **valid** — all figures below |

Attempt 3 is also closer to reality, because it exercises the actual credential
and session path rather than bypassing it.

**Why no load test.** The acceptance question is "how does it perform under
realistic expected usage". Realistic usage today is a handful of users; the
database holds 3,924 documents in 21 MB, and the origin answers in single-digit
milliseconds. A load test would generate synthetic load against a **live
production system holding real school data**, through a production tunnel, to
measure something the current numbers already bound. The risk is asymmetric
against the value, so load testing is explicitly deferred rather than performed.

---

## 2. Environment baseline

| | |
|---|---|
| CPU | 4 cores; load average 0.21 / 0.20 / 0.19 |
| Memory | 15,910 MB total, 3,634 used, 12,276 available |
| Swap | 57 MB used of 16,293 (0.35%) — `si=0 so=0`, no thrashing |
| Disk | 8.3 GB used of 3.6 TB (1%) |
| Database | 21 MB — `documents` 7.3 MB, `indexes` 5.6 MB |
| Documents | 6,916 live rows, 1,311 tombstones, 3,924 current entities |
| Index rows | 8,240 |
| Convex storage | 10.0 MB, 13 module blobs |
| DB connections | 1 active, 3 peak, 0 idle-in-transaction (`max_connections` 100) |
| Frontend image | `schoolcore-frontend:8f4b84f…` (id `cf776c902e3b`) |
| Backend image | `get-convex/convex-backend@sha256:b756b066…` |
| Postgres image | `postgres:17-alpine@sha256:b0f9560a…` |

### Idle container usage

| Container | CPU | Memory |
|---|---|---|
| `schoolcore-convex-backend` | 0.01–4.4% | 359–472 MiB (2.3–3.0%) |
| `schoolcore-postgres` | 0.02–4.6% | 37–69 MiB (0.2–0.4%) |
| `schoolcore-frontend` | 0.00% | 4.9 MiB (0.03%) |
| `schoolcore-cloudflared` | 0.34% | 30 MiB (0.2%) |
| `schoolcore-convex-dashboard` | 0.00% | 85 MiB (0.5%) |

No container came within 2% of any limit during measurement, and host load
average rose from 0.21 to 0.43 and settled — the measurement itself was
imperceptible to the system.

---

## 3. Origin execution latency

12 samples per endpoint, 150 ms apart, read-only, from `schoolcore-net`.

| Endpoint | Group | p50 | p95 | max |
|---|---|---|---|---|
| `auth:signIn` (password + Scrypt verify) | authentication | **237.9 ms** | 276.9 ms | 328.0 ms |
| `team:me` — school admin | session | 3.0 ms | 3.3 ms | 3.3 ms |
| `team:me` — teacher | session | 3.1 ms | 3.9 ms | 3.9 ms |
| `team:me` — parent | session | 3.0 ms | 3.2 ms | 3.2 ms |
| `team:list` (paginated) | admin | 2.6 ms | 3.5 ms | 3.5 ms |
| `students:list` (paginated, 50) | admin | 3.7 ms | 4.7 ms | 4.7 ms |
| `staff:list` (paginated, 50) | admin | 3.5 ms | 3.9 ms | 3.9 ms |
| `academicOps:teacherHome` | teacher | 3.0 ms | 3.3 ms | 3.3 ms |
| `academics:listSubjects` | teacher | 3.1 ms | 3.5 ms | 3.5 ms |
| `academics:listClassSections` | teacher | 3.0 ms | 3.8 ms | 3.8 ms |
| `allocations:list` | teacher | 3.5 ms | 4.3 ms | 4.4 ms |
| `attendance:today` | teacher | 3.0 ms | 3.3 ms | 3.3 ms |
| `portal:parentChildren` | parent | 3.0 ms | 3.7 ms | 3.7 ms |
| `portal:studentOverview` | student | 3.0 ms | 3.8 ms | 3.8 ms |
| `portal:studentAttendance` | student | 3.0 ms | 3.7 ms | 3.7 ms |
| `portal:studentResults` | student | 3.0 ms | 3.7 ms | 3.7 ms |
| `students:get` (single record) | record | 3.0 ms | 3.9 ms | 3.9 ms |
| `staff:get` (single record) | record | 3.1 ms | 3.4 ms | 3.4 ms |
| `enrollments:options` | academic | 3.0 ms | 3.8 ms | 3.8 ms |
| `finance:listInvoices` | finance | 3.0 ms | 3.3 ms | 3.3 ms |

**Aggregate: p50 3.1 ms · p95 4.4 ms · p99 6.7 ms · max 880.3 ms (cold start,
see §4).** Excluding cold starts: n = 127, p50 3.1 ms, p95 4.3 ms, max 6.7 ms.

Every portal, list and single-record read — including the ones that resolve
three relationships (session → membership → portal link → child) — lands within
**1 ms of each other**. That flatness is the expected consequence of the 8.7
finding that the query path is 99.6% index-served: the origin is not doing
per-query work that grows with table size at this scale.

`auth:signIn` at ~238 ms is **correct and should not be reduced**. It is a
deliberate `Scrypt` verification (`auth.ts:36`); the cost is the security
property. Lowering it would weaken password hashing to make a number smaller.

Three endpoints returned refusals rather than timings, and all three are
**correct behaviour**, not failures: `schools:listSchools` denied to a school
admin, `finance:listInvoices` denied to a teacher (no `billing.view`). One
`announcements:listAllAnnouncements` call failed on an argument shape — my
error, and its coverage gap is noted in §7.

---

## 4. Cold start

`academicOps:teacherHome` over 20 samples: `[2,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,880]`.

**Exactly one outlier in 20 — an ~880 ms isolate cold start.** The other three
probes showed 0/20, and the two outliers seen in the first pass both occurred on
a function's first call. So the pattern is: the V8 isolate backing a function is
recycled after idle, and the next request pays to instantiate it.

**Steady-state is unaffected** — p50 stays at 3.0 ms — but a user returning to
an idle page can wait ~880 ms. This is Convex runtime behaviour, not
application code, and it is not something the application can fix. It is
recorded as a user-experience characteristic and a monitoring item.

---

## 5. Public end-to-end latency

15 requests each, 150 ms apart, against the real public hostnames.

| Path | Total p50 | Total p95 | Total max | **TLS connect p50** | Connect p95 |
|---|---|---|---|---|---|
| frontend | **780.8 ms** | 1,035.0 ms | 1,035.0 ms | 177.8 ms | 240.8 ms |
| convex API | **760.6 ms** | 1,044.3 ms | 1,044.3 ms | 177.5 ms | 246.7 ms |
| OIDC discovery | 456.8 ms | 936.4 ms | 936.4 ms | 180.6 ms | 553.5 ms |
| JWKS | 787.7 ms | 981.5 ms | 981.5 ms | 77.9 ms | 242.9 ms |

**This is the headline finding.** The origin answers in **3.1 ms**, but a user
sees **~780 ms**. TLS establishment through the tunnel alone is ~178 ms.

**~99.6% of user-visible latency is outside SchoolCore's control** — it is the
Cloudflare Tunnel path from this host to Cloudflare's edge and back. The
application's own contribution is roughly 3 ms of a 780 ms round trip.

This reframes every future performance question for this project. Optimizing a
3 ms query to 2 ms would change the user experience by 0.1%. The levers that
matter are network-path ones — and they are infrastructure decisions, not
application ones.

---

## 6. Observability gaps

Nothing was instrumented or deployed, as instructed. This is what exists and
what does not.

| Capability | Status |
|---|---|
| PostgreSQL query statistics (`pg_stat_statements`) | **NOT INSTALLED** |
| Slow-query logging (`auto_explain`) | **NOT INSTALLED** |
| `shared_preload_libraries` | **empty** |
| `track_io_timing` | `off` |
| `log_min_duration_statement` | `-1` (log nothing) |
| Per-function timing from Convex | **not emitted**; backend runs `RUST_LOG=info` |
| Metrics scraping (node_exporter / Prometheus / Grafana) | **0 containers** |
| Log aggregation | **journald only**, 132.6 MB on disk |
| Request/error rate at the application layer | **not captured anywhere** |
| `pg_stat_user_tables` | available — 5 relations, scan counters only, no timing |

**The consequence is the important part.** The 8.7 database review could measure
*index usage* (seq_scan vs idx_scan) but could not measure *query time* at all.
Nothing in the system can tell you which endpoint is slow, how often a request
fails, or whether a change made things worse. A future regression would be
invisible until a user reported it.

**What should be added, and where** — recommendations only, not implemented:

| # | Addition | Where | Why |
|---|---|---|---|
| O1 | `pg_stat_statements` | `postgres:17-alpine` image, `shared_preload_libraries` | Top-N queries by total time; the only way to attribute database cost. Requires a database restart — plan for a maintenance window |
| O2 | `log_min_duration_statement = 200ms` | PostgreSQL config | Catches the cold-start outliers; near-zero write volume |
| O3 | Per-endpoint latency + error rate in `production-health.sh` | host script | Makes application regressions visible to the existing 5-minute monitor, with no new infrastructure. Cheapest and highest value of the four |
| O4 | `node_exporter` + host metrics | new container | CPU/memory/disk history; the host currently has no time-series at all |

O3 is the recommendation that matters most: it extends a monitor that already
runs every five minutes and already alerts, rather than introducing a new stack.

---

## 7. Findings, classified

### Blocking (affects pilot readiness)

**None.**

### Monitor (future scaling concerns)

| # | Finding | Evidence | Assessment |
|---|---|---|---|
| M1 | **No query or endpoint observability** | §6 | Highest-priority gap. Blocks any future regression detection, and limited 8.7's ability to reason about cost |
| M2 | **Network path dominates user latency** | §5 | ~780 ms end-to-end vs 3.1 ms origin. Not an application defect; it is the first thing to change if users report slowness |
| M3 | **Isolate cold start ~880 ms** | §4 | 1-in-20 on first call after idle. Runtime behaviour, unfixable in application code |
| M4 | **`attendanceRecords` growth** (8.7 R2) | 105 rows now, ~17k/school/year | Correctly indexed; will not matter at pilot scale. Revisit past ~5 schools |
| M5 | **No container resource limits** | §2 — every container reports `memory=0 cpus=0` (unlimited) | A leak in the backend or database cannot be contained and would compete with the host. Cheap to add at next compose change |
| M6 | **Tombstone growth** | 1,311 tombstones / 3,924 entities (33%) | Document-store history drives long-run bloat. Irrelevant now; needs a retention decision at 8.11 |
| M7 | **`observabilityEvents` write amplification** | 64 rows | The backend writes an event per operation; write cost scales with traffic |
| M8 | **Sign-in at ~238 ms** | §3 | Correct `Scrypt` cost. Listed only so a future reader does not "optimize" it |
| M9 | **Test-fixture coverage gap** | §3 | `announcements:listAllAnnouncements` was not measured (my argument shape was wrong). Trivial to add to a later measurement pass |

### No action

- **All query performance.** 3.1 ms p50 with a flat distribution across portal,
  list, record and relationship-traversal reads is the expected result of the
  index coverage confirmed in 8.7.
- **All database sizing.** 21 MB, 1 connection, 3 peak, zero bloat on
  `documents`, healthy autovacuum.
- **All host capacity.** 1% disk, 12.3 GB RAM available, load 0.21.
- **The 838 unbounded `.collect()` sites** characterised in 8.7. At 3 ms per
  query, none of them is a performance problem at this scale.

---

## 8. Optimizations applied

**None.** No measured problem justified a change, so none was made. The
measured profile is:

- origin queries: **3.1 ms p50**, no endpoint above **4.7 ms p95**
- the only slow number a user sees is **network-bound**
- the only slow number in the application is a **~880 ms runtime cold start**,
  which is not application-controllable

Introducing an index, a query rewrite or a schema change against this profile
would add write cost and migration risk for no measured gain — precisely the
speculative optimization this gate was told to avoid.

---

## 9. 8.7 database findings, incorporated

| 8.7 finding | Disposition here |
|---|---|
| 271 indexes, 0 missing, `documents` 99.6% index-served | Confirmed by latency: reads are flat at ~3 ms regardless of table or relationship depth |
| `attendanceRecords` compounding growth (R2) | Carried as M4; 105 rows today, not a factor at pilot scale |
| 12 queried-but-undeclared tables (R1) | No latency impact observed. Still a hygiene item; unchanged disposition |
| Missing query latency metrics | Confirmed and promoted to M1, the highest-priority gap in this gate |
| Tombstone ratio 33% | Carried as M6 |
| `observabilityEvents` write amplification | Carried as M7 |

---

## 10. Limitations

1. **Low sample counts.** 12–20 samples per endpoint, sequential by design.
   Adequate to characterise a stable ~3 ms distribution; **not** adequate to
   characterise tail behaviour under load. The p99 and max figures here are
   effectively minima.
2. **No concurrency.** Nothing here says what happens at 10 or 50 simultaneous
   users, which is the shape of a real school morning.
3. **No load test**, for the reason in §1. The origin's headroom is therefore
   unquantified — the 3 ms figure is single-client latency, not capacity.
4. **Network latency measured from the host itself**, not from client
   geographies. A user in another country will see a different figure, and the
   tunnel path may dominate more or less.
5. **No error-rate measurement**, because the system does not record one.
6. **`announcements:listAllAnnouncements` not covered** (M9).
7. **One school of real data** (86 students) plus 2 small schools. The numbers
   describe pilot-scale, not pilot-ceiling.
8. **Cold-start rate (1-in-20) is a single observation**, not a measured
   distribution.

---

## 11. Production impact

**None.** The measurement was read-only and low-rate.

- deployed SHA `8f4b84f`, working tree clean
- 5 containers up, 3 healthy; 0 host-published ports
- frontend, API, JWKS all HTTP 200
- `production-health.sh`: `DEGRADED (warn=1)` — the known 57 MB swap notice only
- `/srv/platform` mtime `2026-09-29 18:25:45`, containers up; Freebuff absent
- all five `P8-` fixture accounts confirmed `isActive=false` again
- host load average returned to 0.19 after the measurement

---

## 12. Conclusion

| Acceptance criterion | Status |
|---|---|
| Production baseline captured | yes — §2 |
| Resource baseline captured | yes — §2 |
| Important workflows measured | yes — §3, including auth, session, all three portals, admin lists, teacher, academic, finance |
| Performance risks identified | yes — §7, none blocking |
| 8.7 database findings incorporated | yes — §9 |
| No unsupported optimization introduced | yes — §8, none applied |
| Documentation created | yes — this document |
| Production stability confirmed | yes — §11 |

**8.8 is complete.** The origin is fast, the database is correctly indexed, the
host has ample headroom, and there is no pilot-blocking performance issue. The
two findings that matter are not code problems: user-visible latency is
network-bound, and the system cannot currently measure its own query or
endpoint performance well enough to catch a future regression. The second is
addressable cheaply through O3 in §6 and should be scheduled before Gate 10.

Phase 8 remains open. Gates 6, 8, 9 and 10 have not started.
