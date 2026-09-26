# Email → Resend Migration (Preparation)

> **Status:** PREPARATION. No code has been changed; no keys configured.
> The current Freebuff/Convex Cloud deployment continues using its existing
> email paths until the migration is executed (**OWNER DECISION REQUIRED**).

---

## 1. Current email functionality (audit result)

| Surface | File | Trigger | Provider / gating | Behaviour when unset |
| --- | --- | --- | --- | --- |
| Email channel in the communications queue | `src/convex/phase6/communications.ts` | `queueMessagesRows` (per recipient) + `processJobInternal` (retry loop) | `EMAIL_API_KEY` env check; provider send is a **stub** — `providerReady` never actually sends | `status:"failed"`, `failureReason:"email integration is not configured"`; retries capped at 3 attempts |
| Email OTP sign-in | `src/convex/auth/emailOtp.ts` | Convex Auth `sendVerificationRequest` | `VLY_EMAIL_OTP_API_KEY` → `POST https://auth.freebuff.app/send_otp` | Throws `"Email OTP is not configured (missing VLY_EMAIL_OTP_API_KEY)."` |
| AI / other VLY integrations | `src/lib/vly-integrations.ts` | `phase6-ai` actions | `VLY_INTEGRATION_KEY` | AI actions unavailable (out of email scope) |

Notes from the audit:

- The comm queue's "delivery" is currently a **configuration-gated stub** —
  no provider send is implemented for any channel. Migrating email to Resend
  therefore means implementing the first real sender, not swapping one.
- Admin sign-in does **not** use email OTP (the provider is retained from the
  platform template, per its own comments) — so the OTP surface is low-traffic
  but must still work on self-host (it is the only passwordless entry path).
- `emailTemplates` table (per-school, per-event templates) already exists and
  feeds the email channel — the abstraction should keep using it.

---

## 2. Design: email provider abstraction

**Goal:** business logic never calls a provider directly (already the queue's
stated architecture); email gets a provider interface with two adapters:
`resend` (new) and `vly` (legacy, Freebuff-era, removable at cutover).

```
src/convex/phase6/emailProvider.ts        (new, "use node" not required — axios is fine)
  ├─ type EmailProvider = { id, send(msg): Promise<{ id?: string }> }
  ├─ getProvider(ctx?): picks by env:
  │     RESEND_API_KEY   → resend adapter   (preferred, self-host)
  │     EMAIL_API_KEY    → vly/gateway adapter (legacy, current cloud behaviour)
  │     neither          → null  → queue marks failed "email integration is not configured"
  └─ adapters:
       resend: POST https://api.resend.com/emails  (Authorization: Bearer RESEND_API_KEY)
               { from, to, subject, text }  (+ html later)
       vly:    existing gateway semantics preserved unchanged
```

Integration points (the only two code changes required later):

1. `communications.ts` `processJobInternal` — replace the `providerReady`
   stub with `provider.send(...)` for `channel === "email"`, keeping the
   attempts/retry/`failureReason` semantics identical.
2. `auth/emailOtp.ts` `sendVerificationRequest` — try Resend first
   (`RESEND_API_KEY`), fall back to the VLY gateway while it still exists.

Everything else (templates, queue, delivery log, preferences, bulk jobs)
stays as-is.

---

## 3. Environment variables (future state)

| Variable | Status | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | **future** — not read by code yet | Enables Resend as the email provider (OTP + comm queue). Format: `re_…`; **never committed**. |
| `EMAIL_API_KEY` | current | Legacy email channel gate on Convex Cloud (kept working; removed at cutover if Owner agrees) |
| `VLY_EMAIL_OTP_API_KEY` | current | Legacy OTP gateway; fallback until Resend verified |

Add `RESEND_API_KEY=<blank>` to the self-hosted env template when Phase 4
starts (SECRET_MANAGEMENT_GUIDE §4 documents it already). No `.env.example`
change is possible right now (platform blocks edits); it is a manual Owner
edit: add `RESEND_API_KEY=` with no value under a comment.

---

## 4. Resend account requirements (Owner setup)

- Resend account + API key (**stored server-side only**).
- A verified sending domain (SPF/DKIM DNS records) — e.g. `mail.schoolcore.example`.
- From-address convention, e.g. `SchoolCore <noreply@mail.…>` — decide per
  deployment; OTP emails come from the same domain.
- On the FREE tier: 100 emails/day, 3,000/month, 1 domain — adequate for
  pilots; PRO for volume (pricing at decision time).

---

## 5. Migration steps (to execute later, in order)

1. **Add adapter code** (§2): `emailProvider.ts` + the two call-site changes.
   No behavioural change on Cloud (Resend path activates only when
   `RESEND_API_KEY` is set).
2. **Owner provisions Resend:** domain verification, `RESEND_API_KEY` into
   the deployment env (Keys UI on Cloud if desired, or self-host env file).
3. **Verify OTP:** request an OTP sign-in code; confirm delivery + link/brand.
4. **Verify comm queue:** send a test email-channel bulk job; confirm
   `commMessages.status` transitions queued → sent with a real provider id.
5. **Set `RESEND_API_KEY` on self-host** during Phase 4 of the self-host
   rollout; remove VLY OTP fallback at cutover.
6. **Update docs** (`production-deployment.md` §3 table: add `RESEND_API_KEY`;
   mark `VLY_EMAIL_OTP_API_KEY` as sunset) at implementation time.

Rollback: unset `RESEND_API_KEY` → provider resolution falls back to the
legacy path (or to graceful "not configured" failure) — no code rollback
needed for the fallback design.

---

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Domain not verified → Resend rejects sends | Verify domain before go-live; keep OTP fallback during transition |
| Rate limits on FREE tier | Monitor; upgrade tier before volume rollout |
| OTP deliverability (spam filtering) | Use a subdomain + proper SPF/DKIM; test with real inboxes |
| Secrets exposure | Key server-side only; never in `VITE_*` or repo (SECRET_MANAGEMENT_GUIDE) |
