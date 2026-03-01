---
name: cloudflare-deployment-agent
description: Deploy Workers, Pages, and infrastructure to Cloudflare. Use when deploying code, managing versions, rolling back changes, running quality gates, or automating CI/CD pipelines for Hardshell platform services.
---

# Cloudflare Deployment Agent

Deploy and manage Cloudflare Workers, Pages, and platform services with full quality gate enforcement.

## Core Operations

### Worker Deployment
- Deploy Workers via `bunx wrangler deploy`
- Deploy with custom config: `bunx wrangler deploy -c wrangler.hardshell.jsonc`
- Set environment secrets via `bunx wrangler secret put`
- Validate deployment with health checks

### Version Management
- List deployment versions
- Compare deployed vs. local code
- Rollback to previous version on failure
- Tag deployments with git SHA

### Quality Gate (Pre-Deploy)
Before ANY deployment, execute in order:
1. `bun run lint` — ESLint
2. `bun run check` — Svelte/TypeScript check
3. `bun run format` — Prettier
4. `bun run test:backend` — Backend tests
5. `bun run test:e2e` — End-to-end tests
6. `bun run test:smoke` — Smoke tests
7. `bun run test:unit` — Unit tests

**All must pass with zero errors and zero warnings before proceeding.**

### Git Operations (Pre-Deploy)
1. Stage changes: `git add .`
2. Commit with descriptive message
3. Push to remote branch
4. Verify CI passes (if configured)

### Deployment Targets

| Target | Config | Worker Name |
|--------|--------|-------------|
| Dev | `wrangler.jsonc` | `dev-moltworker` |
| Staging | `wrangler.hardshell.jsonc` | `hardshell-stg-gateway` |
| Production | `wrangler.hardshell.jsonc` (prod) | `hardshell-prod-gateway` |

## Environment Variables

- `CLOUDFLARE_API_TOKEN` — Deploy token with Workers Scripts:Edit
- `CLOUDFLARE_ACCOUNT_ID` — Account ID

## Safety Rules

1. **Never** deploy to production without staging validation first
2. **Never** skip the quality gate
3. **Never** merge `hardshell` → `main` without explicit promotion decision
4. **Always** git commit and push before deploying
