#!/bin/bash
set -e

# setup.sh - Interactive setup for Telegram KV pairing integration
# 
# This script:
# 1. Validates Cloudflare credentials
# 2. Creates KV namespace if needed
# 3. Sets up environment file
# 4. Tests sync script
# 5. (Optional) Creates systemd service for auto-sync

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
TEMPLATE_FILE="$SCRIPT_DIR/.env.example"

set -u

echo "╔════════════════════════════════════════════════════════════════════════════════╗"
echo "║  Telegram KV Pairing Integration Setup                                        ║"
echo "╚════════════════════════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================================
# Check existing .env
# ============================================================================

if [ -f "$ENV_FILE" ]; then
  echo "✅ Found existing .env"
  read -p "   Do you want to reconfigure? (y/n): " -r RECONFIGURE
  if [[ ! $RECONFIGURE =~ ^[Yy]$ ]]; then
    echo "   Skipping setup. Use: node sync-kv-pairing.js --verbose"
    exit 0
  fi
fi

# ============================================================================
# Prompt for Cloudflare credentials
# ============================================================================

echo ""
echo "📋 Step 1: Cloudflare Credentials"
echo "   Get from: https://dash.cloudflare.com/?to=/:account/profile/api-tokens"
echo ""

# Account ID
default_account="${CLOUDFLARE_ACCOUNT_ID:-}"
read -p "   Cloudflare Account ID [${default_account}]: " -r CF_ACCOUNT_ID
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-$default_account}"

if [ -z "$CF_ACCOUNT_ID" ]; then
  echo "❌ Account ID required"
  exit 1
fi

# API Token
read -sp "   Cloudflare API Token: " -r CF_API_TOKEN
echo ""

if [ -z "$CF_API_TOKEN" ]; then
  echo "❌ API Token required"
  exit 1
fi

# ============================================================================
# Test Cloudflare API connection
# ============================================================================

echo ""
echo "🔗 Step 2: Testing Cloudflare API..."

if curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | grep -q '"success":true'; then
  echo "   ✅ API connection successful"
else
  echo "   ❌ API connection failed. Check credentials."
  exit 1
fi

# ============================================================================
# List or create KV namespace
# ============================================================================

echo ""
echo "📦 Step 3: KV Namespace"

NS_RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json")

NS_ID=$(echo "$NS_RESPONSE" | grep -o '"id":"[^"]*"' | grep -o '[^"]*"$' | tr -d '"' | head -1)

if [ -z "$NS_ID" ]; then
  echo "   ⚠️  No KV namespaces found. Create one?"
  read -p "      Enter namespace name [telegram-pairing]: " -r NS_NAME
  NS_NAME="${NS_NAME:-telegram-pairing}"
  
  echo "   Creating namespace: $NS_NAME..."
  CREATE_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$NS_NAME\"}")
  
  NS_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
  if [ -z "$NS_ID" ]; then
    echo "   ❌ Failed to create namespace"
    echo "$CREATE_RESPONSE" | jq . 2>/dev/null || echo "$CREATE_RESPONSE"
    exit 1
  fi
fi

echo "   ✅ KV Namespace ID: $NS_ID"

# ============================================================================
# Create .env file
# ============================================================================

echo ""
echo "⚙️  Step 4: Creating .env file..."

cat > "$ENV_FILE" << EOF
# Cloudflare Account & API Token
# Get from: https://dash.cloudflare.com/?to=/:account/profile/api-tokens
CLOUDFLARE_ACCOUNT_ID=$CF_ACCOUNT_ID
CLOUDFLARE_API_TOKEN=$CF_API_TOKEN

# OpenClaw Config Path (optional, auto-detected if not set)
OPENCLAW_CONFIG=/root/.openclaw/openclaw.json

# KV Namespace ID
TELEGRAM_KV_NAMESPACE_ID=$NS_ID
EOF

echo "   ✅ Wrote $ENV_FILE"
chmod 600 "$ENV_FILE"

# ============================================================================
# Test sync script
# ============================================================================

echo ""
echo "🧪 Step 5: Testing sync script..."

source "$ENV_FILE"
if node "$SCRIPT_DIR/sync-kv-pairing.js" --verbose --dry-run; then
  echo "   ✅ Sync script works!"
else
  echo "   ⚠️  Sync script failed. Check credentials or config path."
fi

# ============================================================================
# Offer systemd setup
# ============================================================================

echo ""
echo "🚀 Step 6: Auto-sync on reboot?"
read -p "   Create systemd service? (y/n): " -r CREATE_SYSTEMD

if [[ $CREATE_SYSTEMD =~ ^[Yy]$ ]]; then
  SYSTEMD_FILE="/etc/systemd/system/openclaw-sync-pairing.service"
  
  if [ -f "$SYSTEMD_FILE" ]; then
    echo "   ⚠️  $SYSTEMD_FILE already exists. Skipping."
  else
    sudo tee "$SYSTEMD_FILE" > /dev/null << 'EOSYSTEMD'
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
EOSYSTEMD
    
    sudo systemctl daemon-reload
    sudo systemctl enable openclaw-sync-pairing.service
    echo "   ✅ Created and enabled $SYSTEMD_FILE"
    echo "   ℹ️  Will run before openclaw.service on every boot"
  fi
fi

# ============================================================================
# Final instructions
# ============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════════╗"
echo "║  ✅ Setup Complete!                                                            ║"
echo "╚════════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. Manually sync now:"
echo "     source $ENV_FILE"
echo "     node $SCRIPT_DIR/sync-kv-pairing.js --verbose"
echo ""
echo "  2. Test Telegram pairing (restart gateway, approve a user)"
echo ""
echo "  3. Verify persistence (restart gateway, user should still be approved)"
echo ""
echo "  4. Monitor:"
echo "     journalctl -u openclaw-sync-pairing -f"
echo "     journalctl -u openclaw -f"
echo ""
echo "Reference: $SCRIPT_DIR/README.md"
echo ""
