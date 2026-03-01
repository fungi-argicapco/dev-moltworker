# Cloudflare API Reference

## KV (Key-Value Storage)

Base URL: `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{NAMESPACE_ID}`

### Get Value
```
GET /values/{key}
Authorization: Bearer {API_TOKEN}
```

Response:
```json
{
  "success": true,
  "result": "value-content"
}
```

### Put Value
```
PUT /values/{key}
Authorization: Bearer {API_TOKEN}
Content-Type: application/json

"value-content"
```

Query params:
- `expiration_ttl=3600` — TTL in seconds

### Delete Value
```
DELETE /values/{key}
Authorization: Bearer {API_TOKEN}
```

### List Keys
```
GET /keys
Authorization: Bearer {API_TOKEN}
```

Query params:
- `prefix=openclaw-` — Filter by prefix
- `limit=100` — Max 1000 keys per page
- `cursor=xyz` — Pagination cursor

## Workers

Base URL: `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/workers`

### Deploy Worker
```
PUT /scripts/{script_name}
Authorization: Bearer {API_TOKEN}
Content-Type: application/wasm

[binary wasm content]
```

### Set Environment Variables
```
PUT /scripts/{script_name}/settings
Authorization: Bearer {API_TOKEN}
Content-Type: application/json

{
  "bindings": [
    {
      "name": "KV_NAMESPACE",
      "type": "kv_namespace",
      "namespace_id": "..."
    }
  ],
  "env_vars": {
    "CLOUDFLARE_API_TOKEN": "...",
    "LINEAR_API_TOKEN": "..."
  }
}
```

### Trigger Rollout
```
POST /scripts/{script_name}/rollout
Authorization: Bearer {API_TOKEN}
Content-Type: application/json

{
  "strategy": "rolling"
}
```

## D1 (Databases)

Base URL: `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database`

### Query Database
```
POST /database/{database_id}/query
Authorization: Bearer {API_TOKEN}
Content-Type: application/json

{
  "sql": "SELECT * FROM customers LIMIT 10"
}
```

Response:
```json
{
  "success": true,
  "result": [
    {
      "success": true,
      "results": [...]
    }
  ]
}
```

## Configuration Management

No official Cloudflare API for managing gateway config directly. Instead:

1. **Store in KV:** `openclaw-config` key holds JSON config
2. **Trigger Gateway Reload:** 
   - Write to KV
   - Webhook to gateway to re-read config
   - Or restart gateway via Worker cron job

## Authentication

All requests require:
```
Authorization: Bearer {API_TOKEN}
```

Get token from: https://dash.cloudflare.com/profile/api-tokens

For this workspace:
- Account ID: `a9c661749d16228083b6047aa1e8a70e`
- API Token: Already configured in environment

## Rate Limits

- **KV:** 1,000 reads/second, 100 writes/second (free tier)
- **D1:** 100 read requests/second (free tier)
- **Workers:** 100,000 requests/day (free tier)

Retry with exponential backoff for rate limit (429) responses.
