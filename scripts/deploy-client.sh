#!/bin/bash
# Deploy a client agent to the Hardshell platform.
#
# Usage:
#   ./scripts/deploy-client.sh <client-slug>
#
# Example:
#   ./scripts/deploy-client.sh lowe-neuropsych
#
# Prerequisites:
#   - platform/client-configs/<client-slug>.jsonc exists
#   - clients/<client-slug>/ workspace exists
#   - R2 bucket provisioned
#   - AI Gateway provisioned
#   - Dispatch + outbound workers deployed
#
# This script:
#   1. Syncs workspace files to R2
#   2. Deploys user worker into dispatch namespace
#   3. Prompts for secrets

set -e

CLIENT_SLUG="${1:?Usage: $0 <client-slug>}"
ACCOUNT_ID="a9c661749d16228083b6047aa1e8a70e"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CLIENT_CONFIG="$REPO_ROOT/platform/client-configs/$CLIENT_SLUG.jsonc"
CLIENT_DIR="$REPO_ROOT/clients/$CLIENT_SLUG"

if [ ! -f "$CLIENT_CONFIG" ]; then
    echo "ERROR: Client config not found at $CLIENT_CONFIG"
    exit 1
fi

if [ ! -d "$CLIENT_DIR" ]; then
    echo "ERROR: Client workspace not found at $CLIENT_DIR"
    exit 1
fi

# Derive R2 bucket name from client config
BUCKET_NAME=$(grep -o '"bucket_name": *"[^"]*"' "$CLIENT_CONFIG" | head -1 | cut -d'"' -f4)
if [ -z "$BUCKET_NAME" ]; then
    echo "ERROR: Could not determine R2 bucket name from $CLIENT_CONFIG"
    exit 1
fi

echo "╔══════════════════════════════════════════════╗"
echo "║  Hardshell Client Deployment                 ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Client: $CLIENT_SLUG"
echo "║  Config: $CLIENT_CONFIG"
echo "║  R2:     $BUCKET_NAME"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Step 1: Sync workspace to R2
echo "▸ Step 1: Syncing workspace files to R2..."
CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bash "$SCRIPT_DIR/sync-workspace-to-r2.sh" "$CLIENT_SLUG" "$BUCKET_NAME"
echo ""

# Step 2: Deploy user worker to dispatch namespace
echo "▸ Step 2: Deploying user worker to dispatch namespace..."
CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bunx wrangler deploy \
    --config "$CLIENT_CONFIG" \
    --dispatch-namespace hardshell-prod \
    2>&1
echo ""

# Step 3: Remind about secrets
echo "▸ Step 3: Set secrets (if not already done):"
echo ""
echo "  CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bunx wrangler secret put AGENT_MODE --config $CLIENT_CONFIG"
echo "  CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bunx wrangler secret put CLIENT_NAME --config $CLIENT_CONFIG"
echo "  CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bunx wrangler secret put MOLTBOT_GATEWAY_TOKEN --config $CLIENT_CONFIG"
echo "  CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bunx wrangler secret put CLOUDFLARE_AI_GATEWAY_API_KEY --config $CLIENT_CONFIG"
echo "  CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bunx wrangler secret put CF_AI_GATEWAY_ACCOUNT_ID --config $CLIENT_CONFIG"
echo "  CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bunx wrangler secret put CF_AI_GATEWAY_GATEWAY_ID --config $CLIENT_CONFIG"
echo "  CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID bunx wrangler secret put TELEGRAM_BOT_TOKEN --config $CLIENT_CONFIG"
echo ""
echo "✅ Deployment complete for: $CLIENT_SLUG"
