# SchoolCore — Customer Support Model

> Suggested operating model for customer support after launch. Severity levels
> and procedures are **recommendations**; contractual SLAs and any penalties
> require Owner approval (**OWNER DECISION REQUIRED**) before being quoted to
> customers.

---

## 1. Severity levels

| Level | Definition | Examples | Initial response target* | Update cadence |
| --- | --- | --- | --- | --- |
| **Critical** | System unavailable, or a major financial/security incident | Whole school cannot sign in; data-isolation breach suspected; payment posting corrupting records; ransomware/leak suspicion | ≤ 1 hour (business hours) / ASAP on-call | Every 2 hours until mitigated |
| **High** | A major workflow is unavailable for a school but the system is up | Cannot take attendance anywhere; results publishing blocked during exam week; invoices cannot be issued at term start; portals down | ≤ 4 business hours | Daily |
| **Normal** | An individual functional issue with a workaround | One report fails with an error; a single student record anomaly; a filter misbehaves | ≤ 1 business day | On progress |
| **Request** | Enhancement or configuration request | "Add a column to report cards"; "new fee structure for next year"; "extra training for new staff" | ≤ 3 business days acknowledgement | Per agreement |

\* Response targets are recommendations for the Owner to ratify — not
contractual SLAs until approved (**OWNER DECISION REQUIRED**). Severity is set
by SchoolCore support on triage; customers may dispute and escalate.

---

## 2. Channels

- **Primary:** support email (single, monitored inbox) — creates a written trail for every ticket.
- **Escalation phone:** for Critical issues only (numbers shared at go-live).
- **In-app:** customers describe issues via their admin; SchoolCore retrieves audit context server-side.
- **Self-serve:** docs (`docs/demo-accounts.md` for demo, import templates, this doc set) and quick-reference cards from training.

---

## 3. Procedures

### Triage (all tickets)
1. Log ticket: school, reporter, module, symptom, since-when, business impact.
2. Classify severity (Critical/High/Normal/Request); confirm scope (one school vs many → platform incident).
3. Acknowledge per the response target; give the ticket reference.

### Critical
1. Acknowledge immediately; engage on-call.
2. Stabilise first: restore service or contain the incident (e.g. disable affected surface, reverse the bad data operation where a tool exists — payment reversal exists in-product).
3. Communicate every 2 hours even if the update is "still investigating".
4. Root-cause after stabilisation; write a short incident report (timeline, cause, fix, prevention).
5. If security/tenant isolation is suspected: contain, then notify the Owner immediately; treat as a platform incident, not a school ticket.

### High
1. Reproduce on the demo deployment where possible; identify the failing workflow.
2. Workaround first (e.g. alternate path), fix second; keep the school's term calendar in mind (invoicing at term start, exams at term end are immovable windows).
3. Daily updates until resolved.

### Normal
1. Batch triage daily; fix in the normal release rhythm.
2. Reply with resolution or a workaround and expected fix window.

### Request
1. Acknowledge; classify: configuration (do it) vs enhancement (roadmap).
2. Configuration requests (fee structures, grading schemes, new term setup) are fulfilled per the support agreement or quoted as a service.
3. Enhancements go to a roadmap list reviewed with the Owner — never promise dates to customers.

---

## 4. Escalation path

```
Customer reporter (school contact)
   → SchoolCore support (triage, severity set)
      → Engineering (fix, platform incident handling)
         → Owner (Owner notified immediately for: Critical,
           security/isolation events, financial-integrity events,
           SLA-impacting outages, and any contractual dispute)
```

- A Critical ticket is escalated to the Owner at the same time as triage starts.
- Customer-side escalation: school administrator → headteacher/proprietor → named account contact at SchoolCore.

---

## 5. Proactive support (recommended)

- **Term-calendar watch:** at term start (invoicing) and term end (results), raise readiness checks and temporary hyper-care.
- **Adoption check-ins (30/90 days):** usage signals (attendance being taken, results published on time, portal sign-ins) reviewed with the school.
- **Health metrics SchoolCore can already see:** overdue invoice counts, failed payment callbacks, automation run failures, attendance coverage per class.

---

## 6. Boundaries

- Support covers the platform as shipped, configuration, and defect fixes.
- Not covered: on-site visits (unless quoted), custom development, data-entry services, third-party outages (M-Pesa/SMS providers — we assist triage but the provider resolves), and issues caused by customer-modified data outside the platform.
- Anything contractual (SLAs, penalties, credits, support hours beyond business hours): **OWNER DECISION REQUIRED** before being offered.
