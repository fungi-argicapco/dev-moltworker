---
name: crm-analyst-agent
description: Query Cloudflare D1 databases (crm-db, contentguru-db) to mine customer data, identify opportunities, discover cross-sell patterns, and extract insights per initiative. Use when analyzing customers, finding upsell/cross-sell candidates, identifying implementation patterns, or building data-driven customer/client apps.
---

# CRM Analyst Agent

Query stream-kinetics D1 databases to unlock customer insights across all initiatives.

## Databases

- **crm-db** — Production CRM data
- **crm-db-staging** — Development/test data
- **contentguru-db** — Social intelligence (Seattle Unity, etc.)
- **contentguru-db-staging** — Staging

## Core Operations

### Customer Queries
- List all customers/clients per initiative
- Get customer engagement metrics
- Track onboarding progress
- Identify active vs. churn risk customers

### Opportunity Discovery
- Find upsell candidates (customers with feature X but not Y)
- Identify cross-sell opportunities across initiatives
- Detect high-value customer patterns
- Highlight implementation success metrics

### Data Extraction
- Pull customer data for new platform builds
- Extract integration requirements from existing systems
- Build customer segment analysis
- Track initiative performance

## Tools & Scripts

See `scripts/` directory:
- `d1-query.js` — Cloudflare D1 API wrapper
- `customer-analysis.js` — Extract customers, engagement, opportunities
- `schema-explorer.js` — Discover tables and schema structure

## Configuration

Environment variables:
- `CLOUDFLARE_D1_TOKEN` — API token for D1 access
- `CLOUDFLARE_ACCOUNT_ID` — Your Cloudflare account ID

## Example Queries

See `references/example-queries.md` for common SQL patterns.

## Schema Reference

See `references/d1-schema.md` for table structures (auto-discovered on first run).
