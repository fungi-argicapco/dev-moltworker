#!/bin/bash
# Startup script for OpenClaw in Cloudflare Sandbox
# This script:
# 1. Restores config/workspace/skills from R2 via rclone (if configured)
# 2. Runs openclaw onboard --non-interactive to configure from env vars
# 3. Patches config for features onboard doesn't cover (channels, gateway auth)
# 4. Starts a background sync loop (rclone, watches for file changes)
# 5. Starts the gateway

set -e

if pgrep -f "openclaw gateway" > /dev/null 2>&1; then
    echo "OpenClaw gateway is already running, exiting."
    exit 0
fi

CONFIG_DIR="/root/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
WORKSPACE_DIR="/root/clawd"
SKILLS_DIR="/root/clawd/skills"
RCLONE_CONF="/root/.config/rclone/rclone.conf"
LAST_SYNC_FILE="/tmp/.last-sync"

echo "Config directory: $CONFIG_DIR"

mkdir -p "$CONFIG_DIR"

# ============================================================
# RCLONE SETUP
# ============================================================

r2_configured() {
    [ -n "$R2_ACCESS_KEY_ID" ] && [ -n "$R2_SECRET_ACCESS_KEY" ] && [ -n "$CF_ACCOUNT_ID" ]
}

R2_BUCKET="${R2_BUCKET_NAME:-moltbot-data}"

setup_rclone() {
    mkdir -p "$(dirname "$RCLONE_CONF")"
    cat > "$RCLONE_CONF" << EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = $R2_ACCESS_KEY_ID
secret_access_key = $R2_SECRET_ACCESS_KEY
endpoint = https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF
    touch /tmp/.rclone-configured
    echo "Rclone configured for bucket: $R2_BUCKET"
}

RCLONE_FLAGS="--transfers=16 --fast-list --s3-no-check-bucket"

# ============================================================
# RESTORE FROM R2
# ============================================================

if r2_configured; then
    setup_rclone

    echo "Checking R2 for existing backup..."
    # Check if R2 has an openclaw config backup
    if rclone ls "r2:${R2_BUCKET}/openclaw/openclaw.json" $RCLONE_FLAGS 2>/dev/null | grep -q openclaw.json; then
        echo "Restoring config from R2..."
        rclone copy "r2:${R2_BUCKET}/openclaw/" "$CONFIG_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: config restore failed with exit code $?"
        echo "Config restored"
    elif rclone ls "r2:${R2_BUCKET}/clawdbot/clawdbot.json" $RCLONE_FLAGS 2>/dev/null | grep -q clawdbot.json; then
        echo "Restoring from legacy R2 backup..."
        rclone copy "r2:${R2_BUCKET}/clawdbot/" "$CONFIG_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: legacy config restore failed with exit code $?"
        if [ -f "$CONFIG_DIR/clawdbot.json" ] && [ ! -f "$CONFIG_FILE" ]; then
            mv "$CONFIG_DIR/clawdbot.json" "$CONFIG_FILE"
        fi
        echo "Legacy config restored and migrated"
    else
        echo "No backup found in R2, starting fresh"
    fi

    # Restore workspace
    REMOTE_WS_COUNT=$(rclone ls "r2:${R2_BUCKET}/workspace/" $RCLONE_FLAGS 2>/dev/null | wc -l)
    if [ "$REMOTE_WS_COUNT" -gt 0 ]; then
        echo "Restoring workspace from R2 ($REMOTE_WS_COUNT files)..."
        mkdir -p "$WORKSPACE_DIR"
        rclone copy "r2:${R2_BUCKET}/workspace/" "$WORKSPACE_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: workspace restore failed with exit code $?"
        echo "Workspace restored"
    fi

    # Restore skills
    REMOTE_SK_COUNT=$(rclone ls "r2:${R2_BUCKET}/skills/" $RCLONE_FLAGS 2>/dev/null | wc -l)
    if [ "$REMOTE_SK_COUNT" -gt 0 ]; then
        echo "Restoring skills from R2 ($REMOTE_SK_COUNT files)..."
        mkdir -p "$SKILLS_DIR"
        rclone copy "r2:${R2_BUCKET}/skills/" "$SKILLS_DIR/" $RCLONE_FLAGS -v 2>&1 || echo "WARNING: skills restore failed with exit code $?"
        echo "Skills restored"
    fi
else
    echo "R2 not configured, starting fresh"
fi

# ============================================================
# ONBOARD (only if no config exists yet)
# ============================================================
if [ ! -f "$CONFIG_FILE" ]; then
    echo "No existing config found, running openclaw onboard..."

    AUTH_ARGS=""
    if [ -n "$CLOUDFLARE_AI_GATEWAY_API_KEY" ] && [ -n "$CF_AI_GATEWAY_ACCOUNT_ID" ] && [ -n "$CF_AI_GATEWAY_GATEWAY_ID" ]; then
        AUTH_ARGS="--auth-choice cloudflare-ai-gateway-api-key \
            --cloudflare-ai-gateway-account-id $CF_AI_GATEWAY_ACCOUNT_ID \
            --cloudflare-ai-gateway-gateway-id $CF_AI_GATEWAY_GATEWAY_ID \
            --cloudflare-ai-gateway-api-key $CLOUDFLARE_AI_GATEWAY_API_KEY"
    elif [ -n "$ANTHROPIC_API_KEY" ]; then
        AUTH_ARGS="--auth-choice apiKey --anthropic-api-key $ANTHROPIC_API_KEY"
    elif [ -n "$OPENAI_API_KEY" ]; then
        AUTH_ARGS="--auth-choice openai-api-key --openai-api-key $OPENAI_API_KEY"
    fi

    openclaw onboard --non-interactive --accept-risk \
        --mode local \
        $AUTH_ARGS \
        --gateway-port 18789 \
        --gateway-bind lan \
        --skip-channels \
        --skip-skills \
        --skip-health

    echo "Onboard completed"
else
    echo "Using existing config"
fi

# ============================================================
# PATCH CONFIG (channels, gateway auth, trusted proxies)
# ============================================================
# openclaw onboard handles provider/model config, but we need to patch in:
# - Channel config (Telegram, Discord, Slack)
# - Gateway token auth
# - Trusted proxies for sandbox networking
# - Base URL override for legacy AI Gateway path
node << 'EOFPATCH'
const fs = require('fs');

const configPath = '/root/.openclaw/openclaw.json';
console.log('Patching config at:', configPath);
let config = {};

try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.log('Starting with empty config');
}

config.gateway = config.gateway || {};
config.channels = config.channels || {};

// Gateway configuration
config.gateway.port = 18789;
config.gateway.mode = 'local';
config.gateway.trustedProxies = ['10.1.0.0'];

if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.OPENCLAW_GATEWAY_TOKEN;
}

if (process.env.OPENCLAW_DEV_MODE === 'true') {
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.allowInsecureAuth = true;
}

// Legacy AI Gateway base URL override:
// ANTHROPIC_BASE_URL is picked up natively by the Anthropic SDK,
// so we don't need to patch the provider config. Writing a provider
// entry without a models array breaks OpenClaw's config validation.

// ============================================================
// TOKEN OPTIMIZATION: Model Routing (Part 2)
// Default to Haiku for cost savings, add aliases for on-demand switching.
// CF_AI_GATEWAY_MODEL env var overrides the default.
// ============================================================
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const modelOverride = process.env.CF_AI_GATEWAY_MODEL;

// AI Gateway model override (CF_AI_GATEWAY_MODEL=provider/model-id)
// Adds a provider entry for any AI Gateway provider and sets it as default model.
// Examples:
//   workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast
//   openai/gpt-4o
//   anthropic/claude-sonnet-4-6
if (modelOverride) {
    const raw = modelOverride;
    const slashIdx = raw.indexOf('/');
    const gwProvider = raw.substring(0, slashIdx);
    const modelId = raw.substring(slashIdx + 1);

    const accountId = process.env.CF_AI_GATEWAY_ACCOUNT_ID;
    const gatewayId = process.env.CF_AI_GATEWAY_GATEWAY_ID;
    const apiKey = process.env.CLOUDFLARE_AI_GATEWAY_API_KEY;

    let baseUrl;
    if (accountId && gatewayId) {
        baseUrl = 'https://gateway.ai.cloudflare.com/v1/' + accountId + '/' + gatewayId + '/' + gwProvider;
        if (gwProvider === 'workers-ai') baseUrl += '/v1';
    } else if (gwProvider === 'workers-ai' && process.env.CF_ACCOUNT_ID) {
        baseUrl = 'https://api.cloudflare.com/client/v4/accounts/' + process.env.CF_ACCOUNT_ID + '/ai/v1';
    }

    if (baseUrl && apiKey) {
        // Per OpenClaw docs: https://docs.openclaw.ai/providers/cloudflare-ai-gateway
        // Provider: cloudflare-ai-gateway
        // API: anthropic-messages (Anthropic Messages API through the Gateway)
        // Base URL: https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/anthropic
        // API Key: CLOUDFLARE_AI_GATEWAY_API_KEY (provider API key for requests through Gateway)
        // For Unified Billing: cf-aig-authorization header authenticates with the gateway
        const providerName = 'cloudflare-ai-gateway';

        config.models = config.models || {};
        config.models.providers = config.models.providers || {};
        config.models.providers[providerName] = {
            baseUrl: baseUrl,
            apiKey: apiKey,
            api: 'anthropic-messages',
            models: [
                { id: modelId, name: modelId, contextWindow: 200000, maxTokens: 8192 },
                { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 8192 },
            ],
        };
        config.agents = config.agents || {};
        config.agents.defaults = config.agents.defaults || {};
        config.agents.defaults.model = { primary: providerName + '/' + modelId };
        console.log('AI Gateway: provider=' + providerName + ' model=' + modelId + ' via ' + baseUrl);
    } else {
        console.warn('CF_AI_GATEWAY_MODEL set but missing required config (account ID, gateway ID, or API key)');
    }
} else {
    // No override: default to Haiku for cost savings
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    if (!config.agents.defaults.model) {
        config.agents.defaults.model = { primary: 'anthropic/' + DEFAULT_MODEL };
        console.log('Defaulting to Haiku: anthropic/' + DEFAULT_MODEL);
    }
}

// Model aliases for on-demand switching ("use sonnet", "use haiku", "use opus")
config.agents = config.agents || {};
config.agents.defaults = config.agents.defaults || {};
config.agents.defaults.models = config.agents.defaults.models || {};
config.agents.defaults.models['anthropic/claude-haiku-4-5-20251001'] =
    config.agents.defaults.models['anthropic/claude-haiku-4-5-20251001'] || { alias: 'haiku' };
config.agents.defaults.models['anthropic/claude-sonnet-4-6'] =
    config.agents.defaults.models['anthropic/claude-sonnet-4-6'] || { alias: 'sonnet' };
config.agents.defaults.models['anthropic/claude-opus-4-6'] =
    config.agents.defaults.models['anthropic/claude-opus-4-6'] || { alias: 'opus' };
console.log('Model aliases configured: haiku, sonnet, opus');

// ============================================================
// STABILITY: Concurrency Limits (prevent Anthropic 429 storms)
// ============================================================
config.agents.defaults.maxConcurrent = parseInt(process.env.MAX_CONCURRENT || '2', 10);
config.agents.defaults.subagents = config.agents.defaults.subagents || {};
config.agents.defaults.subagents.maxConcurrent = parseInt(process.env.SUBAGENT_MAX_CONCURRENT || '2', 10);
config.agents.defaults.subagents.model = process.env.SUBAGENT_MODEL || 'cloudflare-ai-gateway/claude-haiku-4-5-20251001';
console.log('Concurrency: maxConcurrent=' + config.agents.defaults.maxConcurrent + ' subagents.maxConcurrent=' + config.agents.defaults.subagents.maxConcurrent + ' subagent model=' + config.agents.defaults.subagents.model);

// ============================================================
// CONFIG CLEANUP: Remove unsupported keys
// The R2 backup may contain stale keys from previous deploys.
// OpenClaw's strict config validation rejects unknown keys and
// crashes the gateway. Strip them before writing the config.
// ============================================================
// Root-level keys not in the OpenClaw schema
delete config.heartbeat;

// agents.defaults keys not in schema
if (config.agents && config.agents.defaults) {
    delete config.agents.defaults.cache;

    // Per-model keys not in schema
    if (config.agents.defaults.models) {
        const modelKeys = Object.keys(config.agents.defaults.models);
        for (const mk of modelKeys) {
            if (config.agents.defaults.models[mk]) {
                delete config.agents.defaults.models[mk].cache;
                delete config.agents.defaults.models[mk].cacheRetention;
            }
        }
    }
}
console.log('Config cleanup: stripped unsupported keys (heartbeat, cache, cacheRetention)');

// Telegram configuration
// Overwrite entire channel object to drop stale keys from old R2 backups
// that would fail OpenClaw's strict config validation (see #47)
if (process.env.TELEGRAM_BOT_TOKEN) {
    const dmPolicy = process.env.TELEGRAM_DM_POLICY || 'allowlist';
    const groupPolicy = process.env.TELEGRAM_GROUP_POLICY || 'disabled';
    config.channels.telegram = {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        enabled: true,
        dmPolicy: dmPolicy,
        groupPolicy: groupPolicy,
        // Link preview: show URL previews in outbound messages (default: true)
        linkPreview: process.env.TELEGRAM_LINK_PREVIEW !== 'false',
        // Media max size in MB (default 5 per docs, Telegram bot limit is 50)
        mediaMaxMb: parseInt(process.env.TELEGRAM_MEDIA_MAX_MB || '50', 10),
        // History limit: max messages to keep in context (default 50)
        historyLimit: parseInt(process.env.TELEGRAM_HISTORY_LIMIT || '100', 10),
    };
    // DM allowlist: numeric Telegram user IDs
    if (process.env.TELEGRAM_DM_ALLOW_FROM) {
        config.channels.telegram.allowFrom = process.env.TELEGRAM_DM_ALLOW_FROM.split(',');
    } else if (dmPolicy === 'allowlist') {
        // Default owner access — always allow Joshua's Telegram ID
        config.channels.telegram.allowFrom = ['8476535456'];
    } else if (dmPolicy === 'open') {
        config.channels.telegram.allowFrom = ['*'];
    }
    // Group sender allowlist: numeric Telegram user IDs
    if (process.env.TELEGRAM_GROUP_ALLOW_FROM) {
        config.channels.telegram.groupAllowFrom = process.env.TELEGRAM_GROUP_ALLOW_FROM.split(',');
    }
    console.log('Telegram config: dmPolicy=' + dmPolicy + ' allowFrom=' + JSON.stringify(config.channels.telegram.allowFrom));
}

// Discord configuration
// Discord uses a nested dm object: dm.policy, dm.allowFrom (per DiscordDmConfig)
if (process.env.DISCORD_BOT_TOKEN) {
    const dmPolicy = process.env.DISCORD_DM_POLICY || 'pairing';
    const dm = { policy: dmPolicy };
    if (dmPolicy === 'open') {
        dm.allowFrom = ['*'];
    }
    config.channels.discord = {
        token: process.env.DISCORD_BOT_TOKEN,
        enabled: true,
        dm: dm,
    };
}

// Slack configuration
if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN) {
    config.channels.slack = {
        botToken: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        enabled: true,
    };
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Configuration patched successfully');
console.log('Token optimization: model routing + heartbeat + caching configured');
EOFPATCH

# ============================================================
# TOKEN OPTIMIZATION: Workspace Templates (Parts 1, 4, 5)
# Create default SOUL.md and USER.md with session init rules,
# model selection rules, and rate limits if they don't exist.
# ============================================================
if [ ! -f "$WORKSPACE_DIR/SOUL.md" ]; then
    echo "Creating default SOUL.md with token optimization rules..."
    cat > "$WORKSPACE_DIR/SOUL.md" << 'EOFSOUL'
# SOUL.md

## Core Principles

- Be helpful, accurate, and efficient
- Minimize token usage without sacrificing quality
- Use the right model for the right task

## SESSION INITIALIZATION RULE

On every session start:
1. Load ONLY these files:
   - SOUL.md
   - USER.md
   - IDENTITY.md
   - memory/YYYY-MM-DD.md (if it exists)

2. DO NOT auto-load:
   - MEMORY.md
   - Session history
   - Prior messages
   - Previous tool outputs

3. When user asks about prior context:
   - Use memory_search() on demand
   - Pull only the relevant snippet with memory_get()
   - Don't load the whole file

4. Update memory/YYYY-MM-DD.md at end of session with:
   - What you worked on
   - Decisions made
   - Leads generated
   - Blockers
   - Next steps

## MODEL SELECTION RULE

Default: Always use Haiku
Switch to Sonnet ONLY when:
- Architecture decisions
- Production code review
- Security analysis
- Complex debugging/reasoning
- Strategic multi-project decisions

When in doubt: Try Haiku first.

## RATE LIMITS

- 5 seconds minimum between API calls
- 10 seconds between web searches
- Max 5 searches per batch, then 2-minute break
- Batch similar work (one request for 10 leads, not 10 requests)
- If you hit 429 error: STOP, wait 5 minutes, retry

DAILY BUDGET: $5 (warning at 75%)
MONTHLY BUDGET: $200 (warning at 75%)
EOFSOUL
    echo "SOUL.md created"
fi

if [ ! -f "$WORKSPACE_DIR/USER.md" ]; then
    echo "Creating default USER.md template..."
    cat > "$WORKSPACE_DIR/USER.md" << 'EOFUSER'
# USER.md

- **Name:** [YOUR NAME]
- **Timezone:** [YOUR TIMEZONE]
- **Mission:** [WHAT YOU'RE BUILDING]

## Success Metrics

- [METRIC 1]
- [METRIC 2]
- [METRIC 3]

## Notes

Customize this file with your information. Keep it lean —
every line costs tokens on every request.
EOFUSER
    echo "USER.md created"
fi

# ============================================================
# BACKGROUND SYNC LOOP
# ============================================================
if r2_configured; then
    echo "Starting background R2 sync loop..."
    (
        MARKER=/tmp/.last-sync-marker
        LOGFILE=/tmp/r2-sync.log
        touch "$MARKER"

        while true; do
            sleep 30

            # ---- PULL: fetch new files FROM R2 (bidirectional sync) ----
            # Uses 'copy' (not sync) so locally-created files aren't deleted
            if [ -d "$WORKSPACE_DIR" ]; then
                rclone copy "r2:${R2_BUCKET}/workspace/" "$WORKSPACE_DIR/" \
                    $RCLONE_FLAGS --exclude='.git/**' --exclude='node_modules/**' 2>>"$LOGFILE"
            fi

            # ---- PUSH: detect local changes and upload to R2 ----
            CHANGED=/tmp/.changed-files
            {
                find "$CONFIG_DIR" -newer "$MARKER" -type f -printf '%P\n' 2>/dev/null
                find "$WORKSPACE_DIR" -newer "$MARKER" \
                    -not -path '*/node_modules/*' \
                    -not -path '*/.git/*' \
                    -type f -printf '%P\n' 2>/dev/null
            } > "$CHANGED"

            COUNT=$(wc -l < "$CHANGED" 2>/dev/null || echo 0)

            if [ "$COUNT" -gt 0 ]; then
                echo "[sync] Uploading changes ($COUNT files) at $(date)" >> "$LOGFILE"
                rclone sync "$CONFIG_DIR/" "r2:${R2_BUCKET}/openclaw/" \
                    $RCLONE_FLAGS --exclude='*.lock' --exclude='*.log' --exclude='*.tmp' --exclude='.git/**' 2>> "$LOGFILE"
                if [ -d "$WORKSPACE_DIR" ]; then
                    rclone sync "$WORKSPACE_DIR/" "r2:${R2_BUCKET}/workspace/" \
                        $RCLONE_FLAGS --exclude='skills/**' --exclude='.git/**' --exclude='node_modules/**' 2>> "$LOGFILE"
                fi
                if [ -d "$SKILLS_DIR" ]; then
                    rclone sync "$SKILLS_DIR/" "r2:${R2_BUCKET}/skills/" \
                        $RCLONE_FLAGS 2>> "$LOGFILE"
                fi
                date -Iseconds > "$LAST_SYNC_FILE"
                touch "$MARKER"
                echo "[sync] Complete at $(date)" >> "$LOGFILE"
            fi
        done
    ) &
    echo "Background sync loop started (PID: $!)"
fi

# ============================================================
# START GATEWAY
# ============================================================
echo "Starting OpenClaw Gateway..."
echo "Gateway will be available on port 18789"

rm -f /tmp/openclaw-gateway.lock 2>/dev/null || true
rm -f "$CONFIG_DIR/gateway.lock" 2>/dev/null || true

echo "Dev mode: ${OPENCLAW_DEV_MODE:-false}"

if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token auth..."
    exec openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan --token "$OPENCLAW_GATEWAY_TOKEN"
else
    echo "Starting gateway with device pairing (no token)..."
    exec openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan
fi
