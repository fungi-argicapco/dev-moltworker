#!/bin/bash
# Startup script for OpenClaw in Cloudflare Sandbox
# This script:
# 1. Runs openclaw onboard --non-interactive to configure from env vars
# 2. Patches config for features onboard doesn't cover (channels, gateway auth)
# 3. Starts the gateway
#
# NOTE: R2 backup/restore is handled by the Worker via its R2 binding.
# The Worker restores data before starting this script and backs up via the admin UI.

set -e

if pgrep -f "openclaw gateway" > /dev/null 2>&1; then
    echo "OpenClaw gateway is already running, exiting."
    exit 0
fi

CONFIG_DIR="/root/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"
WORKSPACE_DIR="/root/clawd"
SKILLS_DIR="/root/clawd/skills"
LAST_SYNC_FILE="/tmp/.last-sync"

echo "Config directory: $CONFIG_DIR"

mkdir -p "$CONFIG_DIR"

# NOTE: R2 restore is now handled by the Worker (process.ts → restoreFromR2)
# before this script is invoked. No rclone needed.

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

// When behind CF Access (token auth configured), disable device identity checks.
// CF Access handles identity; device pairing is redundant for the Control UI.
// Note: allowInsecureAuth only affects HTTP context, NOT device identity.
// dangerouslyDisableDeviceAuth fully disables device key validation and pairing.
// Channel auth (Telegram/Discord/Slack) is unaffected — they use dmPolicy separately.
if (process.env.OPENCLAW_GATEWAY_TOKEN) {
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.allowInsecureAuth = true;
    config.gateway.controlUi.dangerouslyDisableDeviceAuth = true;
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
        // Read separate CF gateway auth token (for authenticated gateways)
        const gwAuthToken = process.env.CF_AI_GATEWAY_AUTH_TOKEN;

        const providerConfig = {
            baseUrl: baseUrl,
            apiKey: apiKey,
            api: 'anthropic-messages',
            models: [
                { id: modelId, name: modelId, contextWindow: 200000, maxTokens: 8192 },
                { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 8192 },
            ],
        };

        // Per docs: if gateway auth is enabled, add cf-aig-authorization header
        // (in addition to the provider API key)
        if (gwAuthToken) {
            providerConfig.headers = {
                'cf-aig-authorization': 'Bearer ' + gwAuthToken,
            };
            console.log('AI Gateway: authenticated gateway enabled');
        }

        config.models = config.models || {};
        config.models.providers = config.models.providers || {};
        config.models.providers[providerName] = providerConfig;
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

// CRITICAL: Override workspace path to /root/clawd where SOUL.md, AGENTS.md,
// skills, and agents are baked in via Dockerfile. OpenClaw defaults to
// ~/.openclaw/workspace which is empty in a container.
config.agents.defaults.workspace = '/root/clawd';
console.log('Workspace: /root/clawd (overridden from default)');

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
// MULTI-AGENT: Omega as default orchestrator (Hardshell Phase 2C)
// Architecture: agents.list[] defines agents, bindings[] routes
// messages. This is forward-compatible with multi-tenant clients.
// To add a client agent later, push to agents.list + bindings
// and add their Telegram bot under channels.telegram.accounts.
//
// NOTE: agents.list and bindings are NOT YET supported by the
// currently installed OpenClaw version. Kept as commented-out
// reference for when the schema is extended.
// ============================================================
// FUTURE: Uncomment when OpenClaw supports multi-agent schema
// config.agents.list = config.agents.list || [];
// const omegaIdx = config.agents.list.findIndex(a => a.id === 'omega');
// if (omegaIdx === -1) {
//     config.agents.list.push({
//         id: 'omega',
//         workspace: '/root/clawd',
//         default: true,
//         sandbox: { mode: 'off' },
//     });
// }
// config.bindings = config.bindings || [];
// if (!config.bindings.some(b => b.agentId === 'omega')) {
//     config.bindings.push({
//         agentId: 'omega',
//         match: { channel: 'telegram', accountId: 'default' },
//     });
// }
console.log('Multi-agent: Omega workspace configured (skills + SOUL.md)');

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
// Uses flat format compatible with current OpenClaw version.
// HARDSHELL_TELEGRAM_BOT_TOKEN = Omega's dedicated bot (HardshellStagingBot)
// TELEGRAM_BOT_TOKEN = fallback for single-agent / dev mode
//
// FUTURE (multi-agent): When OpenClaw supports channels.telegram.accounts,
// switch to: config.channels.telegram = { accounts: { default: {...}, 'client-acme': {...} } }
// and add bindings[] to route each account to its agent.
const tgBotToken = process.env.HARDSHELL_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (tgBotToken) {
    const dmPolicy = process.env.TELEGRAM_DM_POLICY || 'allowlist';
    const groupPolicy = process.env.TELEGRAM_GROUP_POLICY || 'disabled';

    // Build DM allowlist
    let allowFrom;
    if (process.env.TELEGRAM_DM_ALLOW_FROM) {
        allowFrom = process.env.TELEGRAM_DM_ALLOW_FROM.split(',');
    } else if (dmPolicy === 'allowlist') {
        allowFrom = ['8476535456']; // Default owner: Joshua's Telegram ID
    } else if (dmPolicy === 'open') {
        allowFrom = ['*'];
    }

    // Flat format (current OpenClaw)
    config.channels.telegram = {
        botToken: tgBotToken,
        dmPolicy: dmPolicy,
        linkPreview: process.env.TELEGRAM_LINK_PREVIEW !== 'false',
        mediaMaxMb: parseInt(process.env.TELEGRAM_MEDIA_MAX_MB || '50', 10),
        historyLimit: parseInt(process.env.TELEGRAM_HISTORY_LIMIT || '100', 10),
    };
    if (allowFrom) config.channels.telegram.allowFrom = allowFrom;
    if (groupPolicy && groupPolicy !== 'disabled') {
        config.channels.telegram.groupPolicy = groupPolicy;
    }
    if (process.env.TELEGRAM_GROUP_ALLOW_FROM) {
        config.channels.telegram.groupAllowFrom = process.env.TELEGRAM_GROUP_ALLOW_FROM.split(',');
    }
    console.log('Telegram config: dmPolicy=' + dmPolicy + ' allowFrom=' + JSON.stringify(allowFrom));
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
# WORKSPACE: Copy baked-in files to OpenClaw's default workspace
# OpenClaw reads from ~/.openclaw/workspace/ by default.
# Our files are baked into /root/clawd/ via Dockerfile.
# Strategy: Copy ALL .md files from baked workspace to default
# workspace so the agent finds them automatically on session start.
# For multi-tenant: each client gets their own workspace dir with
# their own set of these files (IDENTITY.md, SOUL.md, USER.md, etc.)
# ============================================================
OC_WORKSPACE="/root/.openclaw/workspace"
mkdir -p "$OC_WORKSPACE"
mkdir -p "$OC_WORKSPACE/skills"
mkdir -p "$OC_WORKSPACE/memory"

# Copy ALL workspace .md files from baked-in dir to default workspace
WORKSPACE_FILES_COPIED=0
for md_file in "$WORKSPACE_DIR"/*.md; do
    if [ -f "$md_file" ]; then
        fname=$(basename "$md_file")
        cp "$md_file" "$OC_WORKSPACE/$fname"
        WORKSPACE_FILES_COPIED=$((WORKSPACE_FILES_COPIED + 1))
    fi
done
echo "Workspace: copied $WORKSPACE_FILES_COPIED files to $OC_WORKSPACE"

# Also ensure SOUL.md is in the workspace (may be at root level, not in workspace/)
if [ -f "$WORKSPACE_DIR/SOUL.md" ]; then
    echo "  SOUL.md: $(wc -l < $OC_WORKSPACE/SOUL.md) lines"
elif [ -f "/root/clawd/SOUL.md" ] && [ ! -f "$OC_WORKSPACE/SOUL.md" ]; then
    cp "/root/clawd/SOUL.md" "$OC_WORKSPACE/SOUL.md"
    echo "  SOUL.md: copied from /root/clawd/ (fallback)"
fi

if [ ! -f "$OC_WORKSPACE/SOUL.md" ]; then
    echo "  SOUL.md: WARNING — not found! Creating minimal fallback"
    cat > "$OC_WORKSPACE/SOUL.md" << 'EOFSOUL'
# SOUL.md — Omega (Fallback)
You are Omega, the master orchestrator for Stream Kinetics.
Be helpful, accurate, and efficient. Minimize token usage.
EOFSOUL
fi

# ============================================================
# SKILLS: Symlink agent skills into BOTH workspace directories
# Each agent directory with a SKILL.md becomes a loadable skill.
# This is idempotent — existing symlinks are preserved.
# For multi-tenant: client agents get their own workspace with
# a subset of skills. Omega gets all 12.
# ============================================================
AGENTS_SRC="$WORKSPACE_DIR/agents"
if [ -d "$AGENTS_SRC" ]; then
    for agent_dir in "$AGENTS_SRC"/*/; do
        skill_name=$(basename "$agent_dir")
        if [ -f "$agent_dir/SKILL.md" ]; then
            # Link into baked skills dir
            if [ ! -e "$SKILLS_DIR/$skill_name" ]; then
                ln -s "$agent_dir" "$SKILLS_DIR/$skill_name"
                echo "Skill linked: $skill_name → $SKILLS_DIR/"
            fi
            # Also link into default workspace skills dir
            if [ ! -e "$OC_WORKSPACE/skills/$skill_name" ]; then
                ln -s "$agent_dir" "$OC_WORKSPACE/skills/$skill_name"
                echo "Skill linked: $skill_name → $OC_WORKSPACE/skills/"
            fi
        fi
    done
    echo "Skills: $(ls -1 $SKILLS_DIR | wc -l) skills available"
else
    echo "Skills: no agents directory found at $AGENTS_SRC"
fi

# NOTE: Background R2 sync is now handled by the Worker via its R2 binding.
# Use the admin UI "Backup Now" button to trigger manual backups.



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
