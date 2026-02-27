---
name: data-model-agent
description: Design normalized database schemas from discovery data. Use when building new platforms, designing D1 table structures, generating migration SQL, mapping client data to standard models, or planning schema evolution.
---

# Data Model Agent

Design and normalize database schemas for Cloudflare D1 (SQLite-compatible).

## Core Operations

### Schema Design
- Analyze discovery data to extract entity models
- Design normalized schemas (1NF → 3NF)
- Define relationships (1:1, 1:N, M:N with junction tables)
- Generate primary/foreign key constraints
- Design indexes for query performance

### Migration Management
- Generate `CREATE TABLE` statements (D1-compatible SQLite)
- Design incremental migration files (numbered: `0001_*.sql`, `0002_*.sql`)
- Handle schema drift detection
- Plan backwards-compatible column additions
- Generate rollback SQL for each migration

### Data Mapping
- Map client discovery data to standard CRM schema
- Identify entity overlap across clients
- Design multi-tenant isolation (row-level vs. database-level)
- Generate seed data from discovery output

## Tools & Scripts

- `scripts/design-schema.js` — Create entity model from discovery JSON
- `scripts/generate-sql.js` — Output CREATE TABLE + migration SQL

## Output

All schema designs produce:
1. **Entity-Relationship Diagram** — Mermaid ER diagram
2. **SQL DDL** — D1-compatible CREATE TABLE statements
3. **Migration File** — Numbered, idempotent migration SQL
4. **Seed Data** — Sample INSERT statements for testing
5. **Index Recommendations** — Based on expected query patterns

## Standard Schema Patterns

### CRM Tables (crm-db)
- `customers` — Client records with initiative mapping
- `engagements` — Interaction history and touchpoints
- `opportunities` — Sales pipeline stages
- `portfolio_resources` — CF resource inventory per client

### Platform Tables (per-client D1)
- `service_tokens` — Encrypted API token storage (see zero-trust-agent)
- `audit_log` — Immutable action log
- `validation_runs` — Security sweep results

## Environment Variables

- `CLOUDFLARE_D1_TOKEN` — API token with D1:Edit
- `CLOUDFLARE_ACCOUNT_ID` — Account ID
