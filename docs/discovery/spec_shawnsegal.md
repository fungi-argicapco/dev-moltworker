# Client Spec: Shawn Segal — Arcane Vapes

> **Client Slug**: `arcane-vapes`
> **Discovery Date**: February 26, 2026
> **Discovery Lead**: Joshua Fischburg
> **Status**: Discovery Complete → Spec Draft → POC Scheduled (Mar 5, 2:00 PM EST)

---

## 1. Client Profile

| Field | Value |
|-------|-------|
| **Name** | Shawn Segal |
| **Business** | Arcane Vapes (smoke & vapor shop) |
| **Location** | South Florida |
| **Role** | Owner-Operator / CFO |
| **Industry** | Retail — Tobacco & Vapor |
| **Team Size** | 6 employees |
| **Vendors** | Several dozen |
| **Collaborators** | JB Brands (Tyson vapes) — salesman coaching partnership |
| **POS System** | SumUp (recently migrated from Clover) |
| **Revenue Model** | Retail sales (walk-in), 3D-printed accessories (Ridge wallet alternatives), consulting (JB Brands coaching) |

### Current Situation
- Extremely high workload (85–90 hr weeks)
- Solo coverage when staff calls out
- Managing multiple legal matters (Valmar small claims, Clover/First Data dispute)
- Active JB Brands partnership (sales coaching workshops)
- February = slowest month (post-holiday, short month, New Year's resolutions)
- Shadowbanned on Instagram/Meta — social media presence frozen

---

## 2. Agent Requirements

### 2.1 Priority #1: Inventory Management & Order Automation
- Real-time inventory level monitoring via SumUp integration
- Automated reorder suggestions when stock falls below thresholds
- Multi-vendor order compilation and tracking
- Back-order detection and alternative sourcing alerts
- Dead inventory exchange opportunities with partner shops
- Shrinkage tracking and reporting

### 2.2 Priority #2: Scheduling & Payroll
- Monthly staff schedule generation (currently whiteboard → photo → Discord)
- Staff availability tracking and conflict resolution
- Bi-weekly payroll reminders (every 14 days)
- Schedule publishing to Discord channel

### 2.3 Priority #3: License & Compliance Reminders
- Annual renewal tracking for:
  - Local/municipal business licenses
  - State of Florida tobacco/vapor licenses
  - Federal licenses (if applicable)
  - County certifications
- Proactive reminders with escalation (gentle → firm → "sit down and do this now")
- Deadline-based task prioritization

### 2.4 Priority #4: Research & Delegation
- Vendor research and price comparison
- Legal research support (landlord issues, tenant coordination)
- Product sourcing assistance
- Industry compliance monitoring (FDA/FTC vape regulations)

### 2.5 Nice-to-Haves
- Daily motivational quote/message
- Daily joke
- Social media management within platform ToS (if shadowban can be resolved)
- Video analysis for JB Brands coaching presentations
- Sales performance tracking and trend analysis

---

## 3. Agent Personality & Interaction

| Attribute | Specification |
|-----------|---------------|
| **Personality Model** | "Nicole" — strict, regimented, deadline-focused, escalating urgency |
| **Proactivity** | Yes — check in, remind, surface alerts, escalate unfinished tasks |
| **Devices** | All — laptop, phone, tablet (congruent cross-platform experience) |
| **Communication** | Telegram (primary), Discord (team), WhatsApp (vendors) |
| **Tone** | Direct, no-nonsense, but supportive. Humor welcome. |

---

## 4. Required Integrations

| System | Purpose | Integration Type | Priority |
|--------|---------|-----------------|----------|
| **SumUp POS** | Inventory, sales, scheduling, back office | API key or agent login | 🔴 Critical |
| **Google Calendar** | Task scheduling, reminders, deadlines | Calendar API | 🟡 High |
| **Gmail** | Email monitoring, vendor communications | Gmail API | 🟡 High |
| **Discord** | Schedule posting, team communication | Webhook / Bot | 🟢 Medium |
| **WhatsApp** | Vendor communication | Read-only monitoring | 🟢 Medium |
| **Telegram** | Primary agent interaction channel | OpenClaw native | 🔴 Critical |

---

## 5. Access & Security

| Concern | Policy |
|---------|--------|
| **Email access** | Yes, with limits |
| **Calendar access** | Yes |
| **File access** | Yes, with limits |
| **Sensitive docs** | Explicitly OUT OF BOUNDS — employee SSNs, personal financial info, legal docs |
| **Phone restrictions** | App Store only (Jordan controls device security) — no third-party downloads |
| **Agent sandbox** | Must operate entirely within Cloudflare sandbox; no local installs |

---

## 6. Current Technology Stack

| Tool | Purpose | Status |
|------|---------|--------|
| **SumUp** | POS, inventory, sales tracking | Active — hardware replacement pending (end of March) |
| **Gmail** | Email (migrating from Outlook) | Active |
| **Google Calendar** | Scheduling, reminders | Active |
| **Phone Notes** | Task tracking, priority lists | Active |
| **Discord** | Team communication, schedule posting | Active |
| **WhatsApp** | Vendor/customer communication | Active |
| **Gemini (paid)** | AI assistant for research, legal, fitness, etc. | Active |
| **OneDrive** | Shared file storage (shop PC) | Active |
| **Instagram** | Social media (dormant due to shadowban) | Frozen |

---

## 7. Key Pain Points (Ranked)

1. **Inventory management** — too many vendors, back-orders, maintaining healthy stock levels
2. **Order automation** — manual multi-vendor ordering is time-consuming
3. **Scheduling** — whiteboard → photo → Discord is inefficient; SumUp only does 1-week schedules
4. **Payroll reminders** — falls through cracks without manual phone reminders
5. **License renewals** — annual deadlines across municipal/state/federal easily missed
6. **Solo coverage** — when staff calls out, everything breaks down
7. **Social media shadowban** — can't market on Instagram/Meta
8. **Legal overhead** — Valmar, Clover/First Data disputes consuming bandwidth

---

## 8. Hardshell Resource Naming

Per [STD-RES-001](../standards/resource-naming-convention.md):

| Resource | Name |
|----------|------|
| Agent ID | `client-arcane-vapes` |
| Workspace | `workspace-arcane-vapes` |
| Dispatch Worker | `client-arcane-vapes` (inside `hardshell-prod` namespace) |
| KV Config | `hardshell-prod-config` (shared) |
| D1 Record | `clients.id = 'arcane-vapes'` |

> [!NOTE]
> `arcane-vapes` was already designated as the reference client slug in the resource naming convention document.

---

## 9. Commercial Model

| Item | Value |
|------|-------|
| **Engagement Type** | Partnership Sprint |
| **Phase 1 Scope** | Agent + Telegram setup, baseline capabilities (no integrations yet) |
| **Phase 2 Scope** | SumUp integration, inventory automation, scheduling |
| **Brand Vertical** | Retail / Regulated Commerce |
| **Plan Tier** | Starter (projected) |

---

## 10. Next Steps

- [x] Discovery complete (Feb 26, 2026)
- [ ] **Mar 5, 2:00 PM EST**: POC presentation meeting
  - [ ] Set up Cloudflare account for Shawn
  - [ ] Instantiate agent with baseline capabilities
  - [ ] Demo Telegram interaction
  - [ ] Demo Linear project tracking
- [ ] Shawn: Install and recover Telegram account
- [ ] Shawn: Mark sensitive internal documents as out-of-bounds
- [ ] Shawn: Obtain SumUp API key or login credentials for agent access

- [ ] Phase 2: SumUp integration scoping
- [ ] Phase 2: Inventory automation rules engine
