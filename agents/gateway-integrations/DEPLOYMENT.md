# Deployment Guide — Telegram KV Pairing (Option 1: Sync Script)

⚠️ **This is Option 1 (external sync script).** For better integration, see `DEPLOYMENT-OPTION2.md` (recommended).

This guide walks through deploying persistent Telegram pairing for OpenClaw using the standalone sync script.

## Problem Statement

Currently, when the OpenClaw gateway reboots:
- ❌ Approved Telegram users are lost
- ❌ `channels.telegram.allowFrom` is empty
- ❌ `dmPolicy: "pairing"` means new approval flow required every reboot
- ⏳ No persistent storage of pairing state

This integration solves it by storing approvals in **Cloudflare KV**.

## Architecture

```
Gateway Startup
    ↓
[sync-kv-pairing.js] reads from CF KV
    ↓
Merges approved users into config.channels.telegram.allowFrom
    ↓
Gateway starts with persisted approvals ✅
    ↓
User sends message → approved, no pairing needed
```

When user is approved:
```
/pair approval command
    ↓
Telegram channel sends PAIRING_APPROVED_MESSAGE
    ↓
User added to config.channels.telegram.allowFrom
    ↓
[Future] Hook writes to KV (for redundancy)
```

## Implementation Plan

### Phase 1: Sync on Boot (This Week) ✅

**Deliverable:** Read-only KV sync before gateway start.

**Files:**
- `sync-kv-pairing.js` — Reads KV, merges into config
- `setup.sh` — Interactive setup (credentials, KV namespace, systemd)
- `README.md` — Full documentation

**Steps:**
1. Run setup.sh (creates .env, tests API, creates KV namespace if needed)
2. Add sync-kv-pairing.js to gateway startup (systemd service or manual)
3. Test: Approve a user, restart gateway, user still approved ✅

**Deployment:**
```bash
cd /root/.openclaw/workspace/gateway-integrations
bash setup.sh
# Follow prompts, creates systemd service
systemctl restart openclaw
```

**Verification:**
```bash
# Check systemd service
systemctl status openclaw-sync-pairing
journalctl -u openclaw-sync-pairing -n 20

# Check config was merged
cat ~/.openclaw/openclaw.json | jq '.channels.telegram.allowFrom'
```

### Phase 2: Write on Approval (Later) ⏳

**Deliverable:** When pairing approval happens, also write to KV.

**Requires:** Hooking into gateway's Telegram channel initialization.

**Option A: Middleware Hook**
- Wrap `telegramPlugin.pairing.notifyApproval`
- Add KV write after approval

**Option B: Custom Channel Fork**
- Modify openclaw's Telegram extension
- Add KV write in pairing flow

**Option C: Cron-based Sync**
- Periodically sync config → KV (write-back)
- Ensures config changes are captured

**Recommended:** Start with Option A (telegram-kv-pairing-hook.js exists but unused).

### Phase 3: Web UI (Future) ⏳

**Deliverable:** Cloudflare Worker to view/revoke approvals.

**Endpoints:**
- `GET /api/telegram/approvals` → List all approved users
- `DELETE /api/telegram/approvals/{userId}` → Revoke approval
- `POST /api/telegram/approvals/{userId}` → Approve user (manual)

## Deployment Steps (Phase 1)

### 1. Prepare Environment

```bash
cd /root/.openclaw/workspace/gateway-integrations
ls -la
# Expected:
#   setup.sh
#   sync-kv-pairing.js
#   telegram-kv-pairing-hook.js
#   .env.example
#   README.md
```

### 2. Run Setup Script

```bash
bash setup.sh
```

**Prompts:**
- Cloudflare Account ID (get from dashboard)
- Cloudflare API Token (create with kv:read permission)
- Create systemd service? (recommended: yes)

**Output:**
- `.env` file with credentials
- KV namespace created (if needed)
- systemd service registered
- Sync script tested

### 3. Verify Setup

```bash
source /root/.openclaw/workspace/gateway-integrations/.env
node /root/.openclaw/workspace/gateway-integrations/sync-kv-pairing.js --verbose

# Expected output:
# [sync-kv-pairing] Config file: /root/.openclaw/openclaw.json
# [sync-kv-pairing] KV namespace ID: abc123...
# [sync-kv-pairing] Reading approved users from KV...
# [sync-kv-pairing] Found 0 approved users
# [sync-kv-pairing] ✅ Synced 0 approved users to config
```

### 4. Test Pairing Flow

```bash
# 1. Clear any existing approvals (optional)
# Edit ~/.openclaw/openclaw.json, set:
#   channels.telegram.allowFrom = []

# 2. Restart gateway
openclaw gateway restart

# 3. Send Telegram message to bot
# You should see pairing request

# 4. Approve pairing
# Follow bot's pairing flow

# 5. Verify config was updated
cat ~/.openclaw/openclaw.json | jq '.channels.telegram.allowFrom'
# Should show your user ID

# 6. Restart gateway again
openclaw gateway restart

# 7. Send message again
# Should work WITHOUT pairing prompt (approved persists!)
```

### 5. Systemd Integration

If setup.sh created the service:

```bash
# Check status
systemctl status openclaw-sync-pairing

# View logs
journalctl -u openclaw-sync-pairing -f

# Run manually (for testing)
/usr/bin/env bash -c 'source /root/.openclaw/gateway-integrations/.env && \
  /usr/bin/node /root/.openclaw/workspace/gateway-integrations/sync-kv-pairing.js --verbose'
```

## Troubleshooting

### sync-kv-pairing.js fails with "KV namespace not found"

**Cause:** Namespace not created or wrong name.

**Fix:**
```bash
# Check existing namespaces
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."

curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result[].title'

# If "telegram-pairing" not listed, run setup.sh again or create manually:
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"telegram-pairing"}'
```

### "CLOUDFLARE_ACCOUNT_ID or API_TOKEN not set"

**Fix:**
```bash
# Ensure .env is sourced
source /root/.openclaw/workspace/gateway-integrations/.env

# Or set manually
export CLOUDFLARE_ACCOUNT_ID="a9c661749d16228083b6047aa1e8a70e"
export CLOUDFLARE_API_TOKEN="your_token"

# Then run sync
node sync-kv-pairing.js --verbose
```

### Config not updating after approval

**Cause:** Sync script never ran after approval.

**Fix:**
```bash
# Manually run sync after approving a user
source /root/.openclaw/workspace/gateway-integrations/.env
node /root/.openclaw/workspace/gateway-integrations/sync-kv-pairing.js --verbose

# Check result
cat ~/.openclaw/openclaw.json | jq '.channels.telegram.allowFrom'
```

### Systemd service doesn't run on boot

**Check:**
```bash
systemctl is-enabled openclaw-sync-pairing
# Should output: enabled

systemctl status openclaw-sync-pairing
# Check for errors

# View boot logs
journalctl -b | grep openclaw-sync-pairing
```

**Fix:**
```bash
# Ensure service is enabled
sudo systemctl enable openclaw-sync-pairing.service

# Ensure openclaw.service depends on it
sudo systemctl edit openclaw.service
# Add under [Unit]:
#   After=openclaw-sync-pairing.service
#   Wants=openclaw-sync-pairing.service
```

## Rollback

If something breaks:

```bash
# Disable systemd service
sudo systemctl disable openclaw-sync-pairing.service

# Reset config (clears allowFrom)
cat ~/.openclaw/openclaw.json | jq 'del(.channels.telegram.allowFrom)' > /tmp/reset.json
mv /tmp/reset.json ~/.openclaw/openclaw.json

# Restart gateway
openclaw gateway restart
```

## Monitoring

### View Approved Users in KV

```bash
source /root/.openclaw/workspace/gateway-integrations/.env
curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$TELEGRAM_KV_NAMESPACE_ID/keys?prefix=telegram:" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq '.result[] | .name'
```

### Logs

```bash
# Sync script logs
journalctl -u openclaw-sync-pairing -f

# Gateway Telegram channel logs
journalctl -u openclaw -f | grep -i telegram
```

### Metrics to Track

- ✅ Sync script runs before gateway startup
- ✅ Approved users merge into config
- ✅ Pairing persists across reboots
- ✅ No performance impact (<1s sync time)

## Success Criteria

✅ **Phase 1 Complete When:**
1. sync-kv-pairing.js runs on boot (verified by systemd logs)
2. Telegram user approved once, gateway reboots, user still approved
3. No manual pairing needed after reboot
4. Config file contains approved user IDs in `.channels.telegram.allowFrom`

## References

- Schema: `kv-telegram-pairing-schema.json`
- Sync Script: `sync-kv-pairing.js`
- Hook (unused): `telegram-kv-pairing-hook.js`
- Setup: `setup.sh`
- Docs: `README.md`

## Timeline

- **Day 1 (Feb 24)**: Build Phase 1 (done ✅)
- **Day 2 (Feb 25)**: Deploy, test, verify
- **Day 3 (Feb 26)**: Monitor, fix issues, document
- **Later**: Phase 2 (write-back hook), Phase 3 (web UI)
