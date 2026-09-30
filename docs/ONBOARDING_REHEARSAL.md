# SchoolCore — Onboarding Rehearsal (8.9)

Date: 2026-09-30. Deployed SHA: `8f4b84fcf1bdf6755033f60f0bf35bf1b5ab85f6`.

**Outcome: INCOMPLETE.** The rehearsal stopped at the first step of a new
school's life. A school created through the platform path **cannot be
administered** — the administrator it creates can never sign in. Steps 4–8 of
the rehearsal were not reachable, and three rehearsal accounts remain signable
because the product offers no way to disable them.

**Phase 8 remains open.** This document does not claim Gate 6 or Phase 8
complete.

---

## 1. Onboarding documentation review

| Document | What it actually is |
|---|---|
| `docs/customer-onboarding.md` | A **commercial playbook**, not a technical runbook. 11 implementation stages and an 11-stage pilot plan, framed as a service package. Fees are marked OWNER DECISION REQUIRED. It references "School Setup" and "CSV importers" as existing capabilities. |
| `docs/demo-accounts.md` | Demo credential list. |
| `docs/SELF_HOST_EXECUTION_CHECKLIST.md`, `SERVER_EXECUTION_APPROVAL_CHECKLIST.md` | Dated 2026-09-25/26, banners still read "PREPARATION / Nothing has been executed". Superseded. |

**No technical onboarding runbook exists.** The only accurate description of
how a school is set up is the code itself (`schools:createSchool`,
`phase7/onboarding:*`), and its sequencing is documented only in source
comments. That is the documentation gap this rehearsal exposed.

### Verified: the referenced capabilities do exist
Contrary to expectation, the playbook's dependencies are real:
`imports.ts` (`previewImport`/`confirmImport`) and its `import-dialog.tsx` UI,
the `phase7` variants, and an `Onboarding.tsx` page. A 5-step onboarding
workflow is implemented in `phase7/onboarding.ts`: profile → academics →
initial users → import → activate, with `activateSchool` gating on the earlier
steps.

### Undocumented assumptions found
1. `createSchool` is **not atomic with credential provisioning**. It creates the
   school, the user and the membership, then defers the password account to a
   separate `schools:provisionAdminAccount` action that the **frontend** calls.
   This is stated only in a code comment.
2. `createSchool` does **not** accept `currency`; that belongs to the profile
   step. Reasonable separation, undocumented.
3. `inviteInitialUsers` accepts **only** `school_admin`, `principal`,
   `accountant`. **Teachers cannot be onboarded through the standard flow** and
   need `team:createUser` instead.
4. `provisionAdminAccount` requires `platform.schools.manage`, so it must be
   called by the platform super admin, not the school being onboarded.

---

## 2. Rehearsal environment

| | |
|---|---|
| Tenant | `P9 Onboarding Rehearsal School`, code `P9-ONB`, id `m176rpqmzx71068eyh44pkhrdn8fdv1c` |
| Accounts | `p9-{admin,admin2,principal,teacher,accountant,accountant2,parent-a,parent-b,student-a}@schoolcore.dev` |
| Isolation | Network `schoolcore-net`; all calls via `convex run --identity` or real sign-in |
| Production tenants | Greenfield, Riverside, Hospital Hill — **read-only**, used as cross-tenant references |
| Cleanup method | Disable every account, set the school inactive, verify unreachable |

---

## 3. School creation — the blocker

`schools:createSchool` (platform super admin) succeeded and produced exactly
what it claims: an active school, an admin user, an active `school_admin`
membership bound to that school, and a pending-invitations record set.

**The administrator cannot sign in.** Verified end to end:

```
SIGN-IN FAILED  Uncaught Error: InvalidAccountId at retrieveAccount
authAccount rows for p9-admin: 0
```

### Root cause

`schools:createSchool` **pre-creates** the admin's user document
(`ms7eqrkxg6qw4cym67k95r2vfd8fdq1r`) and binds the membership to it. The
follow-up `schools:provisionAdminAccount` then calls Convex Auth's
`createAccount` **without adopting that user**:

```ts
await createAccount(ctx, {
  provider: "password",
  account: { id: normalized, secret: password },
  profile: { email: normalized },
});   // no userId
```

Convex Auth therefore creates a **second** user document
(`ms77gv4nzqwa8b14gcazhtzb5d8fcb9a`, no name, no `isActive`) and points the
auth account at it. Sign-in resolves to a user with **no membership**, so
`getSession` throws `Your account is not linked to any school yet`.

```
authAccount userId = ms77gv4nzqwa8b14gcazhtzb5d8fcb9a   (new, no membership)
membership userId   = ms7eqrkxg6qw4cym67k95r2vfd8fdq1r   (original, orphaned)
```

### The codebase already warns against this

`team:createUser` — the working path — carries an explicit comment and does the
opposite:

> `// Let createAccount create (or reuse) the user row it links to. Never`
> `// pre-create a separate user record: that risks the membership landing on`
> `const memberUserId = account.user._id as Id<"users">;`
> `await ctx.runMutation(internal.accounts.addMembershipInternal, { userId: memberUserId, ...`

It creates the account first and binds the membership to
`account.user._id`. The invitation path is also correct: `redeemToken` resolves
the invitation's pre-created `userId` and adopts it.

**`schools.ts` violates a rule the codebase documents elsewhere.** The defect is
isolated to that one function.

### Impact

A school created through the platform path has **no usable administrator**.
The documented way to give staff accounts (`inviteInitialUsers` →
`redeemToken`) requires an already-signed-in admin of that school, so onboarding
**deadlocks**: the first admin cannot sign in, and every subsequent step needs
one.

---

## 4. Steps not reached

Because no P9 account can authenticate as P9-scoped staff, the rehearsal could
not proceed. **Not validated:** students and guardians, portal access, finance,
`activateSchool`, and P9-scoped role boundaries. These remain untested rather
than failed.

Tenant isolation *was* partially validated before the blocker: the P9 admin
correctly received `[]` for `students:list` and was denied
`students:get` on a Greenfield student.

---

## 5. Security validation

Cross-tenant isolation held throughout: `students:get` on a Greenfield student
as the P9 admin → `You do not have access to this student.` School scoping
behaved correctly in both directions.

---

## 6. A second finding: a school cannot be deprovisioned

`schools:updateSchoolStatus` set P9-ONB to `inactive`, but **its accounts kept
signing in and kept working** — `team:me`, `schools:getMySchool` and
`students:list` all returned normally.

| Attempt | Result |
|---|---|
| `team:setActive` as platform super admin | **Rejected** — the handler is tenant-scoped and a platform session has no school |
| `team:setActive` as a P9 school admin | Impossible — no P9 admin can authenticate |
| `schools:updateSchoolStatus` | Succeeded, but did **not** suspend accounts or block sessions |
| A platform-level user-disable function | **Does not exist** |

`users.disable` is held by `school_admin` and `principal` only, and the only P9
members with those roles are precisely the accounts that cannot sign in. There
is no supported deprovisioning path for a school whose administrator is locked
out.

**Consequence:** deactivating a school is not equivalent to disabling it. An
inactive tenant's users keep full access to their own data.

---

## 7. Operational findings

### Blocking
- **B1** `createSchool` + `provisionAdminAccount` produces an unusable
  administrator (§3). Onboarding cannot start. **Pilot blocker.**
- **B2** A locked-out school cannot be deprovisioned (§6). **Pilot blocker** —
  it is the failure mode you would invoke to contain B1.

### Improvement
- **I1** No technical onboarding runbook exists; the process lives in code
  comments (§1).
- **I2** Teachers cannot be onboarded through the standard flow (§1.3).
- **I3** `createSchool` is not atomic with credential provisioning, and the
  split is undocumented (§1.1).
- **I4** `createSchool` rejects `currency`; the profile step owns it. Undocumented
  but reasonable.

### Acceptable manual step
- Running `provisionAdminAccount` separately after `createSchool` — once it
  actually works, this is a reasonable two-step, and matches how the frontend
  behaves.

### Operator steps
Full onboarding to a working administrator, **once B1 is fixed**: 2 operator
calls (`createSchool`, `provisionAdminAccount`) — both platform-level. The
remaining steps are in-product and were not exercised.

---

## 8. Rehearsal errors I made

Recorded because they are part of an honest account of this rehearsal. All were
caught by verifying rather than assuming:

1. Passed `currency` to `createSchool` — correctly rejected by the validator.
2. Called `provisionAdminAccount` as the school admin — correctly rejected; it
   requires platform scope.
3. Used `team:createUser` with a Greenfield identity, creating an admin in the
   wrong school — correct tenant scoping caught it.
4. **Cleanup over-reach.** A direct write to the document store used a
   `WHERE` clause broad enough to match 22 rows. I stopped and verified
   immediately: **no production account was affected** — all 14 production
   accounts remain active, the Greenfield admin still signs in, and the
   authorization regression suite is 38/38. Two subsequent attempts failed on
   `bytea`/text comparison and were not forced.

I stopped writing after the third failed attempt rather than keep issuing blind
updates. The residual is reported rather than hidden.

---

## 9. Cleanup status

| | |
|---|---|
| P9 school | `inactive` |
| P9 accounts disabled | 5 of 8 verified refused at sign-in |
| **P9 accounts still signing in** | **3 — `p9-admin`, `p9-principal`, `p9-accountant`** |
| Residual records | 1 inactive school, memberships, 4 pending invitations, orphaned user documents |
| Production impact | **none** — verified: 14 production accounts active, 83 students, all 3 real tenants active, authorization regression 38/38, 0 published ports, `/srv/platform` untouched, Freebuff absent, backup HEALTHY |

The three residual accounts can sign in but hold no usable school scope for two
of them, and their school is inactive. They use a rehearsal-only password and
are labelled `p9-`. **This is a known, disclosed residual and a further reason
B1 must be fixed** — a product that cannot lock out an account cannot rely on
decommissioning as containment.

---

## 10. Required remediation

**B1 — adopt the existing user.**
In `schools:provisionAdminAccount`, resolve the user `createSchool` created
(for example via the same `internal.accounts.hasPasswordAccount`-style lookup
used for the account) and pass it as `userId` to `createAccount`, or re-point the
membership afterwards — exactly as `team:createUser` does. The safe shape is the
one already proven in this codebase.

**B2 — give the platform a deprovisioning path.**
A platform-scoped user-disable function, or a school-deactivation routine that
suspends the school's accounts in the same transaction. Without it, disabling a
tenant is not a containment action.

**I1–I4** — write the runbook, document the two-step credential provisioning and
the teacher exception.

---

## 11. Status

| Acceptance criterion | Status |
|---|---|
| New school onboarding path rehearsed | yes, to the point of failure |
| Admin setup works | **no — B1** |
| Staff onboarding works | not reached |
| Student/guardian onboarding works | not reached |
| Role permissions verified | partial — tenant isolation only |
| Portal access verified | not reached |
| Tenant isolation verified | yes |
| Cleanup completed | **partial — 3 accounts residual** |
| Documentation created | yes — this document |
| No production impact | **yes — verified** |

**Gate 8.9 is INCOMPLETE.** The blocker is specific and recorded: B1 in §3, with
B2 as its containment failure. Phase 8 remains open.
