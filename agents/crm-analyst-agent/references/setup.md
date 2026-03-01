# CRM Analyst Agent Setup

## D1 Authentication

To query Cloudflare D1 databases, the agent needs:

1. **Cloudflare D1 Token** ✅ Provided
   - Token: `zmuaXnd4KisSg1NDFvhxDjEFKGliH83Nrq_FMCa5`
   - Access: crm-db, crm-db-staging, contentguru-db, contentguru-db-staging

2. **Cloudflare Account ID** ⏳ NEEDED
   - Get from: https://dash.cloudflare.com/profile/api-tokens
   - Set as: `CLOUDFLARE_ACCOUNT_ID` environment variable
   - Or provide to this agent at initialization

## Testing D1 Connection

Once account ID is provided:

```bash
export CLOUDFLARE_D1_TOKEN="zmuaXnd4KisSg1NDFvhxDjEFKGliH83Nrq_FMCa5"
export CLOUDFLARE_ACCOUNT_ID="your-account-id-here"

# Explore schema
node scripts/d1-query.js explore crm-db

# Query customers
node scripts/customer-analysis.js all crm-db

# Get summary
node scripts/customer-analysis.js summary crm-db
```

## Database Structure

Once connected, the agent auto-discovers tables. Common expected tables:

- **customers** — Customer/client records
- **activities** — Customer engagement/activity log
- **subscriptions** — Service subscriptions
- **features** — Features enabled per customer
- **implementations** — Project implementations
- **initiatives** — Our business initiatives

## Ready Operations

These scripts are ready to use once account ID is configured:

- `d1-query.js` — Low-level SQL execution
- `customer-analysis.js` — High-level analysis (customers, engagement, opportunities)
- `schema-explorer.js` — Auto-discover and document schema

## Next Steps

1. Provide Cloudflare Account ID
2. Agent will test D1 connection
3. Auto-generate D1 schema documentation
4. Mine customer/opportunity data
