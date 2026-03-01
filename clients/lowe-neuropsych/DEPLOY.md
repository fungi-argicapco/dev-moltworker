# Client Wrangler Config: Dr. Monique Lowe (lowe-neuropsych)
#
# Deploy to dispatch namespace:
#   bunx wrangler deploy --dispatch-namespace hardshell-prod
#
# Set required secrets FIRST:
#   bunx wrangler secret put AGENT_MODE          # value: client
#   bunx wrangler secret put CLIENT_NAME         # value: lowe-neuropsych
#   bunx wrangler secret put TELEGRAM_BOT_TOKEN  # value: <from @BotFather>
#   bunx wrangler secret put CLOUDFLARE_AI_GATEWAY_API_KEY
#   bunx wrangler secret put CF_AI_GATEWAY_ACCOUNT_ID
#   bunx wrangler secret put CF_AI_GATEWAY_GATEWAY_ID  # value: client-lowe-aigw
#   bunx wrangler secret put OPENCLAW_GATEWAY_TOKEN
#
# This config inherits from the main wrangler.jsonc but overrides:
# - Worker name (for dispatch namespace)
# - R2 bucket (client-isolated)
# - AI Gateway (client-dedicated)
# - Container env vars
#
# See: docs/standards/resource-naming-convention.md for naming patterns

# NOTE: This is a reference config. The actual deployment uses the main
# wrangler.jsonc with --dispatch-namespace flag and per-worker secrets.
# Client-specific overrides are applied via env vars at runtime.
#
# Deploy command:
#   bunx wrangler deploy \
#     --name client-lowe-neuropsych \
#     --dispatch-namespace hardshell-prod \
#     --config wrangler.jsonc
#
# Then set client-specific secrets:
#   bunx wrangler secret put AGENT_MODE --name client-lowe-neuropsych
#   bunx wrangler secret put CLIENT_NAME --name client-lowe-neuropsych
#   ... (see above)
