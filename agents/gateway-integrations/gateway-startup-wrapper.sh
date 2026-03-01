#!/bin/bash
set -e

# gateway-startup-wrapper.sh
#
# Wraps `openclaw gateway start` to load Telegram pairing from KV before startup.
#
# Usage:
#   bash gateway-startup-wrapper.sh
#   # or
#   bash gateway-startup-wrapper.sh --verbose
#
# Setup:
#   1. Create alias in ~/.bashrc:
#      alias ocstart='bash /path/to/gateway-startup-wrapper.sh'
#   2. Use: ocstart
#
# Or use as systemd ExecStartPre hook (see DEPLOYMENT.md)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
LOADER_SCRIPT="$SCRIPT_DIR/gateway-kv-loader.js"

set -u

# ============================================================================
# Load environment
# ============================================================================

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
  echo "[gateway-startup-wrapper] Loaded credentials from $ENV_FILE"
else
  echo "[gateway-startup-wrapper] ⚠️  No .env file found at $ENV_FILE"
  echo "[gateway-startup-wrapper] Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN manually:"
  echo "  export CLOUDFLARE_ACCOUNT_ID='...'"
  echo "  export CLOUDFLARE_API_TOKEN='...'"
fi

# ============================================================================
# Load KV pairing
# ============================================================================

echo "[gateway-startup-wrapper] Loading Telegram pairing from Cloudflare KV..."

VERBOSE_FLAG=""
if [[ "${1:-}" == "--verbose" || "${1:-}" == "-v" ]]; then
  VERBOSE_FLAG="--verbose"
fi

if node "$LOADER_SCRIPT" --apply $VERBOSE_FLAG; then
  echo "[gateway-startup-wrapper] ✅ Telegram pairing synced"
else
  echo "[gateway-startup-wrapper] ⚠️  Failed to sync pairing, continuing anyway..."
fi

# ============================================================================
# Start gateway
# ============================================================================

echo "[gateway-startup-wrapper] Starting OpenClaw gateway..."
exec openclaw gateway start
