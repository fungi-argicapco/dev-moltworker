# TOOLS.md — Aria (CFO + Team Orchestrator)

## Runtime

- **Platform:** Cloudflare Workers (Hardshell)
- **Container:** OpenClaw sandbox
- **AI Gateway:** `client-lowe-aigw` (dedicated, Unified Billing)
- **Storage:** R2 bucket `hardshell-prod-client-lowe`

## Active Integrations

> Note: Integrations are being set up. This file will be updated as each is activated.

### Financial Integrations

#### Wave (waveapps.com) — STATUS: PENDING
- Purpose: Accounting, invoicing, expense tracking
- API: Wave REST API
- Scope: Read/write transactions, invoices, expense categories
- Used by: Controller Agent

#### Mercury Bank — STATUS: PENDING
- Purpose: Cash position, bill pay, treasury yield
- MCP: Mercury MCP (13 tools, read-only)
- Scope: Accounts, transactions, treasury, recipients
- Used by: Treasury Agent

#### Google Calendar — STATUS: PENDING
- Purpose: Financial + legal deadline reminders
- Scope: Read/write calendar events for tax/compliance deadlines

#### Gmail — STATUS: PENDING
- Purpose: Receipt capture, CPA correspondence
- Scope: Read-only recommended

### Legal Integrations

#### USPTO TSDR — STATUS: AVAILABLE
- Purpose: Trademark clearance searches
- API: USPTO REST API (free, public)
- Used by: IP & Privacy Agent

#### PACER — STATUS: PENDING
- Purpose: Federal court record monitoring
- API: PACER API ($0.10/page)
- Used by: Litigation & Disputes Agent

### Trading Integrations — STATUS: FUTURE (Phase 2+)

#### Alpaca — NOT ACTIVE
- Purpose: Equities, options trading (paper → live)
- Will be activated when client is ready for investment tools

## Tax Jurisdictions

### Federal (IRS)
- Quarterly estimated tax: Apr 15, Jun 15, Sep 15, Jan 15
- Annual filing: Apr 15 (Form 1040 + Schedule C)
- Entity: Sole proprietor (confirm)

### Washington State
- No state income tax
- B&O tax: Annual filing required
- UBI number: TBD

### City of Bellevue
- Annual business license renewal
- Deadline: TBD (confirm with Dr. Lowe)

### King County
- Annual requirements: TBD (confirm with Dr. Lowe)

## Healthcare Compliance

### Professional Licenses
- WA State Psychology Board license renewal
- Continuing education requirements tracking
- DEA registration (if applicable): TBD

### HIPAA
- Annual risk assessment: TBD
- Workforce training: TBD
- BAA inventory: TBD (list all vendors handling PHI)

### Telehealth
- Active states: Washington (primary)
- Future expansion: TBD

## Skills Available

### Financial Team
- `cfo-agent` — Core financial management (Aria's primary skill)
- `controller-agent` — Bookkeeping, P&L, monthly close
- `tax-strategist-agent` — Tax planning and compliance
- `treasury-agent` — Cash management via Mercury
- `investor-relations-agent` — Board decks, KPIs
- `financial-analyst-agent` — Modeling and forecasting
- `quant-agent` — Market intelligence (future)

### Legal Team
- `general-counsel-agent` — Legal orchestration
- `corporate-contracts-agent` — Entity and contracts
- `regulatory-compliance-agent` — Multi-jurisdiction compliance
- `ip-privacy-agent` — IP and data privacy
- `litigation-disputes-agent` — Risk and disputes
- `healthcare-compliance-agent` — HIPAA and licensing
