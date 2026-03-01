# Memory — Long Term

## Platform Facts
- Hardshell staging deployed to `hardshell-stg-gateway.jfischburg-us.workers.dev`
- AI Gateway: `hardshell-stg-aigw` (Unified Billing, no Anthropic key needed)
- R2 backups were cleared 2026-02-27 to fix persona loading
- Container runs on Cloudflare Containers (standard-2 instance)

## Decisions
- Standardized env var naming: `LINEAR_API_KEY` (not TOKEN)
- Skills use `.cjs` extension (project has `"type": "module"`)
- SOUL.md + AGENTS.md baked into Docker image, copied to workspace on startup
