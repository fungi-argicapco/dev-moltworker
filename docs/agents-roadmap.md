# Agent Build Roadmap

## ✅ COMPLETE (3 agents)

1. **LinearIssueManager** — Create/update Linear issues
2. **CRMAnalystAgent** — Query D1 databases (crm-db, contentguru-db)
3. **CloudflareConfigAgent** — Manage config via KV ✅ TESTED & WORKING

## 🔨 READY TO BUILD (8 agents)

### Cloudflare Suite (4)
4. **CloudflareDeploymentAgent** — Deploy Workers/Pages
5. **CloudflareD1Agent** — Manage D1 databases
6. **CloudflareSecurityAgent** — Zero Trust, WAF, Tunnels
7. **CloudflareMonitoringAgent** — Analytics & logs

### Discovery/Planning Suite (4)
8. **DiscoveryFrameworkAgent** — Extract patterns from transcripts
9. **DataModelAgent** — Design normalized schemas
10. **OnboardingPlaybookAgent** — 6-week engagement plans
11. **IntegrationArchitectAgent** — Tech stack assessment

## Spawn Strategy

Once all 11 agents are built, spawn them in parallel:
- LinearIssueManager + CRMAnalystAgent → Mine data + create issues
- CloudflareDeploymentAgent → Deploy infrastructure
- DiscoveryFrameworkAgent + DataModelAgent → Analyze Monique/Seattle Unity
- OnboardingPlaybookAgent → Generate engagement timelines
- IntegrationArchitectAgent → Tech assessment

All running autonomously, with LinearIssueManager surfacing results to inbox.
