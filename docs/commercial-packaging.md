# SchoolCore — Commercial Packaging (Draft for Owner Review)

> **Status: DRAFT.** Nothing in this document is enforced in code. Plan
> groupings, pricing and trial policy are commercial decisions for the Owner.
> Every final choice is marked **OWNER DECISION REQUIRED**.

---

## 1. Module catalogue (commercial categories)

All modules below already exist in the product. Groupings are for packaging,
quoting and sales conversations only — the application itself is unchanged.

| Commercial category | Existing modules / surfaces (route) |
| --- | --- |
| **School Administration** | Dashboard, Students, Guardians, Staff & Teachers, School Setup (`/onboarding`), Settings, Users, Roles & permissions matrix, Access Management, Audit Logs |
| **Academics** | Academic Years, Terms, Grade Levels, Classes & Streams, Subjects, Teacher Allocations, Timetable, Assignments, Academic Settings |
| **Attendance** | Attendance (daily + per-lesson registers, history & analytics), attendance in portals |
| **Examinations & Results** | Assessments & Marks, Grading schemes, Results workflow (submit → approve → publish), Report Cards, Promotions |
| **Finance & Fees** | Finance Dashboard, Fees & Billing, Fee Items (voteheads), Invoices, Payments & Receipts, Student Accounts, Discounts & Scholarships, Expenses, Financial Reports, Reconciliation, Bank Imports |
| **Parent Portal** | Parent portal (children switcher, attendance, results, report cards, fees, receipts, assignments, timetable, announcements, notifications, profile) |
| **Student Portal** | Student portal (timetable, assignments, attendance, results, report card, announcements) |
| **Communication** | Announcements (per-audience), portal notifications |
| **HR** | Human Resources (employee profiles, contracts, documents, leave) |
| **Payroll** | Payroll (salary structures, runs) |
| **Library** | Library (catalogue, issues, overdue automation) |
| **Transport** | Transport (routes, vehicles, student assignment) |
| **Boarding** | Boarding (houses/rooms, allocation) |
| **Inventory** | Inventory & Assets (items, stock movements, low-stock alerts) |
| **Procurement** | Procurement (suppliers, orders) |
| **Medical** | Clinic & Medical (profiles, visits; permission-gated) |
| **Admissions** | Admissions (applications → review → decision → conversion), Meals, Meals/QR student ID |
| **Meals** | Meals (plans, eligibility, consumption, QR ID scanning) |
| **Reporting & Analytics** | Academic Analytics, Financial Reports, dashboards, audit trail |
| **Advanced integrations** | M-Pesa/bank payment callbacks (per school), SMS/OTP communications, bank statement imports, QR meal terminal |

---

## 2. Draft plans (for Owner review)

> These groupings are drafts for discussion. No plan gating exists in code and
> none is proposed in this phase.

### Starter — for smaller schools requiring core administration
Commercially associated modules:
- School Administration (students, guardians, staff, setup, users, roles, audit)
- Academics (years, terms, grades, classes, subjects, allocations, timetable)
- Attendance (daily register)
- Admissions (core application → enrolment)
- Finance & Fees (fees, invoices, payments/receipts, basic reports)
- Reporting & Analytics (core dashboards)
- Parent Portal (read-only basics) — **OWNER DECISION REQUIRED** (include here or only in Professional)
- Student Portal — **OWNER DECISION REQUIRED** (same question)

### Professional — for established schools requiring academics, finance, portals and operations
Everything in Starter, plus:
- Full Examinations & Results (assessments, grading, results workflow, report cards)
- Full portals (parent + student) with announcements
- Communication (announcements, notifications)
- HR
- Library, Transport, Boarding
- Meals
- Promotions, full Reconciliation, Bank Imports
- Expanded Reporting & Analytics

### Enterprise — for larger schools requiring the complete platform, integrations and enhanced support
Everything in Professional, plus:
- Payroll
- Procurement
- Medical (permission-gated sensitive module)
- Advanced integrations (M-Pesa/bank payment callbacks per school, SMS/OTP, bank statement imports, QR meal terminal)
- Multi-campus / multi-school oversight — **OWNER DECISION REQUIRED** (platform console today serves the platform owner; whether to resell it per customer is an Owner call)
- Enhanced support tier (see `docs/customer-support.md`)

Plan boundaries summary (module × plan draft):

| Category | Starter | Professional | Enterprise |
| --- | :-: | :-: | :-: |
| School Administration | ✔ | ✔ | ✔ |
| Academics | ✔ | ✔ | ✔ |
| Attendance | ✔ | ✔ | ✔ |
| Admissions | ✔ | ✔ | ✔ |
| Finance & Fees | core | full | full |
| Reporting & Analytics | core | full | full |
| Examinations & Results | — | ✔ | ✔ |
| Parent Portal | **OWNER DECISION REQUIRED** | ✔ | ✔ |
| Student Portal | **OWNER DECISION REQUIRED** | ✔ | ✔ |
| Communication | — | ✔ | ✔ |
| HR / Library / Transport / Boarding / Meals | — | ✔ | ✔ |
| Payroll / Procurement / Medical | — | — | ✔ |
| Advanced integrations | — | — | ✔ |
| Enhanced support | — | — | ✔ |

---

## 3. Pricing options (draft models, not decisions)

Currency example: Kenyan Shillings (KES). Figures are **illustrative anchors
only** to show magnitude — final pricing is an **OWNER DECISION REQUIRED**.

### Model A — Flat monthly school subscription
One monthly price per school; all included modules; unlimited users.
- *Illustrative anchor:* Starter KES 15,000/mo · Professional KES 35,000/mo · Enterprise KES 70,000/mo
- **Advantages:** simplest to sell and invoice; predictable for schools; no metering; aligns with "whole school" value; sales conversation is fast.
- **Disadvantages:** small schools pay relatively more; large schools get a bargain; revenue doesn't grow with the school; price anchors must be set well.

### Model B — Per-student pricing
Price per enrolled student per term/year.
- *Illustrative anchor:* KES 30–60 per student per term (Starter tier), tiered discounts above 500 students
- **Advantages:** scales with school size and value; fair to small schools; industry-familiar (like per-child fees); revenue grows as schools grow.
- **Disadvantages:** requires an accurate student count (audit/disputes); invoicing varies term to term; very large schools may perceive it as expensive; more billing admin.

### Model C — Hybrid: base fee + per-student
Modest base platform fee + low per-student rate.
- *Illustrative anchor:* base KES 10,000/mo + KES 15 per student/mo
- **Advantages:** covers fixed service costs; keeps marginal price low and fair; scales with growth; common SaaS pattern; flexible per tier.
- **Disadvantages:** more complex to explain and quote; two numbers to negotiate; requires count verification.

### Model D — Annual subscription (applies to A/B/C)
Pay annually, typically with a discount.
- *Illustrative anchor:* 10–12 months for the price of 10 (i.e. ~2 months free)
- **Advantages:** upfront cash; lower churn; fewer renewals; funds implementation.
- **Disadvantages:** discount reduces revenue; annual billing is a bigger ask for cash-strapped schools; refunds/credit complexity if school leaves.

### Model E — One-off service fees (compatible with any model)
- Implementation/setup fee (see `docs/customer-onboarding.md`): *illustrative* KES 50,000–150,000 one-off depending on data volume and training scope — **OWNER DECISION REQUIRED**
- Training fee: administrator/teacher sessions; often included in implementation; extra sessions chargeable per day — **OWNER DECISION REQUIRED**
- Optional integration costs: M-Pesa/bank payment setup, SMS volume, QR meal terminals — per-school quote — **OWNER DECISION REQUIRED**
- **Advantages:** compensates real onboarding effort; filters non-serious buyers; protects margins on heavy-customisation schools.
- **Disadvantages:** adds friction to closing; schools expect "free setup"; must be scoped tightly to avoid loss-making implementations.

### Recommended hybrid structure to evaluate (still an **OWNER DECISION REQUIRED**)
Starter/Professional/Enterprise tiers on **Model C** (base + per-student), billed
monthly with **Model D** annual discount, plus **Model E** implementation fee for
guided onboarding. This keeps each tier simple to quote while letting revenue
scale with school size.

**Final pricing choice: OWNER DECISION REQUIRED** (model, tier prices, discounts,
integration pricing, service fees).

---

## 4. Trial / demo policy options

| Option | What it is | Advantages | Risks |
| --- | --- | --- | --- |
| **Guided demo only** | Sales-led demo on the demo environment; no school data | Zero support cost; controlled narrative; no security/data exposure; funnel stays sales-owned | Schools may not internalise value without their own data; slower conviction |
| **14-day self-service trial** | Temporary school workspace, sample data + own data upload | Fast activation; lets admin/teachers try with real workflows; time pressure aids decision | Support load; schools may "cherry-pick" without data migration; requires trial provisioning tooling (not built — would be a product feature) |
| **30-day trial** | As above, longer | Enough for a full term-cycle feel (attendance, one exam cycle) | Doubles support exposure; momentum loss; more abandoned workspaces |
| **Paid pilot** | 4–8 week pilot at reduced fee, credits against subscription if converted | Serious intent; offsets cost; strong conversion signal | Harder to close; schools may expect pilot = free; legal/papering overhead |
| **Free pilot for selected first schools** | Hand-picked flagship schools, free for a term, in exchange for references | Builds local proof and testimonials; shapes roadmap; low barrier for first customers | Support cost without revenue; schools may expect permanent free tier; scope creep risk |

Recommendation to evaluate (not decide): guided demo now (demo environment is
ready), free structured pilot for the **first 2–3 schools** to create reference
cases, then paid pilots/trials.

**Final choice: OWNER DECISION REQUIRED** (policy, trial length, pilot terms,
reference/consent conditions).

---

## 5. What is deliberately NOT decided here

- Tier names, contents and boundaries (incl. portals in Starter)
- Pricing model and figures
- Annual discount percentage
- Implementation/training/integration fees
- Trial/pilot policy
- Any code-level plan enforcement (none exists; none proposed)

All of the above: **OWNER DECISION REQUIRED.**
