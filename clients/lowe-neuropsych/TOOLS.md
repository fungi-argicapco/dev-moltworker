# TOOLS.md — Aria (CFO Agent)

## Runtime

- **Platform:** Cloudflare Workers (Hardshell)
- **Container:** OpenClaw sandbox
- **AI Gateway:** `client-lowe-aigw` (dedicated, Unified Billing)
- **Storage:** R2 bucket `hardshell-prod-client-lowe`

## Active Integrations

> Note: Integrations are being set up. This file will be updated as each is activated.

### Wave (waveapps.com) — STATUS: PENDING
- Purpose: Accounting, invoicing, expense tracking
- API: Wave REST API (verify current status post-H&R Block acquisition)
- Scope: Read/write transactions, invoices, expense categories

### Google Calendar — STATUS: PENDING
- Purpose: Financial deadline reminders
- Scope: Read/write calendar events for tax deadlines and renewals

### Gmail — STATUS: PENDING
- Purpose: Receipt capture, CPA correspondence
- Scope: Read-only recommended

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

### Professional Licenses
- WA State Psychology Board license renewal
- Continuing education requirements tracking

## Skills Available

- `cfo-agent` — Core financial management capabilities
