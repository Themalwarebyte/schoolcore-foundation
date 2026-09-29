# SchoolCore — Phase 8 Authorization Validation

Scope: close the remaining **role** authorization matrix (parent, student,
teacher, super admin) on the isolated self-hosted environment.
Date of pass: 2026-09-29. Branch: `selfhost-production`.

**Outcome: 8.6 authorization portion is INCOMPLETE.** Two categories failed
(parent portal isolation, student self-data isolation) because of one root
cause documented in §16.1. No claim is made here about Phase 8 overall.

---

## 1. Methodology

1. **Source-first.** Every endpoint was read before it was called. Argument
   validators, the permission gate, and the tenancy check were taken from the
   source, never guessed. Convex validators are exact-match — any undeclared
   field is rejected — so the verbatim `args` shape determined the call.
2. **Application-supported writes only.** Fixtures were created through public
   mutations/actions under real school-admin identities. No direct row inserts.
3. **Two-source fixture gate.** Every fixture mapping was confirmed twice,
   once from stored relationships and once through the application's own
   resolver, before a single authorization call was made.
4. **Classification, not scoring.** The harness returns exactly one of
   `ALLOWED`, `DENIED_AUTHORIZATION`, `INVALID_ARGUMENTS`, `FUNCTION_ERROR`,
   `HARNESS_ERROR`. A test was only scored PASS/FAIL once the harness returned
   a real verdict; `INVALID_ARGUMENTS` / `FUNCTION_ERROR` / `HARNESS_ERROR`
   rows were fixed and re-run, never converted to PASS or FAIL.
5. **Anonymous re-baseline.** Anonymous protection was re-run as a regression
   within this pass rather than inherited from an earlier run.

### 1.1 Harness revision (and why)

The pre-existing harness classified denials with a narrow phrase list that did
not include the two most common server messages:

- `You do not have permission to perform this action.` (`session.ts:136`)
- `This student is not linked to your account.` (`portal.ts:120`)

It also accepted an `ALLOWED` result only when the response began with `{` or
`[`, so a function returning a bare number or `null` was misread as an error.

The harness was revised to a **strict allowlist of verbatim denial messages**,
read from the source and confirmed against live responses. An unrecognised
`ConvexError` is now reported as `FUNCTION_ERROR`, so an unknown error can never
be silently scored as either a pass or a security denial. The previous revision
is preserved at `/opt/schoolcore/scripts/authz-harness.sh.bak-p8pre`.
Self-test: 15/15 known-outcome cases classified correctly.

---

## 2. Deterministic school mapping

Authoritative and independently re-confirmed from stored data (not rediscovered
by `LIMIT 1` or unordered selection):

| School | Code | School ID | Students | Staff |
|---|---|---|---|---|
| Greenfield Academy | `GRN-001` | `m177fshhg7x9a053r0wg9wkpg18etmdk` | 80 | 11 |
| Riverside School | `RVS-002` | `m174qy845ps4k08gg8vezh7aex8evy6x` | 1 | 1 |
| Hospital Hill Primary | `HHS-001` | `m17f3mx6sgvak0qrw7ke3zbb258f1qpt` | 0 | 0 |

| Identity | User ID | Scope |
|---|---|---|
| `admin@greenfield.ac.ke` | `ms70tfh1m4a406hm537rc46b858etyd8` | Greenfield |
| `admin@riverside.ac.ke` | `ms71f8bae6r8qe23dnq469g63x8etry2` | Riverside |
| `admin@schoolcore.dev` | `ms7amk9bymfmvzg4r4h1j99z1s8et94k` | platform (no school) |

---

## 3. Fixture design

Before creation, the dataset was confirmed to contain **zero**
`guardianPortalLinks` and **zero** `studentPortalLinks` — no parent or student
portal account existed. All four identities had to be created.

| Label | Role | School | Creation path (application mutation/action) |
|---|---|---|---|
| `P8-AUTHZ-TEACHER-A` | teacher | Greenfield | `team:createUser` → `staff:create` → `allocations:create` |
| `P8-AUTHZ-PARENT-A` | parent | Greenfield | `students:create` → `guardians:create` → `guardians:linkStudent` → `announcements:inviteParent` |
| `P8-AUTHZ-STUDENT-A` | student | Greenfield | `students:create` → `announcements:inviteStudent` |
| `P8-AUTHZ-STUDENT-B` | student | Riverside | `students:create` → `announcements:inviteStudent` (Riverside admin) |

Why these paths: `announcements:inviteParent` / `inviteStudent` are the only
public functions that create a working, sign-in-able portal account in one
call — they create the password account, the `schoolMemberships` row, the
portal link, an audit row and a welcome notification. `team:createUser` +
`staff:create` is the documented two-step for a teacher, because `staff:create`
resolves the user by email and `team:createUser` provisions the credential.

**An existing teacher was not reused.** Greenfield staff `GF-101` (Grace
Wanjiku) does have a `staff` row bound to a user account, but no password for
that account is known; using it would have required resetting the password of a
real development account, and its membership binds to a different user row of
the same email. That is not a safe reuse, so an isolated fixture was created.

**Negative controls reused, not created:** an existing Greenfield student
(`GA-2026-1002`) as the unlinked same-school control, and a student that
already has a *different real guardian* as the "another guardian's child"
control. No extra fixtures were needed for those.

### 3.1 Fixture IDs

| Entity | ID |
|---|---|
| TEACHER_A user / staff | `ms7f0z3gzpyjdm835zy1cdmdhd8fap1j` / `m576gcf61ct2pmrfd8c30nwht58fbth7` |
| PARENT_A user / guardian | `ms723qgnn6zadpfhdqk6zgzyc58fa23f` / `ks74t5yy5xaqrt5vvzekdr6de98fb9xk` |
| STUDENT_A user / student | `ms7fn5mh5r2vw00vnamq2sqeb98fbp6f` / `m975ag99y498q2wxjwkaxrf8e58fakxk` |
| STUDENT_B user / student | `ms7ay5rh1fe1qvh4ddx7rv2fd98fbaka` / `m9796qzkyjcz07fxpn5r3yg2vn8fa2tn` |

### 3.2 Required relationships

```
TEACHER_A  -> Greenfield only
PARENT_A   -> Greenfield -> STUDENT_A only   (PARENT_A is NOT linked to STUDENT_B)
STUDENT_A  -> Greenfield
STUDENT_B  -> Riverside
```

---

## 4. Fixture validation

Verified before any authorization call, from two independent sources. Both
agreed on all six required mappings.

| Check | Stored relationship | Application resolver | Verdict |
|---|---|---|---|
| TEACHER_A school = Greenfield | membership `teacher` @ `GRN-001`; staff row `P8-TCH-A` @ Greenfield | `academicOps:teacherHome` → `isTeacher: true`, 1 allocation | MATCH |
| PARENT_A children = STUDENT_A only | exactly one `guardianStudents` link → `P8-STU-A` | `portal:parentChildren` → 1 child, `P8-STU-A` | MATCH |
| STUDENT_A school = Greenfield | `P8-STU-A`.schoolId = Greenfield | `portal:studentOverview` → `P8-STU-A` | MATCH |
| STUDENT_B school = Riverside | `P8-STU-B`.schoolId = Riverside | `portal:studentOverview` → `P8-STU-B` | MATCH |
| Greenfield admin = Greenfield | membership `school_admin` @ `GRN-001` | `team:list` → Greenfield users only | MATCH |
| Riverside admin = Riverside | membership `school_admin` @ `RVS-002` | `team:list` → Riverside users only | MATCH |

PARENT_A → STUDENT_B: **not linked** (zero link rows), as required.

---

## 5. School-admin isolation — PASS

| ID | Function | Target | Expected | Actual | Result |
|---|---|---|---|---|---|
| F-01 | `finance:listInvoices` | Greenfield | ALLOWED | ALLOWED | PASS |
| F-02 | `finance:listInvoices` | Greenfield student | ALLOWED | ALLOWED | PASS |
| F-03 | `finance:listInvoices` | Riverside student | DENIED | DENIED | PASS |
| F-04 | `finance:listInvoices` | Riverside | ALLOWED | ALLOWED | PASS |
| F-05 | `finance:listInvoices` | Greenfield student from Riverside | DENIED | DENIED | PASS |
| A-15 | `phase7/access:accessOverview` | Riverside from Greenfield | DENIED | DENIED | PASS |
| A-16 | `phase7/access:accessOverview` | own school | ALLOWED | ALLOWED | PASS |
| A-18 | `schools:createSchool` | platform-level | DENIED | DENIED | PASS |

A-18 was executed with well-formed arguments. `schools:createSchool` runs
`requirePermission("platform.schools.manage")` as its first statement
(`schools.ts:109`), so the call throws before any write; verified afterwards
that no school row was created.

---

## 6. Anonymous protection — PASS (7/7)

| ID | Function | Expected | Actual | Result |
|---|---|---|---|---|
| Z-01 | `portal:parentChildren` | DENIED | DENIED | PASS |
| Z-02 | `portal:studentOverview` | DENIED | DENIED | PASS |
| Z-03 | `students:list` | DENIED | DENIED | PASS |
| Z-04 | `finance:listInvoices` | DENIED | DENIED | PASS |
| Z-05 | `platform:listPlatformUsers` | DENIED | DENIED | PASS |
| Z-06 | `team:list` | DENIED | DENIED | PASS |
| Z-07 | `students:get` | DENIED | DENIED | PASS |

All denials returned `You are not signed in.` (`session.ts:42`).

---

## 7. Teacher matrix — PASS (21/21)

TEACHER_A held 31 permissions, resolved by the application itself
(`phase7/access:permissionMatrix`): `subjects.view`, `students.view`,
`academics.view`, `attendance.view/take/edit`, `results.view`,
`report_cards.view`, and **no** finance, billing, HR, payroll or medical
permission.

| ID | Function | Target | Expected | Actual | Result |
|---|---|---|---|---|---|
| T-01 | `academics:listSubjects` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-02 | `academics:listClassSections` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-03 | `academics:listGradeLevels` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-04 | `students:list` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-05 | `attendance:register` | allocated class | ALLOWED | ALLOWED | PASS |
| T-06 | `attendance:register` | other same-school class | ALLOWED | ALLOWED | PASS |
| T-07 | `attendance:register` | **Riverside** class | DENIED | DENIED | PASS |
| T-08 | `attendance:today` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-09 | `attendance:reopenSession` | own school session | DENIED | DENIED | PASS |
| T-10 | `allocations:list` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-11 | `assessments:list` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-12 | `assignments:list` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-13 | `academicOps:teacherHome` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-14 | `reportCards:readiness` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-15 | `guardians:list` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-16 | `students:get` | same-school student | ALLOWED | ALLOWED | PASS |
| T-17 | `students:get` | **Riverside** student | DENIED | DENIED | PASS |
| T-18 | `students:stats` | Greenfield | ALLOWED | ALLOWED | PASS |
| T-19 | `finance:listInvoices` | Greenfield | DENIED | DENIED | PASS |
| T-20 | `team:list` | Greenfield | DENIED | DENIED | PASS |
| T-21 | `platform:listPlatformUsers` | platform | DENIED | DENIED | PASS |

T-09 required a real `attendanceSessions` id, because Convex validates the id
against the table named in the validator. One attendance session was created by
the Greenfield admin (expected admin behaviour) purely to make the denial
testable; the teacher's call is rejected at the permission gate before any
read or write.

`guardians:list` returning ALLOWED is **expected, not a defect**: `guardians.view`
is explicitly granted to the teacher role (`schema.ts:327`).

---

## 8. Parent matrix — FAIL (23/26)

All `portal:parentChild*` isolation tests passed. The failures are in the
`students.*` family.

| ID | Function | Target | Expected | Actual | Result |
|---|---|---|---|---|---|
| P-01..P-07 | `portal:parentChild{Overview,Attendance,Results,ReportCards,Fees,Assignments,Timetable}` | own child | ALLOWED | ALLOWED | PASS |
| P-08 | `portal:parentChildren` | own child | ALLOWED | ALLOWED | PASS |
| P-09 | `portal:listAnnouncements` | school | ALLOWED | ALLOWED | PASS |
| P-10 | `portal:myProfile` | own | ALLOWED | ALLOWED | PASS |
| P-11..P-15 | `portal:parentChild*` | unlinked same-school student | DENIED | DENIED | PASS |
| P-16 | `portal:parentChildOverview` | Riverside student | DENIED | DENIED | PASS |
| P-17 | `portal:parentChildAttendance` | Riverside student | DENIED | DENIED | PASS |
| P-18 | `portal:parentChildOverview` | another guardian's child | DENIED | DENIED | PASS |
| P-19 | `students:list` | school-wide | DENIED | DENIED | PASS |
| P-20 | `finance:listInvoices` | school | DENIED | DENIED | PASS |
| P-21 | `team:list` | school | DENIED | DENIED | PASS |
| P-22 | `platform:listPlatformUsers` | platform | DENIED | DENIED | PASS |
| P-23 | `guardians:list` | school | DENIED | DENIED | PASS |
| **P-24** | **`students:get`** | **other same-school student** | **DENIED** | **ALLOWED** | **FAIL** |
| **P-25** | **`students:stats`** | **school-wide counts** | **DENIED** | **ALLOWED** | **FAIL** |
| **P-26** | **`students:recent`** | **school-wide recent list** | **DENIED** | **ALLOWED** | **FAIL** |

**Parent child isolation: FAIL.** The `portal:parentChild*` family correctly
enforces the guardian→child link (`authorizeChild`, `portal.ts:109-126`); an
unrelated child is refused with `This student is not linked to your account.`
However, P-24 lets a parent read a **complete student record belonging to
another family at the same school** (name, date of birth, gender, nationality,
boarding status, admission number). See §16.1.

---

## 9. Student matrix — FAIL (17/20)

| ID | Function | Target | Expected | Actual | Result |
|---|---|---|---|---|---|
| S-01..S-06 | `portal:student{Overview,Attendance,Results,ReportCards,Assignments,Timetable}` | own data | ALLOWED | ALLOWED | PASS |
| S-07 | `portal:listAnnouncements` | school | ALLOWED | ALLOWED | PASS |
| S-08 | `portal:myProfile` | own | ALLOWED | ALLOWED | PASS |
| **S-09** | **`students:get`** | **other same-school student** | **DENIED** | **ALLOWED** | **FAIL** |
| S-10 | `students:get` | Riverside student | DENIED | DENIED | PASS |
| S-11 | `students:list` | school-wide | DENIED | DENIED | PASS |
| **S-12** | **`students:stats`** | **school-wide counts** | **DENIED** | **ALLOWED** | **FAIL** |
| **S-13** | **`students:recent`** | **school-wide recent list** | **DENIED** | **ALLOWED** | **FAIL** |
| S-14 | `finance:listInvoices` | school | DENIED | DENIED | PASS |
| S-15 | `team:list` | school | DENIED | DENIED | PASS |
| S-16 | `platform:listPlatformUsers` | platform | DENIED | DENIED | PASS |
| S-17 | `guardians:list` | school | DENIED | DENIED | PASS |
| S-18, S-19 | STUDENT_B own data | Riverside | ALLOWED | ALLOWED | PASS |
| S-20 | `students:get` | Greenfield student from Riverside | DENIED | DENIED | PASS |

**Student self-data isolation: FAIL.** Cross-school is correctly refused, but
within the student's own school another student's full record is readable
(S-09). See §16.1.

---

## 10. Super-admin matrix — PASS

The platform super admin holds 144 permissions, including all six
`platform.*` permissions. `can()` (`access.ts:29`) returns true for
`super_admin` unconditionally, and any `platform.*` permission is refused to
every school role (`access.ts:30`).

| ID | Function | Expected | Actual | Result |
|---|---|---|---|---|
| A-01 | `platform:listPlatformUsers` | ALLOWED | ALLOWED | PASS |
| A-02, A-03 | `schools:listSchools` (all / filtered) | ALLOWED | ALLOWED | PASS |
| A-04 | `schools:platformStats` | ALLOWED | ALLOWED | PASS |
| A-05 | `platform:platformActivity` | ALLOWED | ALLOWED | PASS |
| A-06 | `platform:platformAuditCount` | ALLOWED | ALLOWED | PASS |
| A-07 | `phase7/access:permissionMatrix` | ALLOWED | ALLOWED | PASS |
| A-08, A-09, A-10 | `phase7/access:accessOverview` (platform / scoped GRN / scoped RVS) | ALLOWED | ALLOWED | PASS |
| A-11 | `team:list` | ALLOWED | ALLOWED | PASS |
| A-12 | `finance:listInvoices` | ALLOWED | ALLOWED | PASS |
| A-13 | `students:list` | ALLOWED | ALLOWED | PASS |
| A-14 | `schools:createSchool` | ALLOWED by design | not executed — see below | n/a |
| A-17 | `platform:listPlatformUsers` as school admin | DENIED | DENIED | PASS |

A-14 was deliberately **not executed**: it is a real mutation that would create
a school. The permission was instead confirmed from the application's own
resolver (`platform.schools.manage: true` for super admin, `false` for school
admin) and from the source. A-18 (§5) exercises the same gate from the denied
side with no side effect.

One behaviour worth recording: `team:list` called by the platform super admin
without a school context returns an **empty page**, not an error, because
`getSession` leaves `schoolId` null and the membership index query is then
scoped to nothing (`session.ts:76-101`, `team.ts:35`). This is a
platform-context characteristic, not a tenant-isolation failure; the
school-scoped forms A-15/A-16 show the cross-tenant boundary holds.

---

## 11. Finance resolution — `finance:listInvoices`

Exact validator: `{ termId?: Id<"terms">, studentId?: Id<"students">, status?: string }`.
The earlier failure was caused by sending extra fields; Convex validators are
exact-match, so that was an argument error and carried no authorization meaning.

Gate: `requirePermission(ctx, "billing.view")` (`finance.ts:345`), then a
`getSchoolRecord` check on `studentId`/`termId`, then a final
`rows.filter(r => r.schoolId === schoolId)` on every path (`finance.ts:357`).

`school_admin` **does** hold `billing.view` (`schema.ts:236`), confirmed by the
application's own resolver. Therefore:

- own school → **ALLOWED** (F-01, F-02, F-04) — matches product design
- cross school → **DENIED** (F-03, F-05)
- teacher, parent, student → **DENIED** (T-19, P-20, S-14)

**Resolved: `school_admin` has finance visibility by design, scoped to its own
school.**

---

## 12. `team:list` resolution

Exact validator: `{ search?, role?, status?, paginationOpts: { numItems: number, cursor: string | null } }`.

`paginationOpts` is **required, not optional**. The previous `INVALID_ARGUMENTS`
verdict was a malformed call, not an authorization finding. Re-run correctly:

| ID | Caller | Expected | Actual | Result |
|---|---|---|---|---|
| TM-01 | Greenfield admin | ALLOWED | ALLOWED | PASS |
| TM-02 | Greenfield admin, `role: "teacher"` filter | ALLOWED | ALLOWED | PASS |
| TM-03 | Riverside admin | ALLOWED | ALLOWED | PASS |
| TM-04 | Platform super admin | ALLOWED | ALLOWED | PASS |
| P-21 / S-14 / T-20 | parent / student / teacher | DENIED | DENIED | PASS |

`users.view` is held only by `school_admin` and `super_admin`.

---

## 13. `academics:listSubjects` resolution

Exact name `academics:listSubjects`, args `{}` — **zero arguments**. Gate:
`requirePermission(ctx, "subjects.view")` (`academics.ts:441`).

`subjects.view` is in the teacher role's permission list (`schema.ts:329`) and
in `school_admin` / `principal`.

**Result: EXPECTED_ALLOWED.** Confirmed empirically as T-01 (teacher) — ALLOWED.

---

## 14. `students:list` previous false result

The earlier `students:list` anomaly was an inverted test mapping, not an
application defect: the caller's school was not what the assertion assumed.

Re-verified in this pass from both directions:

- school admin / teacher (who hold `students.view`) → **ALLOWED**
- parent / student (who do **not** hold `students.view`) → **DENIED**
  (P-19, S-11, T-04)

The application's own resolver confirms `students.view: false` for both the
parent role (9 permissions total) and the student role (6 permissions total).
**No defect.**

---

## 15. Cleanup

Convex Auth exposes no public user-deletion path, and audit rows plus the
`schoolMemberships` / portal-link records reference these identities. Hard
deletion is therefore not safely supported, so fixtures were **disabled and
permanently labelled TEST / INACTIVE**, as the cleanup policy allows.

Actions taken:

1. `allocations:end` — TEACHER_A's teacher allocation archived, so the class
   roster returns to its prior state.
2. `team:setActive { isActive: false }` for all four fixture logins, under the
   owning school admin for each.

Post-cleanup verification:

| Check | Result |
|---|---|
| All four fixture accounts inactive | confirmed |
| Disabled account cannot open a session | `Your account has been disabled.` (`session.ts:29`) |
| Orphan `guardianStudents` references | 0 |
| Orphan portal links (user or target missing) | 0 |
| Greenfield counts | 81 students / 12 staff / 67 guardians (was 80/11/67) |
| Riverside counts | 2 students / 1 staff (was 1/1) |
| Hospital Hill counts | 0 / 0 (unchanged) |
| Pre-existing student, guardian, staff or admin record modified | none |
| Teacher allocation status | `archived` |

**Remaining, by design:** two student records (`P8-STU-A`, `P8-STU-B`), one
staff record (`P8-TCH-A`), one guardian record, the corresponding
`schoolMemberships` rows and portal links — all with disabled logins and
`P8-` labels. Also retained: one attendance session created for T-09, and the
four disabled `authAccounts` credential records (Convex Auth provides no public
account-deletion path). No active test login remains.

One pre-existing data-quality note, **not** caused by this pass: at Greenfield
there is a `guardianStudents` row whose `guardianId` is empty, left by earlier
seeding. It was left untouched.

---

## 16. Findings and limitations

### 16.1 CRITICAL — within-school horizontal access for parent and student roles

Three read endpoints never call `requirePermission`, so they serve data to any
signed-in account that merely has a school membership:

| Endpoint | Gate actually applied | Source |
|---|---|---|
| `students:get` | `getSession(ctx)` only | `students.ts:126` |
| `students:stats` | `requireSchoolSession(ctx)` only | `students.ts:139` |
| `students:recent` | `requireSchoolSession(ctx)` only | `students.ts:159` |

Neither the `parent` role nor the `student` role holds `students.view`
(verified by the application's own resolver: 9 and 6 permissions respectively,
neither containing `students.view`). The design intent is stated explicitly in
`schema.ts:383-386`: the parent role is meant to reach data **only** through
`portal.*` queries that verify the child link server-side, because the generic
endpoints are school-wide and "would leak other students' data within the
school". `students:get` and `students:recent` are exactly those school-wide
endpoints, and they are reachable by both roles.

Impact, measured:

- `students:get` returns a full student record for **any** student in the
  caller's own school — name, date of birth, gender, nationality, boarding
  status, admission number. For a parent this is another family's child.
- `students:recent` returns the school-wide most-recent student list including
  real names and admission numbers.
- `students:stats` returns school-wide aggregates (total 81, gender split,
  boarding counts).

Cross-school access remains correctly refused in all cases, so this is a
**horizontal, intra-tenant** escalation, not a tenant break. It is nonetheless
a **pilot blocker** for both parent and student portal isolation.

Suggested remediation (not applied in this pass — it changes authorization
behaviour and is out of scope for a validation pass):

- `students:get` → require `students.view`, and additionally permit a `parent`
  or `student` only when the `studentPortalLinks` / `guardianStudents` link
  covers the requested student.
- `students:stats` and `students:recent` → add `requirePermission(ctx,
  "students.view")` in place of `requireSchoolSession(ctx)`.

### 16.2 LOW — platform super admin crash on a teacher dashboard

`academicOps:teacherHome` throws
`Invalid argument 'id' for db.get, expected string but got 'object': null`
(`academicOps.ts:137`) when called by the platform super admin, because
`getSession` leaves `schoolId` null without a school context and the handler
passes it to `db.get`. This is an availability defect on a teacher-facing
endpoint, not an isolation failure — no data is returned. It was removed from
the super-admin matrix as a mis-specified boundary test and is recorded here.
The same unchecked-cast pattern (`session.schoolId as Id<"schools">`) is
present in many school-scoped handlers and is worth a dedicated review.

### 16.3 Limitations

- The dataset has **no `terms` records and no `invoices`**, so
  `results:sheet` / `results:preview` and any fee/invoice *content* assertions
  could not be exercised. Those endpoints returned valid `ALLOWED` results with
  empty payloads; the authorization gate was verified, the data path was not.
- Attendance and assessment mutations were not exercised beyond the single
  session created for T-09; write-path authorization is inferred from
  `requirePermission`/`assertTeacherAuthorized` in source plus the read-path
  evidence, not from a full write matrix.
- `phase7/access:permissionMatrix` is readable by **any** signed-in user
  (`phase7/access.ts:90-100` uses `getSession` only). It exposes permission
  names, not data, so this is low severity, but it is an intentional widening
  of the authenticated surface.
- Multi-school users are not representable in this dataset, so the
  "first active membership wins" behaviour in `getSession` (`session.ts:77`)
  was not tested.
- The 1254 tombstoned documents in the document store were excluded from all
  queries; counts in this report are live documents only.

---

## 17. Result summary

| Category | Result |
|---|---|
| Authorization harness | **PASS** |
| School-admin tenant isolation | **PASS** |
| Anonymous protection | **PASS** |
| Parent portal isolation | **FAIL** |
| Student portal isolation | **FAIL** |
| Teacher authorization | **PASS** |
| Super-admin boundaries | **PASS** |

Matrix totals: **94 PASS, 6 FAIL, 0 retest** across 101 rows.

**8.6 authorization portion: INCOMPLETE** — two categories fail on §16.1.
Phase 8 as a whole is not claimed complete.
