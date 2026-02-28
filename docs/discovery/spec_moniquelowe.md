# Client Spec: Dr. Monique Lowe

> **Client Slug**: `lowe-neuropsych`
> **Discovery Date**: February 27, 2026
> **Discovery Lead**: Joshua Fischburg
> **Status**: Discovery Complete → Spec Draft

---

## 1. Client Profile

| Field | Value |
|-------|-------|
| **Name** | Dr. Monique Lowe, PhD |
| **Business** | Solo neuropsychological testing practice |
| **Location** | Bellevue, WA |
| **Operating Since** | 2016 |
| **Industry** | Healthcare — Neuropsychological Assessment |
| **Revenue Model** | Fee-for-service (3-visit testing cycle: intake → testing → feedback) |
| **Team** | Solo practitioner + fractional secretary (Sandy, ~10 hrs/week, shared with 4 others) + 1 intern (rotating annually) |
| **Capacity** | Fully booked, scheduling May/June from February |
| **Referral Sources** | Allegro Pediatrics, Microsoft ASD internal directory, school districts, word-of-mouth |

### Growth Vision (12-Month)
- Expand within current flexible office space (add 2–3 rooms)
- Hire psychometrists and additional interns to perform testing under supervision
- Remote oversight capability (camera-based QA from anywhere)
- Long-term: **The Sofia Institute** — co-located practitioner network (OT, PT, specialists) sharing a secretary and referral pipeline
- Personal: Location-independent lifestyle (Italy part-year), working efficiently not harder

---

## 2. Immediate Engagement: Personal CFO Agent

> [!IMPORTANT]
> The first deliverable is a **Personal CFO Agent** — not the full clinical platform. This agent helps Dr. Lowe understand and optimize the financial side of her practice.

### 2.1 CFO Agent Capabilities

#### Cost & Revenue Optimization
- **Revenue tracking**: Map fee-for-service income by test type, patient type (pediatric vs. adult), and referral source
- **Expense analysis**: Categorize and track costs — platform subscriptions (Practice Fusion $180/mo, Waves AI $139/yr, MMB $100/yr, Pearson/PAR/WPS per-usage fees), office rent, secretary salary splits, test kit amortization
- **Margin analysis**: Per-patient profitability (revenue per 3-visit cycle minus test costs, time, platform fees)
- **Subscription audit**: Identify redundant or underused subscriptions; recommend consolidation
- **Growth modeling**: Project revenue impact of adding psychometrists (hourly employees) vs. solo capacity

#### Tax Filing & Compliance
- **Prior year reference**: Use prior year tax submission as template for current year filing
- **Quarterly estimated taxes**: Calculate and remind for WA State, King County / Bellevue city, and federal quarterly payments
- **Annual fees**: Track and alert for:
  - Washington State business license renewal
  - City of Bellevue business license
  - Professional license renewal (Psychology Board)
  - Any industry-specific certifications
- **Deduction tracking**: Categorize business expenses for Schedule C (test kits, software subscriptions, office rent, continuing education, mileage)
- **1099 management**: Track contractor payments (secretary arrangement, any future psychometrists on 1099)

#### Financial Calendar
- Automated reminders for all tax deadlines (quarterly estimates: Apr 15, Jun 15, Sep 15, Jan 15)
- Annual renewal deadlines aggregated into a single financial calendar
- Payment confirmations and receipt organization

### 2.2 Required Integrations (CFO Phase)

| System | Purpose | Integration Type |
|--------|---------|------------------|
| **Practice Fusion** (EHR) | Patient visit counts, billing data | API (developer center available) |
| **Wave (waveapps.com)** | Accounting, invoicing, expense tracking | Wave API — used last year, no current accounting software in place. CFO agent will evaluate whether to continue with Wave or recommend an alternative. |
| **Google Calendar** | Financial deadline reminders | Calendar API |
| **Email** | Receipt capture, correspondence with CPA | Gmail API |

### 2.3 Data & Compliance (CFO Phase)

- **HIPAA**: CFO agent does NOT need access to patient clinical data — only aggregate visit counts and billing amounts
- **Financial data**: Standard encryption at rest and in transit
- **BAA**: Not required for CFO-only scope (no PHI access)

---

## 3. Future Phases (Clinical Platform)

> [!NOTE]
> These are documented from discovery for roadmap planning. They are NOT part of the immediate CFO engagement.

### Phase 2: Intake Automation
- Real-time audio transcription during clinical intake calls
- Auto-categorization into neuropsych report sections (identification, background, cognitive/behavioral, mental health history, medication, etc.)
- Output: Formatted intake section ready for report insertion
- **Current workflow**: Waves AI recording → ChatGPT formatting → manual insertion
- **Target**: Single-step recording → structured intake output

### Phase 3: Test Scoring Engine
- Digitize scoring rubrics from purchased manuals (WISC-V, WAIS, NEPSI, RAVLT, Trails A&B, Sentence Repetition, CVLT)
- **Open source tests** (no licensing issues): RAVLT, Trails A&B, Sentence Repetition, GAD, ADHD screeners
- **Proprietary tests** (personal professional use): WISC-V, WAIS-IV (scoring from purchased administration manuals — legal for personal clinical use per Claude analysis)
- MMB (Myers Neuropsychological Battery) replacement — currently $100/yr, buggy Mac version
- Auto-populate domain-based score sheets (Attention, Executive Function, Learning/Memory, Language, Visual-Spatial, Motor)
- Radar graph visualization of patient cognitive profile by domain

### Phase 4: Report Generation
- Template-based report assembly from scored data + intake
- Auto-populate test scores into domain sections
- AI-generated interpretive paragraphs based on scoring patterns (trained on de-identified sample reports)
- ePHI scrubbing verification
- Grammar and quality check
- PDF generation → Practice Fusion upload via API
- **Target**: Report completion in < 30 minutes (currently multi-hour, multi-day process)

### Phase 5: Multi-Practitioner Platform
- VPN / Zero Trust access for interns and psychometrists
- Role-based access (data entry only — no copy/export capability)
- Camera-based remote observation with annotation
- Training module system (test administration cheat sheets, didactic content)
- Quality dashboard (red/amber/green per active session)
- IP protection measures (prevent report template theft)

---

## 4. Current Technology Stack

| Tool | Cost | Purpose | Pain Level |
|------|------|---------|------------|
| **Practice Fusion** | $180/mo | EHR, patient records, scheduling | Medium — functional but no integration |
| **Waves AI** | $139/yr | Audio recording + transcription during intake | Low — works well, but disconnected from report flow |
| **ChatGPT** | Included | Format transcribed intake into report sections | Low — manual copy-paste step |
| **PAR (Pearson)** | Per-usage (~$80/50 tests) | Scoring platform for Pearson tests (IQ, achievement) | Medium — siloed, PDF export only |
| **WPS** | Per-usage | Scoring platform for WPS tests | Medium — siloed, has API available |
| **MMB (Myers Battery)** | $100/yr | Scoring for RAVLT, Sentence Rep, Trails, COWAT | High — buggy Mac port, can't print, freezing |
| **Doxy.me** | Unknown | Telehealth / video sessions | Low — has BAA, works well |
| **Claude (Anthropic)** | Unknown | Research, legal questions, extended thinking | Low — new adoption |

---

## 5. Key Pain Points (Ranked)

1. **Report writing** — multi-hour process gathering data from 4+ disconnected platforms
2. **Manual scoring** — handwritten score sheets for every patient, 15 min × 3-4/week
3. **Platform fragmentation** — PAR, WPS, MMB all isolated; no cross-platform data flow
4. **Peripheral requests** — accommodation letters, referral faxes, school forms — time sucks that fall through cracks
5. **Data security concerns** — worried about IP theft (report templates), intern access control
6. **Physical records burden** — 8+ years of paper records requiring retention; no digitization pipeline

---

## 6. Hardshell Resource Naming

Per [STD-RES-001](../standards/resource-naming-convention.md):

| Resource | Name |
|----------|------|
| Agent ID | `client-lowe-neuropsych` |
| Workspace | `workspace-lowe-neuropsych` |
| KV Config | `hardshell-prod-config` (shared) |
| D1 Record | `clients.id = 'lowe-neuropsych'` |

---

## 7. Commercial Model

| Item | Value |
|------|-------|
| **Engagement Type** | Partnership Sprint (modified) |
| **Phase 1 Scope** | Personal CFO Agent |
| **Estimated Hours** | 20–30 hrs |
| **Pricing** | TBD — see discovery follow-up |
| **Ongoing** | Monthly subscription for agent hosting + AI token usage |
| **Brand Vertical** | Healthcare / Independent Practitioner |
| **Plan Tier** | Pro (projected) |

---

## 8. Next Steps

- [ ] Follow-up meeting to present CFO agent proof of concept
- [ ] Re-activate or set up Wave (waveapps.com) accounting — she used it last year but has no accounting software currently
- [ ] Obtain prior year tax return structure for template
- [ ] Identify all annual WA/Bellevue/federal filing deadlines
- [ ] Set up Cloudflare account and agent instance
- [ ] Scope Phase 2 (Intake Automation) timeline based on Phase 1 learnings
