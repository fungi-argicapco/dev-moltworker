# Zero Trust Agent

> **Stream Kinetics** · Security Infrastructure · Phase 1
> Maintained by: Omega (AI Agent) | Owner: Joshua Fischburg

---

## Purpose

The **Zero Trust Agent** continuously validates the health, expiry, and scope
integrity of all Cloudflare API tokens used across the Stream Kinetics
infrastructure. It enforces a _never trust, always verify_ posture:

- Every token is **encrypted at rest** (AES-256-GCM) in Cloudflare D1
- All tokens are **validated live** against the CF API on each sweep
- **Anomalies are prioritised** (P0 → P2) and logged to an immutable audit trail
- A **composite trust score** (0–100) summarises overall token health

### Covered Services (6)

| Key        | Cloudflare Service        | Endpoint                                    |
|------------|---------------------------|---------------------------------------------|
| `workers`  | Workers Scripts           | `GET /accounts/{id}/workers/scripts`        |
| `d1`       | D1 Databases              | `GET /accounts/{id}/d1/database`            |
| `stream`   | Stream Video              | `GET /accounts/{id}/stream`                 |
| `r2`       | R2 Object Storage         | `GET /accounts/{id}/r2/buckets`             |
| `pages`    | Pages Projects            | `GET /accounts/{id}/pages/projects`         |
| `firewall` | Firewall Access Rules     | `GET /accounts/{id}/firewall/access-rules/rules` |

---

## Architecture

```
interceptor.js          ← Main orchestrator (run this)
├── token-vault.js      ← AES-256-GCM encrypt/decrypt + D1 storage
├── cf-validator.js     ← Live CF API validation (6 services)
└── d1-client.js        ← D1 HTTP API wrapper

migrations/
└── 001_initial.sql     ← DB schema (4 tables)

tests/
└── phase1.test.js      ← Unit tests (node:test)
```

---

## Environment Variables

All variables **must** be set before running the agent:

| Variable         | Required | Description |
|------------------|----------|-------------|
| `ENCRYPTION_KEY` | ✅ Yes   | 64-char hex string (32 bytes). AES-256-GCM key. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CF_ACCOUNT_ID`  | ✅ Yes   | Cloudflare Account ID (found in CF dashboard URL) |
| `CF_D1_TOKEN`    | ✅ Yes   | Cloudflare API token with `D1:Edit` permission |
| `CF_D1_DB_ID`    | ✅ Yes   | D1 database UUID for `crm-db` (from CF dashboard or API) |

### Setting Up `.env`

```bash
# /root/.openclaw/workspace/agents/zero-trust-agent/.env
ENCRYPTION_KEY=<64-char hex>
CF_ACCOUNT_ID=a9c661749d16228083b6047aa1e8a70e
CF_D1_TOKEN=<your-d1-api-token>
CF_D1_DB_ID=<crm-db-uuid>
```

---

## Installation

```bash
cd /root/.openclaw/workspace/agents/zero-trust-agent
npm install
```

---

## Usage

### Run a Validation Sweep

```bash
# Manual sweep (default)
node src/interceptor.js

# Specify trigger type
node src/interceptor.js manual
node src/interceptor.js scheduled
node src/interceptor.js startup
```

Exit codes:
- `0` = All tokens valid
- `1` = One or more tokens failed validation
- `2` = Fatal error (misconfiguration, network failure)

### Store a Token

```javascript
const vault = require('./src/token-vault');

// Store (or rotate) a token
await vault.storeToken(
  'workers',              // service key
  'my-plaintext-token',  // token value
  '2026-12-31T00:00:00Z', // expires_at (or null)
  ['Workers Scripts:Edit'] // expected scopes
);
```

### Validate Programmatically

```javascript
const { validateAll } = require('./src/interceptor');

const result = await validateAll('scheduled');

console.log(`Score: ${result.score}/100`);
console.log(`Valid: ${result.valid}`);
console.log(`Recommendation: ${result.recommendation}`);

// Per-service results
for (const svc of result.results) {
  console.log(`${svc.service}: ${svc.valid ? '✓' : '✗'} — ${svc.error || 'OK'}`);
}
```

### Validate a Single Service

```javascript
const { validateService } = require('./src/cf-validator');

const result = await validateService('workers', 'my-token', ['Workers Scripts:Read']);
// { service, valid, status, scopes, expiresIn, error, latencyMs }
```

### List All Stored Tokens (safe — no plaintext)

```javascript
const { listTokens } = require('./src/token-vault');
const tokens = await listTokens();
// Returns: [{ id, service, token_hash, status, expires_at, ... }]
```

---

## Anomaly Rules

| Rule                   | Priority | Action | Trigger Condition |
|------------------------|----------|--------|-------------------|
| `TOKEN_INVALID`        | P0       | HALT   | CF API returns 401 or 403 |
| `TOKEN_EXPIRED_STATUS` | P0       | HALT   | Vault record `status='expired'` |
| `TOKEN_EXPIRED`        | P0       | HALT   | `expiresIn <= 0` |
| `TOKEN_EXPIRY_SOON`    | P1       | WARN   | `expiresIn < 7 days` |
| `SCOPE_MISMATCH`       | P1       | WARN   | Actual scopes ≠ expected scopes |
| `TOKEN_EXPIRY_UPCOMING`| P2       | LOG    | `expiresIn < 30 days` |

### Actions

- **HALT** — Immediate operator attention required. Score set to 0 for that service.
- **WARN** — Token functional but rotation needed. 50% score deduction.
- **LOG** — Informational. 15% score deduction.

---

## Trust Score

The composite score (0–100) is calculated per-service:

```
Each service = 100/6 ≈ 16.67 points

Deductions:
  Invalid / HALT → 100% loss (0 points for service)
  P1/WARN        → 50% loss
  P2/LOG         → 15% loss

Total = sum of all service scores
```

A score ≥ 90 is **healthy**. Below 70 warrants immediate attention.

---

## D1 Schema

### `service_tokens`
Encrypted token storage. One row per service.

### `audit_log`
Immutable log of all agent actions. Never updated, only appended.

### `validation_runs`
One row per sweep. Stores aggregate stats and full JSON summary.

### `portfolio_resources`
Maps CF resources to Stream Kinetics portfolio entities (contentguru.ai, hardshell, etc.)

---

## Running Tests

```bash
cd /root/.openclaw/workspace/agents/zero-trust-agent
node tests/phase1.test.js
```

Tests use Node.js built-in `node:test` — no test runner to install.

---

## Apply DB Migration

```bash
node scripts/migrate.js
```

Or apply manually via Cloudflare dashboard → D1 → `crm-db` → Console.

---

## Phase 2 Roadmap

- [ ] Token rotation workflow (auto-rotate via CF API)
- [ ] Linear issue auto-creation on HALT anomalies (linked to SK team)
- [ ] Scheduled sweep via Cloudflare Workers Cron Trigger
- [ ] Portfolio resource discovery (auto-populate `portfolio_resources`)
- [ ] Slack/Telegram alerting on P0/P1 anomalies
- [ ] Dashboard Worker exposing `/health` and `/metrics` endpoints
- [ ] Multi-account support

---

## Linear Integration

- **TSD:** [SK-31](https://linear.app/stream-kinetics/document/sk-31-zero-trust-agent-tsd-3d8c26276c24)
- **Implementation Plan:** [SK-32](https://linear.app/stream-kinetics/document/sk-32-zero-trust-agent-implementation-plan-7af2c5d76545)
- **Team:** `stream-kinetics` (SK)
