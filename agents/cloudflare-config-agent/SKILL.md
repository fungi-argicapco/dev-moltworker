---
name: cloudflare-config-agent
description: Manage OpenClaw configuration, secrets, and environment variables via Cloudflare API (no shell access needed). Use when updating gateway config, managing Telegram pairing, storing API tokens in KV, managing Workers environment, or configuring D1 access without direct server access.
---

# Cloudflare Config Agent

Autonomous agent for managing OpenClaw infrastructure via Cloudflare APIs (Workers, KV, D1, API Tokens).

## Core Operations

### Configuration Management
- Read current gateway/OpenClaw config
- Update config (Telegram pairing, API tokens, settings)
- Persist config to Cloudflare KV
- Validate config before applying

### Secrets & Environment
- Store API tokens in Cloudflare KV (encrypted)
- Manage environment variables for Workers
- Rotate credentials securely
- Audit secret access

### Service Management
- Trigger gateway restart (via config change + webhook)
- Deploy config updates
- Rollback on failure

### Data Persistence
- KV namespace: `openclaw-config`
- D1 database credentials in KV
- Telegram pairing state
- Linear API tokens
- All secrets encrypted

## Workflow: Fix Telegram Pairing (Example)

**Input:** Telegram user ID (8476535456) + pairing code (WX3SKJE4)

**Output:** Telegram enabled, persisted across reboots

```
1. Read current config from KV
2. Add to channels.telegram:
   - allowFrom: [8476535456]
   - dms: { "8476535456": { paired: true } }
3. Write config back to KV
4. Validate config structure
5. Trigger gateway config reload
```

## Tools & Scripts

See `scripts/` directory:
- `cloudflare-kv.js` — KV read/write wrapper
- `config-manager.js` — Read/update/validate OpenClaw config
- `secrets-manager.js` — Encrypt/store/retrieve secrets
- `gateway-controller.js` — Trigger restarts and reloads

## Configuration

Environment variables (in Worker):
- `CLOUDFLARE_ACCOUNT_ID` ✅ Already set
- `CLOUDFLARE_API_TOKEN` ✅ Already set
- `CLOUDFLARE_KV_NAMESPACE_ID` — KV namespace for config storage

## KV Namespaces

- **openclaw-config** — Current gateway config (JSON)
- **openclaw-secrets** — Encrypted API tokens
- **openclaw-pairing** — Telegram/device pairing state

## Reference

See `references/` for Cloudflare API docs and examples.
