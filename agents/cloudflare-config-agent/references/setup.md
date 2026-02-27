# CloudflareConfigAgent Setup

## Prerequisites

✅ All ready:
- Cloudflare Account ID: `a9c661749d16228083b6047aa1e8a70e`
- Cloudflare API Token: Configured in environment
- KV Namespace: `openclaw-config` (must be created)
- D1 Databases: crm-db, contentguru-db (already set up)

## Setup Steps

### 1. Create KV Namespace

Go to Cloudflare Dashboard → Workers → KV → Create Namespace

Name: `openclaw-config`

This is where the agent will store OpenClaw configuration.

### 2. Initialize Config in KV

```bash
# Read local config and store in KV
node scripts/config-manager.js get
# This will read /root/.openclaw/openclaw.json and cache it in KV
```

### 3. Test KV Access

```bash
# Get config from KV
node scripts/cloudflare-kv.js get openclaw-config

# List all keys
node scripts/cloudflare-kv.js list
```

### 4. Fix Telegram Pairing (Test Case)

```bash
# Update Telegram with pairing info
node scripts/config-manager.js telegram 8476535456 WX3SKJE4

# Verify it was written
node scripts/cloudflare-kv.js get openclaw-config | grep -A 5 telegram
```

## Operations

### Update Configuration

```javascript
const cfg = require('./scripts/config-manager.js');

// Update Telegram
await cfg.updateTelegramPairing('8476535456', 'WX3SKJE4');

// Add API token
await cfg.setApiToken('linear-api', 'lin_api_xxx');

// Manual patch
await cfg.updateConfig({
  channels: { telegram: { enabled: true } }
});
```

### Read Configuration

```javascript
const cfg = require('./scripts/config-manager.js');
const current = await cfg.getConfig();
console.log(current.channels.telegram);
```

## What This Enables

✅ **No shell access needed**
- Read/write config via API
- Manage secrets in KV (encrypted)
- Update environment variables
- Trigger restarts

✅ **Persistent across reboots**
- Config stored in KV (not ephemeral)
- Survives worker restarts
- Survives gateway restarts

✅ **Foundation for other agents**
- CRMAnalystAgent can store DB credentials
- IntegrationArchitectAgent can manage integrations
- AllAgents can securely share API tokens

## Next Steps

1. Create KV namespace in Cloudflare dashboard
2. Run initialization script
3. Test Telegram pairing update
4. Once working, spawn as standalone agent
5. Build remaining Cloudflare agents (deployment, monitoring, security)
