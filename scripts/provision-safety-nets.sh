#!/usr/bin/env bash
# provision-safety-nets.sh — Deterministic safety net provisioning for Hardshell
#
# Configures AI Gateway, Logpush, and Alerting via Cloudflare API.
# Idempotent: safe to run repeatedly. Uses PUT/create-or-update patterns.
#
# Usage:
#   CLOUDFLARE_API_TOKEN=<token> ./scripts/provision-safety-nets.sh [--env stg|prod]
#
# Required permissions on the API token:
#   - AI Gateway: Read + Edit
#   - Logs: Edit (Logpush)
#   - Notifications: Read + Write
#   - R2: Edit (bucket creation)

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────

ENV="${1:---env}"
ENV="${2:-stg}"  # Default to staging

if [[ "$1" == "--env" ]] && [[ -n "${2:-}" ]]; then
  ENV="$2"
elif [[ "$1" != "--env" ]]; then
  ENV="stg"
fi

ACCOUNT_ID="${CF_ACCOUNT_ID:-a9c661749d16228083b6047aa1e8a70e}"
API_TOKEN="${CLOUDFLARE_API_TOKEN:?Error: CLOUDFLARE_API_TOKEN is required}"
API_BASE="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}"

# Per-environment settings
case "$ENV" in
  stg)
    GATEWAY_ID="hardshell-stg-aigw"
    LOGS_BUCKET="hardshell-stg-logs"
    WORKER_NAME="hardshell-stg-gateway"
    RATE_LIMIT=100          # requests per interval
    RATE_INTERVAL=60        # seconds
    CACHE_TTL=60            # seconds
    ALERT_EMAIL="josh@streamkinetics.com"
    ;;
  prod)
    GATEWAY_ID="hardshell-prod-aigw"
    LOGS_BUCKET="hardshell-prod-logs"
    WORKER_NAME="hardshell-prod-gateway"
    RATE_LIMIT=500
    RATE_INTERVAL=60
    CACHE_TTL=60
    ALERT_EMAIL="josh@streamkinetics.com"
    ;;
  *)
    echo "Error: Unknown environment '${ENV}'. Use 'stg' or 'prod'."
    exit 1
    ;;
esac

# ─── Helpers ─────────────────────────────────────────────────────────────────

cf_api() {
  local method="$1" path="$2"
  shift 2
  local url="${API_BASE}${path}"
  local response
  response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" \
    -H "Authorization: Bearer ${API_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@")
  local http_code body
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [[ "$http_code" -ge 400 ]]; then
    echo "  ✗ API error (HTTP ${http_code}): $(echo "$body" | jq -r '.errors[0].message // "unknown"' 2>/dev/null || echo "$body")"
    return 1
  fi
  echo "$body"
}

section() {
  echo ""
  echo "━━━ $1 ━━━"
}

ok() { echo "  ✓ $1"; }
skip() { echo "  → $1 (already configured)"; }
info() { echo "  ℹ $1"; }

# ─── 1. AI Gateway Configuration ────────────────────────────────────────────

section "1. AI Gateway: ${GATEWAY_ID}"

# Check if gateway exists
gw_response=$(cf_api GET "/ai-gateway/gateways/${GATEWAY_ID}" 2>/dev/null || true)
gw_exists=$(echo "$gw_response" | jq -r '.success // false' 2>/dev/null || echo "false")

if [[ "$gw_exists" == "true" ]]; then
  info "Gateway exists, updating configuration..."
  update_result=$(cf_api PUT "/ai-gateway/gateways/${GATEWAY_ID}" \
    -d "{
      \"rate_limiting_interval\": ${RATE_INTERVAL},
      \"rate_limiting_limit\": ${RATE_LIMIT},
      \"rate_limiting_technique\": \"sliding\",
      \"cache_ttl\": ${CACHE_TTL},
      \"cache_invalidate_on_update\": true,
      \"collect_logs\": true,
      \"authentication\": true
    }")
  if echo "$update_result" | jq -e '.success' > /dev/null 2>&1; then
    ok "Rate limiting: ${RATE_LIMIT} req/${RATE_INTERVAL}s (sliding window)"
    ok "Cache TTL: ${CACHE_TTL}s (invalidate on update)"
    ok "Logging: enabled"
    ok "Authentication: enabled"
  fi
else
  info "Gateway not found, creating..."
  create_result=$(cf_api POST "/ai-gateway/gateways" \
    -d "{
      \"id\": \"${GATEWAY_ID}\",
      \"rate_limiting_interval\": ${RATE_INTERVAL},
      \"rate_limiting_limit\": ${RATE_LIMIT},
      \"rate_limiting_technique\": \"sliding\",
      \"cache_ttl\": ${CACHE_TTL},
      \"cache_invalidate_on_update\": true,
      \"collect_logs\": true,
      \"authentication\": true
    }")
  if echo "$create_result" | jq -e '.success' > /dev/null 2>&1; then
    ok "Created gateway ${GATEWAY_ID}"
  fi
fi

# ─── 2. R2 Logs Bucket ──────────────────────────────────────────────────────

section "2. R2 Logs Bucket: ${LOGS_BUCKET}"

bucket_check=$(cf_api GET "/r2/buckets/${LOGS_BUCKET}" 2>/dev/null || true)
bucket_exists=$(echo "$bucket_check" | jq -r '.success // false' 2>/dev/null || echo "false")

if [[ "$bucket_exists" == "true" ]]; then
  skip "Bucket ${LOGS_BUCKET} already exists"
else
  create_bucket=$(cf_api POST "/r2/buckets" \
    -d "{\"name\": \"${LOGS_BUCKET}\"}")
  if echo "$create_bucket" | jq -e '.success' > /dev/null 2>&1; then
    ok "Created R2 bucket: ${LOGS_BUCKET}"
  fi
fi

# ─── 3. Logpush Job: Workers Trace Events → R2 ──────────────────────────────

section "3. Logpush: Workers Trace Events → ${LOGS_BUCKET}"

# Check for existing logpush jobs targeting our bucket
existing_jobs=$(cf_api GET "/logpush/jobs" 2>/dev/null || echo '{"result":[]}')
job_exists=$(echo "$existing_jobs" | jq -r ".result[] | select(.destination_conf | contains(\"${LOGS_BUCKET}\")) | .id" 2>/dev/null || echo "")

if [[ -n "$job_exists" ]]; then
  skip "Logpush job already exists (ID: ${job_exists})"
else
  info "Logpush requires R2 API credentials for the destination."
  info "Create an R2 API token with Edit permissions for ${LOGS_BUCKET},"
  info "then set R2_LOGPUSH_ACCESS_KEY_ID and R2_LOGPUSH_SECRET_ACCESS_KEY."

  if [[ -n "${R2_LOGPUSH_ACCESS_KEY_ID:-}" ]] && [[ -n "${R2_LOGPUSH_SECRET_ACCESS_KEY:-}" ]]; then
    DEST_CONF="r2://${LOGS_BUCKET}/workers-logs/{DATE}?account-id=${ACCOUNT_ID}&access-key-id=${R2_LOGPUSH_ACCESS_KEY_ID}&secret-access-key=${R2_LOGPUSH_SECRET_ACCESS_KEY}"
    create_job=$(cf_api POST "/logpush/jobs" \
      -d "{
        \"name\": \"${WORKER_NAME}-traces\",
        \"destination_conf\": \"${DEST_CONF}\",
        \"dataset\": \"workers_trace_events\",
        \"enabled\": true,
        \"output_options\": {
          \"timestamp_format\": \"rfc3339\"
        }
      }")
    if echo "$create_job" | jq -e '.success' > /dev/null 2>&1; then
      ok "Created Logpush job: workers_trace_events → ${LOGS_BUCKET}"
    fi
  else
    info "Skipped: Set R2_LOGPUSH_ACCESS_KEY_ID + R2_LOGPUSH_SECRET_ACCESS_KEY to enable"
  fi
fi

# ─── 4. Alerting: Notification Policies ──────────────────────────────────────

section "4. Alerting: Notification Policies"

# Check existing policies
existing_policies=$(cf_api GET "/alerting/v3/policies" 2>/dev/null || echo '{"result":[]}')

# 4a. Workers error rate alert
error_alert_name="[${ENV}] Workers Error Rate"
error_alert_exists=$(echo "$existing_policies" | jq -r ".result[] | select(.name == \"${error_alert_name}\") | .id" 2>/dev/null || echo "")

if [[ -n "$error_alert_exists" ]]; then
  skip "Error rate alert already exists (ID: ${error_alert_exists})"
else
  create_alert=$(cf_api POST "/alerting/v3/policies" \
    -d "{
      \"name\": \"${error_alert_name}\",
      \"alert_type\": \"workers_alert\",
      \"enabled\": true,
      \"mechanisms\": {
        \"email\": [{\"id\": \"${ALERT_EMAIL}\"}]
      },
      \"filters\": {
        \"slo\": [\"99.0\"]
      },
      \"description\": \"Alert when ${WORKER_NAME} error rate exceeds SLO\"
    }" 2>/dev/null || true)
  if echo "$create_alert" | jq -e '.success' > /dev/null 2>&1; then
    ok "Created alert: ${error_alert_name}"
  else
    info "Workers alert creation may require specific plan features"
  fi
fi

# 4b. Usage-based billing alert
usage_alert_name="[${ENV}] AI Gateway Usage"
usage_alert_exists=$(echo "$existing_policies" | jq -r ".result[] | select(.name == \"${usage_alert_name}\") | .id" 2>/dev/null || echo "")

if [[ -n "$usage_alert_exists" ]]; then
  skip "Usage alert already exists (ID: ${usage_alert_exists})"
else
  create_usage=$(cf_api POST "/alerting/v3/policies" \
    -d "{
      \"name\": \"${usage_alert_name}\",
      \"alert_type\": \"billing_usage_alert\",
      \"enabled\": true,
      \"mechanisms\": {
        \"email\": [{\"id\": \"${ALERT_EMAIL}\"}]
      },
      \"description\": \"Alert on AI Gateway usage spikes for ${GATEWAY_ID}\"
    }" 2>/dev/null || true)
  if echo "$create_usage" | jq -e '.success' > /dev/null 2>&1; then
    ok "Created alert: ${usage_alert_name}"
  else
    info "Billing alert creation may require specific plan features"
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

section "Done"
echo "  Environment: ${ENV}"
echo "  Gateway:     ${GATEWAY_ID}"
echo "  Logs bucket: ${LOGS_BUCKET}"
echo "  Worker:      ${WORKER_NAME}"
echo ""
echo "  Verify in dashboard:"
echo "    AI Gateway: https://dash.cloudflare.com/${ACCOUNT_ID}/ai/ai-gateway/${GATEWAY_ID}"
echo "    Logpush:    https://dash.cloudflare.com/${ACCOUNT_ID}/logs"
echo "    Alerts:     https://dash.cloudflare.com/${ACCOUNT_ID}/notifications"
