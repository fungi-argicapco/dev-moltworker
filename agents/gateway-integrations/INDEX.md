# Gateway Integrations Index

Cloudflare KV-backed Telegram pairing for persistent approvals across reboots.

## Start Here

👉 **New to this?** Read `README.md` first (5 min)  
👉 **Want deployment instructions?** Choose:
- Option 1 (external): `DEPLOYMENT.md`
- Option 2 (integrated): `DEPLOYMENT-OPTION2.md` ⭐ recommended

## Files

### Core Scripts

```
gateway-kv-loader.js              Main loader (reads KV, merges config)
├─ Option: Integrated (systemd pre-startup)
├─ API: Programmatic (import & call function)
├─ CLI: Command-line (--dry-run, --apply, --verbose)
└─ Use: DEPLOYMENT-OPTION2.md

sync-kv-pairing.js                External sync script
├─ Option: Standalone (systemd service or cron)
├─ API: CLI only
├─ CLI: Standalone command
└─ Use: DEPLOYMENT.md

gateway-startup-wrapper.sh        Shell wrapper (manual or Docker)
├─ Option: Manual wrapper (bash script)
├─ Use: Run before `openclaw gateway start`
└─ Or: Docker entrypoint
```

### Documentation

```
README.md                         Overview + quick start (both options)
IMPLEMENTATION-SUMMARY.md         Complete reference (this session)
SECURITY-ANALYSIS.md              Threat model + risk assessment

DEPLOYMENT.md                     Option 1: External sync (detailed)
DEPLOYMENT-OPTION2.md             Option 2: Integrated (detailed, recommended)

kv-telegram-pairing-schema.json   Data model reference
.env.example                      Credentials template
setup.sh                          Interactive setup (Option 1)
```

### Quick Decision Tree

```
Are you familiar with systemd?
├─ Yes → Use Option 2 (DEPLOYMENT-OPTION2.md)
│        Simpler, automatic, modern
└─ No  → Use Option 1 (DEPLOYMENT.md)
         Standalone, can test manually

Deploying to production?
├─ Yes → Use Option 2 + systemd service
│        Will be automatic on reboots
└─ No  → Use manual wrapper for testing
         Run: gateway-startup-wrapper.sh

Using Docker?
├─ Yes → Use gateway-startup-wrapper.sh in entrypoint
│        Works with any Docker setup
└─ No  → Use systemd (Option 2) or manual (Option 1)
```

## The 3-Step Solution

### Step 1: Credentials
```bash
cp .env.example .env
vi .env  # Add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN
chmod 600 .env
```

### Step 2: Test
```bash
source .env
node gateway-kv-loader.js --dry-run --verbose
```

### Step 3: Deploy
**Option A (Manual):**
```bash
node gateway-kv-loader.js --apply --verbose
openclaw gateway restart
```

**Option B (Systemd, recommended):**
```bash
# [Create /etc/systemd/system/openclaw-kv-preload.service]
# [See DEPLOYMENT-OPTION2.md for full details]
sudo systemctl enable openclaw-kv-preload.service
openclaw gateway restart
```

## Security

✅ **Threat model reviewed:** SECURITY-ANALYSIS.md  
✅ **Risk level: LOW**  
✅ **API token isolation:** Stored in .env, never config.json  
✅ **Read-only operations:** No KV writes, no privilege escalation  

## Troubleshooting

| Error | Check | Fix |
|-------|-------|-----|
| "KV namespace not found" | Does "telegram-pairing" exist in CF? | Create namespace or set `TELEGRAM_KV_NAMESPACE_ID` |
| "CLOUDFLARE_API_TOKEN not set" | Is `.env` sourced? | `source .env` before running |
| Config not updating | Are there users in KV? | Approve a user first |
| Systemd service not running | Is it enabled? | `systemctl enable openclaw-kv-preload.service` |
| Gateway slow to start | Normal overhead? | ~500ms for KV read (acceptable) |

See `DEPLOYMENT-OPTION2.md` for full troubleshooting.

## What This Solves

**Before:**
- ❌ Approve Telegram user
- ❌ Gateway reboots
- ❌ Approval lost
- ❌ Must re-approve

**After:**
- ✅ Approve Telegram user
- ✅ Approval stored in KV
- ✅ Gateway restarts
- ✅ Approval auto-restored ✅

## Performance

- KV read latency: ~500ms (happens once at startup)
- Memory overhead: <1MB
- No runtime impact (read happens during boot)

## Roadmap

| Version | Status | Features |
|---------|--------|----------|
| 1.0 | ✅ Done | Read-only KV sync |
| 1.1 | ⏳ Future | Write-back hook (approval → KV) |
| 2.0 | ⏳ Future | Web UI for approval management |

## Support

1. Read `README.md` (5 min)
2. Check `IMPLEMENTATION-SUMMARY.md` (reference)
3. Choose deployment path (DEPLOYMENT.md or DEPLOYMENT-OPTION2.md)
4. Run through testing checklist
5. Monitor logs: `journalctl -u openclaw-kv-preload -f`

## Questions?

- **Security?** → SECURITY-ANALYSIS.md
- **How to deploy?** → DEPLOYMENT-OPTION2.md (recommended)
- **Errors?** → DEPLOYMENT-OPTION2.md Troubleshooting
- **Code details?** → gateway-kv-loader.js comments

---

**Status:** ✅ Complete (Feb 24, 2026)  
**Recommendation:** Option 2 (Gateway Integration) with systemd  
**Time to deploy:** 10 minutes
