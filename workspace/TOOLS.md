# Tools — Environment Notes

## Runtime
- **Container:** Cloudflare Container (Ubuntu, Node.js, Python3)
- **Gateway:** OpenClaw on port 18789
- **Model:** Claude Sonnet 4 via Cloudflare AI Gateway

## API Keys Available
- `LINEAR_API_KEY` — Linear issue management
- `CLOUDFLARE_AI_GATEWAY_API_KEY` — AI Gateway auth

## Skills Directory
- Skills are symlinked from `/root/clawd/agents/*/` → `/root/clawd/skills/`
- Each skill has a `SKILL.md` with usage instructions
- Run skill scripts via: `node /root/clawd/skills/<name>/scripts/<script>.cjs`

## Cloudflare Account
- Account ID: `a9c661749d16228083b6047aa1e8a70e`
- Worker: `hardshell-stg-gateway`
- R2 Bucket: `hardshell-stg-data`
