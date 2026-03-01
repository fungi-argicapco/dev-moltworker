---
name: gateway-integrations
description: Manage OpenClaw gateway startup, KV-based configuration persistence, and Telegram pairing lifecycle. Use when configuring gateway startup sequence, persisting config to KV, managing Telegram bot pairing, or debugging gateway configuration issues.
---

# Gateway Integrations

Manage the OpenClaw gateway lifecycle — startup configuration, KV persistence, and Telegram pairing.

## Core Operations

### Gateway Startup
- Wrap gateway startup with pre-configured environment
- Load KV-stored config before OpenClaw boots
- Inject Telegram pairing state at startup
- Handle graceful shutdown and config persistence

### KV Configuration Persistence
- Store/retrieve `openclaw.json` config in Cloudflare KV
- Sync config between container filesystem and KV on startup/shutdown
- Handle config versioning and rollback
- Validate config structure before persisting

### Telegram Pairing
- Store Telegram user-to-agent pairings in KV
- Schema: `{ userId, agentId, pairedAt, status }`
- Handle pairing lifecycle (pair → verify → active → revoke)
- Multi-agent pairing (different Telegram users → different agents)

## Tools & Scripts

- `gateway-kv-loader.js` — Load config from KV at startup
- `gateway-startup-wrapper.sh` — Startup wrapper with KV pre-load
- `sync-kv-pairing.js` — Sync Telegram pairing state to/from KV
- `telegram-kv-pairing-hook.js` — Webhook handler for pairing events
- `setup.sh` — One-time setup for KV namespaces and initial config

## Architecture

```
Container Start
  → gateway-startup-wrapper.sh
    → gateway-kv-loader.js (pull config from KV)
    → start-openclaw.sh (boot OpenClaw with loaded config)
    → telegram-kv-pairing-hook.js (listen for pairing events)

Container Shutdown
  → sync-kv-pairing.js (persist current state to KV)
```

## KV Schema

| Key Pattern | Value | Description |
|------------|-------|-------------|
| `config:openclaw` | JSON | Full openclaw.json config |
| `pairing:tg:{userId}` | JSON | Telegram pairing record |
| `pairing:agent:{agentId}` | JSON | Agent-to-user mapping |

## Reference Docs

- `DEPLOYMENT.md` — Deployment option 1 (standard)
- `DEPLOYMENT-OPTION2.md` — Alternative deployment path
- `SECURITY-ANALYSIS.md` — Security review of KV integration
- `SECURITY-VERDICT.md` — Final security assessment
- `kv-telegram-pairing-schema.json` — Pairing schema definition

## Environment Variables

- `CLOUDFLARE_KV_NAMESPACE_ID` — KV namespace for config storage
- `CLOUDFLARE_ACCOUNT_ID` — Account ID
- `CLOUDFLARE_API_TOKEN` — API token with KV:Edit
