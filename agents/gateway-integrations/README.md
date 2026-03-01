# Gateway Integrations — Cloudflare KV Telegram Pairing

Telegram pairing state doesn't survive OpenClaw gateway reboots. This integration stores pairing approvals in **Cloudflare KV**, solving the persistence problem.

## Problem

Current behavior:
- ❌ Gateway reboots → approved users lost
- ❌ Config writes not persisting  
- ❌ Must re-approve every reboot
- ⏳ No persistent storage

## Solution

Store approved user IDs in Cloudflare KV, read them on gateway startup.

```
Gateway Startup
    ↓
[Option 1] sync-kv-pairing.js (external, systemd)
    OR
[Option 2] gateway-kv-loader.js (integrated, pre-startup)
    ↓
Read approved users from CF KV
    ↓
Merge into config.channels.telegram.allowFrom
    ↓
Gateway starts with persisted approvals ✅
```

## Option Comparison

### Option 1: External Sync Script (sync-kv-pairing.js)

External script runs before gateway (systemd service or cron).

**Pros:**
- ✅ Simple, standalone script
- ✅ Easy to debug (separate logs)
- ✅ Can run independently

**Cons:**
- ❌ Depends on systemd/cron
- ❌ Separate service to manage
- ❌ Risk of forgetting to run

**Best for:** Manual deployments, testing, legacy systems

**Docs:** `DEPLOYMENT.md`

### Option 2: Gateway Integration (gateway-kv-loader.js)

Integrated loader runs at gateway startup, before Telegram channel init.

**Pros:**
- ✅ Automatic with gateway
- ✅ Single point of integration
- ✅ Cleaner architecture
- ✅ Fail-safe (continues if KV unavailable)

**Cons:**
- ⚠️ Requires systemd or wrapper
- ⚠️ Slower startup (KV call overhead)

**Best for:** Production, automated deployments, cleaner ops

**Docs:** `DEPLOYMENT-OPTION2.md`

---

## Quick Decision

| Need | Use |
|------|-----|
| Testing KV pairing locally | Option 1 (manual) |
| Production on systemd | Option 2 (integrated) |
| Docker/Kubernetes | Option 2 (wrapper in entrypoint) |
| Legacy cron-based | Option 1 (sync-kv-pairing.js) |
| Simplest possible | Option 1 (one-shot script) |

---

## Setup

## Quick Start (Option 2 - Recommended)

```bash
# 1. Copy credentials template
cp .env.example .env

# 2. Edit with your Cloudflare details
vi .env
# Set: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN

# 3. Secure the file
chmod 600 .env

# 4. Test loader (dry run)
source .env
node gateway-kv-loader.js --dry-run --verbose

# 5. Apply (updates config)
node gateway-kv-loader.js --apply --verbose

# 6. Create systemd service (auto-run on boot)
sudo tee /etc/systemd/system/openclaw-kv-preload.service > /dev/null << 'EOF'
[Unit]
Description=Load Telegram Pairing from Cloudflare KV
Before=openclaw.service
After=network-online.target

[Service]
Type=oneshot
User=root
EnvironmentFile=/root/.openclaw/workspace/gateway-integrations/.env
ExecStart=/usr/bin/node /root/.openclaw/workspace/gateway-integrations/gateway-kv-loader.js --apply --verbose
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable openclaw-kv-preload.service

# 7. Start gateway (systemd auto-runs loader first)
openclaw gateway start
```

**Done!** Approvals now persist across reboots. Full docs: `DEPLOYMENT-OPTION2.md`

---

## Detailed Setup (Option 1)

### 1. Create Cloudflare KV Namespace

Using `wrangler`:

```bash
wrangler kv:namespace create "telegram-pairing"
# Binding: TELEGRAM_PAIRING
```

Or via Cloudflare API:

```bash
curl -X POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/storage/kv/namespaces \
  -H "Authorization: Bearer {API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title":"telegram-pairing"}'
```

Note the namespace ID from the response.

### 2. Set Environment Variables

```bash
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
export CLOUDFLARE_API_TOKEN="your_api_token"
export OPENCLAW_CONFIG="/root/.openclaw/openclaw.json"
```

Or store in `/root/.openclaw/gateway-integrations/.env`:

```
CLOUDFLARE_ACCOUNT_ID=a9c661749d16228083b6047aa1e8a70e
CLOUDFLARE_API_TOKEN=<token>
OPENCLAW_CONFIG=/root/.openclaw/openclaw.json
```

### 3. Sync on Gateway Startup

**Option A: Manual Before Startup**

```bash
node /root/.openclaw/workspace/gateway-integrations/sync-kv-pairing.js --verbose
openclaw gateway start
```

**Option B: Automatic (Cron)**

```bash
# Every reboot or periodically
0 * * * * /usr/bin/env bash -c 'source /root/.openclaw/gateway-integrations/.env && node /root/.openclaw/workspace/gateway-integrations/sync-kv-pairing.js'
```

Or use OpenClaw cron:

```bash
cron add \
  --name "Sync Telegram Pairing from KV" \
  --schedule "every:5m" \
  --payload '{"kind":"systemEvent","text":"[CRON] Syncing Telegram pairing from KV..."}'
```

Then in your agent: parse the system event and run the sync script.

**Option C: Systemd Service Hook**

Create `/etc/systemd/system/openclaw-sync-pairing.service`:

```ini
[Unit]
Description=Sync Telegram pairing from Cloudflare KV
Before=openclaw.service
After=network-online.target

[Service]
Type=oneshot
User=root
EnvironmentFile=/root/.openclaw/gateway-integrations/.env
ExecStart=/usr/bin/node /root/.openclaw/workspace/gateway-integrations/sync-kv-pairing.js --verbose
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
systemctl enable openclaw-sync-pairing.service
systemctl daemon-reload
```

This runs before openclaw.service on every boot.

### 4. Hook Pairing Approval to KV (Optional)

If you want approvals to *automatically* write to KV (not just read on startup), you need to modify the gateway's Telegram plugin initialization.

Create a gateway startup hook that installs the KV pairing hook:

```javascript
// ~/.openclaw/gateway-startup-hooks.js
import { installPairingHook } from "/root/.openclaw/workspace/gateway-integrations/telegram-kv-pairing-hook.js";

export async function beforeChannelsInit(ctx) {
  const { telegramPlugin, config } = ctx;
  
  // Get KV namespace ID (from config or env)
  const kvNamespaceId = process.env.TELEGRAM_KV_NAMESPACE_ID;
  
  if (kvNamespaceId && telegramPlugin) {
    installPairingHook(telegramPlugin, { kvNamespaceId });
    console.log("[gateway-startup] ✅ Installed Telegram KV pairing hook");
  }
}
```

But this requires modifying the gateway core. For now, the sync script is sufficient.

## Usage

### Sync from KV → Config

```bash
# Verbose output
node sync-kv-pairing.js --verbose

# Dry run (preview what would change)
node sync-kv-pairing.js --dry-run

# Custom config path
node sync-kv-pairing.js --config /path/to/openclaw.json

# With specific KV namespace ID (skips API call to list)
node sync-kv-pairing.js --kv-namespace-id "abc123def456"
```

### View Approved Users in KV

```bash
# List all keys in namespace
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{NS_ID}/keys" \
  -H "Authorization: Bearer {TOKEN}" | jq '.result[] | .name'

# Read specific user's approval
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{NS_ID}/values/telegram:default:8476535456" \
  -H "Authorization: Bearer {TOKEN}"
```

### Revoke an Approval

```bash
# Delete from KV (approved flag becomes false on next sync)
curl -X DELETE "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{NS_ID}/keys/telegram:default:8476535456" \
  -H "Authorization: Bearer {TOKEN}"
```

## Troubleshooting

### "KV namespace not found"

```
Error: KV namespace "telegram-pairing" not found.
```

Create the namespace in Cloudflare Dashboard or wrangler, then provide its ID:

```bash
node sync-kv-pairing.js --kv-namespace-id "xyz789"
```

### "CLOUDFLARE_ACCOUNT_ID and API_TOKEN not set"

```bash
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."
node sync-kv-pairing.js --verbose
```

Or add to `.env` file in this directory.

### Config not updating after approval

**Reasons:**
1. Sync script never ran after approval
2. KV writes succeeded but KV reads failed (check API token permissions)
3. Config file is read-only

**Fix:**
```bash
# Manually run sync after approval
node sync-kv-pairing.js --verbose

# Check config was updated
cat ~/.openclaw/openclaw.json | jq '.channels.telegram.allowFrom'

# Ensure config is writable
chmod 600 ~/.openclaw/openclaw.json
```

### "Failed to fetch KV namespaces"

Check your API token has `storage:kv:namespace:read` permission in Cloudflare Dashboard.

## Files

- **sync-kv-pairing.js** — Reads KV, merges into config (run on startup)
- **telegram-kv-pairing-hook.js** — Wraps pairing approval to write to KV (future)
- **kv-telegram-pairing-schema.json** — Data structure reference

## Next Steps

1. ✅ Test sync-kv-pairing.js locally
2. ⏳ Integrate with gateway startup (cron or systemd)
3. ⏳ Add manual approval → KV write hook (requires gateway plugin modification)
4. ⏳ Create web UI to view/revoke approvals

## References

- Cloudflare KV API: https://developers.cloudflare.com/workers/runtime-apis/kv/
- OpenClaw Telegram Plugin: `/usr/local/lib/node_modules/openclaw/extensions/telegram/`
