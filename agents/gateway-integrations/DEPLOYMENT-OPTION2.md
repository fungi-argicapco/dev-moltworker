# Deployment Guide — Option 2: Gateway Integration (KV-Backed Telegram Pairing)

## Overview

**Option 2:** Gateway reads Telegram approvals directly from Cloudflare KV at startup, before initializing the Telegram channel.

**Advantage vs Option 1:**
- ✅ Integrated into gateway startup (no separate sync service)
- ✅ Single point of integration (not a separate cron job)
- ✅ Fail-safe (if KV unavailable, gateway still starts with existing config)
- ✅ Cleaner architecture (no systemd service to manage)

**Architecture:**
```
OpenClaw Gateway Start
    ↓
[gateway-kv-loader.js] runs
    ↓
    1. Load .env (CF credentials)
    2. Resolve KV namespace ID
    3. Fetch approved users from KV
    4. Merge into channels.telegram.allowFrom
    ↓
Gateway loads modified config
    ↓
Telegram channel initialized with persisted approvals ✅
```

## Security Posture

✅ **Secure approach** (see SECURITY-ANALYSIS.md for full details):
- API token in `.env` only, never in config.json
- Read-only operations to KV
- Fail-safe: continues if KV unreachable
- All secrets isolated from main config file

**Risk Level:** 🟢 **LOW**

## Setup (3 Steps)

### Step 1: Prepare Credentials

```bash
# Copy .env template
cp /root/.openclaw/workspace/gateway-integrations/.env.example \
   /root/.openclaw/workspace/gateway-integrations/.env

# Edit .env with your Cloudflare credentials
vi /root/.openclaw/workspace/gateway-integrations/.env
```

**Required:**
```
CLOUDFLARE_ACCOUNT_ID=a9c661749d16228083b6047aa1e8a70e
CLOUDFLARE_API_TOKEN=<your_api_token>
```

**Set permissions:**
```bash
chmod 600 /root/.openclaw/workspace/gateway-integrations/.env
```

### Step 2: Create KV Namespace (If Needed)

**Check if namespace exists:**
```bash
source /root/.openclaw/workspace/gateway-integrations/.env

curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result[].title'
```

**If "telegram-pairing" not listed, create it:**
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"telegram-pairing"}'
```

**Note the ID** from response (or use auto-discovery in loader).

### Step 3: Integrate with Gateway Startup

Choose one of the following integration methods:

#### Method A: Wrapper Script (Simplest)

Use the shell wrapper to load KV before starting gateway:

```bash
# Option 1: Direct command
source /root/.openclaw/workspace/gateway-integrations/.env
bash /root/.openclaw/workspace/gateway-integrations/gateway-startup-wrapper.sh

# Option 2: Create alias
echo "alias ocstart='bash /root/.openclaw/workspace/gateway-integrations/gateway-startup-wrapper.sh'" \
  >> ~/.bashrc
source ~/.bashrc

# Then use:
ocstart
```

**Pros:** Simple, no systemd setup, clear execution flow  
**Cons:** Must remember to use wrapper (not `openclaw gateway start`)

#### Method B: Systemd Pre-Start Hook (Recommended)

Create systemd service that runs loader before gateway:

**File:** `/etc/systemd/system/openclaw-kv-preload.service`

```ini
[Unit]
Description=Load Telegram Pairing from Cloudflare KV
Before=openclaw.service
After=network-online.target

[Service]
Type=oneshot
User=root
EnvironmentFile=/root/.openclaw/workspace/gateway-integrations/.env
ExecStart=/usr/bin/node /root/.openclaw/workspace/gateway-integrations/gateway-kv-loader.js --apply --verbose
StandardOutput=journal
StandardError=journal
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

**Install:**
```bash
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
StandardOutput=journal
StandardError=journal
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable openclaw-kv-preload.service
```

**Test:**
```bash
# Run manually
sudo systemctl start openclaw-kv-preload.service
sudo systemctl status openclaw-kv-preload.service

# Check logs
journalctl -u openclaw-kv-preload -n 20
```

**Then start gateway normally:**
```bash
openclaw gateway start
# (systemd automatically runs kv-preload first)
```

**Pros:** Automatic on boot, clean separation, integrated with systemd  
**Cons:** Requires systemd (Linux only)

#### Method C: Cron + Polling (Optional)

Run loader periodically to keep approvals fresh:

```bash
# Add to crontab
crontab -e
```

**Add:**
```cron
# Load KV pairing every 5 minutes
*/5 * * * * source /root/.openclaw/workspace/gateway-integrations/.env && \
  /usr/bin/node /root/.openclaw/workspace/gateway-integrations/gateway-kv-loader.js --apply 2>&1 >> /var/log/openclaw-kv-preload.log
```

**Pros:** Keeps approvals in sync even if KV was updated externally  
**Cons:** Extra overhead, config rewrites every 5 min

**Combined approach (Recommended):**
- Systemd pre-start: Initial load on boot
- Cron: Refresh every 5-10 min during operation

#### Method D: Programmatic (For Custom Deployments)

If you have a custom gateway initialization, import and use directly:

```javascript
// your-gateway-init.js
import { loadTelegramPairingFromKV } from '/root/.openclaw/workspace/gateway-integrations/gateway-kv-loader.js';

async function initGateway() {
  // Load config
  const config = JSON.parse(fs.readFileSync('~/.openclaw/openclaw.json'));
  
  // Load Telegram pairing from KV
  const configWithKV = await loadTelegramPairingFromKV(config, {
    verbose: true,
    throwOnError: false, // Fail gracefully
  });
  
  // Start gateway with updated config
  // ... your gateway startup code
}

initGateway().catch(console.error);
```

## Testing

### Test 1: Manual Load (Dry Run)

```bash
source /root/.openclaw/workspace/gateway-integrations/.env
node /root/.openclaw/workspace/gateway-integrations/gateway-kv-loader.js --dry-run --verbose
```

**Expected output:**
```
[gateway-kv-loader] Account ID: a9c661749d16228083b6047aa1e8a70e
[gateway-kv-loader] KV Namespace: xyz789abc...
[gateway-kv-loader] Fetching approved users from KV...
[gateway-kv-loader] Found 1 approved users
  - 8476535456 (your_username) approved at 2026-02-24T18:00:00Z
[gateway-kv-loader] ✅ Merged into config. allowFrom: [8476535456]

DRY RUN - Would write:
{
  "enabled": true,
  "botToken": "...",
  "allowFrom": [
    "8476535456"
  ],
  ...
}
```

### Test 2: Apply and Verify

```bash
# Apply changes
source /root/.openclaw/workspace/gateway-integrations/.env
node /root/.openclaw/workspace/gateway-integrations/gateway-kv-loader.js --apply --verbose

# Check config was updated
cat ~/.openclaw/openclaw.json | jq '.channels.telegram.allowFrom'
# Should show: ["8476535456"]
```

### Test 3: Full Restart Cycle

```bash
# 1. Restart gateway (triggers loader if using systemd)
sudo systemctl restart openclaw

# 2. Check logs
journalctl -u openclaw-kv-preload -n 10
journalctl -u openclaw -n 10 | grep -i telegram

# 3. Send Telegram message to bot
# → Should work WITHOUT pairing prompt (approval persisted!)

# 4. Restart again
sudo systemctl restart openclaw

# 5. Send Telegram message again
# → Still works (approval survived restart)
```

## Troubleshooting

### Error: "KV namespace not found"

**Cause:** Namespace doesn't exist or was deleted.

**Fix:**
```bash
# List namespaces
source /root/.openclaw/workspace/gateway-integrations/.env
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result[].title'

# Create if missing:
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"telegram-pairing"}'

# Note the ID, then:
export TELEGRAM_KV_NAMESPACE_ID="new_id"
node gateway-kv-loader.js --apply --verbose
```

### Error: "CLOUDFLARE_ACCOUNT_ID not set"

**Fix:**
```bash
# Verify .env exists
ls -la /root/.openclaw/workspace/gateway-integrations/.env

# Source it
source /root/.openclaw/workspace/gateway-integrations/.env

# Check variables loaded
echo $CLOUDFLARE_ACCOUNT_ID
echo $CLOUDFLARE_API_TOKEN

# If empty, edit .env and try again
vi /root/.openclaw/workspace/gateway-integrations/.env
source /root/.openclaw/workspace/gateway-integrations/.env
```

### Systemd service doesn't run on boot

**Check:**
```bash
systemctl is-enabled openclaw-kv-preload.service
# Should output: enabled

systemctl status openclaw-kv-preload.service

journalctl -b | grep "openclaw-kv-preload"
```

**Fix:**
```bash
# Enable service
sudo systemctl enable openclaw-kv-preload.service

# Verify openclaw.service wants it
sudo systemctl edit openclaw.service
```

Add under `[Unit]`:
```ini
Before=openclaw.service
Wants=openclaw-kv-preload.service
```

### Config not updating (but no errors)

**Cause:** Loader ran but found 0 approved users in KV.

**Check:**
```bash
source /root/.openclaw/workspace/gateway-integrations/.env

# List KV keys
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$TELEGRAM_KV_NAMESPACE_ID/keys?prefix=telegram:" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result[].name'

# If empty, you haven't approved any users yet.
# Approve a user in Telegram, then try again.
```

## Monitoring

### View Sync Logs

```bash
# Real-time logs
journalctl -u openclaw-kv-preload -f

# Last 20 lines
journalctl -u openclaw-kv-preload -n 20
```

### Check Config State

```bash
# View current allowFrom
cat ~/.openclaw/openclaw.json | jq '.channels.telegram.allowFrom'

# Compare with KV
source /root/.openclaw/workspace/gateway-integrations/.env
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$TELEGRAM_KV_NAMESPACE_ID/keys?prefix=telegram:default:" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result[] | {name, approved: .name}'
```

### Check Gateway Status

```bash
openclaw status

# Check Telegram channel specifically
openclaw status | grep -A 5 telegram
```

## Rollback

If something breaks:

```bash
# Disable pre-start hook
sudo systemctl disable openclaw-kv-preload.service

# Reset config (remove allowFrom from Telegram)
# Edit ~/.openclaw/openclaw.json and delete:
#   "allowFrom": [...]

# Restart gateway
sudo systemctl restart openclaw
```

## Files Reference

| File | Purpose | When Used |
|------|---------|-----------|
| `gateway-kv-loader.js` | Main loader script | Every startup (via systemd or wrapper) |
| `gateway-startup-wrapper.sh` | Shell wrapper | If using Method A (manual wrapper) |
| `.env` | Cloudflare credentials | Every startup |
| `SECURITY-ANALYSIS.md` | Security review | Reference during deployment |
| `DEPLOYMENT-OPTION2.md` | This file | Setup guide |

## Success Criteria

✅ **Deployment successful when:**

1. `source .env && node gateway-kv-loader.js --dry-run` shows correct config
2. Systemd service (or wrapper) runs without errors
3. Gateway starts normally after loader runs
4. Telegram user approved once, survives gateway restart
5. Multiple restarts: approval still present

## Next Steps

1. ✅ Choose integration method (A-D)
2. ✅ Create .env with credentials
3. ✅ Test with dry-run
4. ✅ Apply and verify config updates
5. ✅ Restart gateway and test pairing
6. ✅ Monitor for 24 hours
7. ✅ Document in runbook

## References

- Schema: `kv-telegram-pairing-schema.json`
- Loader: `gateway-kv-loader.js` (fully self-contained)
- Security: `SECURITY-ANALYSIS.md`
- Option 1 (sync script): `DEPLOYMENT.md`
