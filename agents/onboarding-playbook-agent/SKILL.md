---
name: onboarding-playbook-agent
description: Generate structured client onboarding timelines, phase plans, SOWs, and engagement playbooks. Use when planning new client projects, defining delivery phases, creating statements of work, or designing success metrics for managed service engagements.
---

# Onboarding Playbook Agent

Create structured onboarding timelines and engagement playbooks for new Hardshell managed service clients.

## Core Operations

### Timeline Generation
- Generate 6-week phased onboarding plan
- Define deliverables per phase with due dates
- Identify decision gates and approval checkpoints
- Create resource allocation plan (agents, skills, infrastructure)

### Statement of Work (SOW)
- Generate SOW from discovery output
- Include scope, deliverables, timeline, pricing
- Define acceptance criteria per phase
- Include terms and conditions

### Success Metrics
- Define measurable outcomes per engagement
- Track onboarding progress against plan
- Identify at-risk phases early
- Generate progress reports for stakeholders

## Tools & Scripts

- `scripts/create-timeline.js` — Generate 6-week phased timeline
- `scripts/generate-sow.js` — Create Statement of Work document

## Standard Phases

| Phase | Week | Focus | Gate |
|-------|------|-------|------|
| 1. Discovery | 1 | Intake, transcript analysis, pattern extraction | Discovery approval |
| 2. Architecture | 2 | Schema design, infrastructure planning | Architecture review |
| 3. Foundation | 3 | Agent provisioning, R2 bucket, AI Gateway | Smoke test pass |
| 4. Integration | 4 | Skills activation, Telegram binding | Integration test pass |
| 5. Validation | 5 | Quality gate, security sweep, UAT | Client sign-off |
| 6. Launch | 6 | Go-live, monitoring, handoff to managed ops | Launch confirmation |

## Output

All onboarding plans produce:
1. **Phase Timeline** — Gantt-style timeline with milestones
2. **Deliverables Matrix** — What's delivered in each phase
3. **SOW Document** — Formal statement of work
4. **Resource Plan** — Skills/agents activated per phase
5. **Risk Register** — Identified risks with mitigation

## Integration Flow

```
discovery-framework-agent (Discovery JSON)
  → onboarding-playbook-agent
    → SOW + Timeline
    → linear-issue-manager (issue hierarchy)
    → client-provisioner (infrastructure setup)
```

## Pricing Tiers

| Tier | Setup | Monthly | Included Skills |
|------|-------|---------|----------------|
| Starter | $2,000 | $500 | Core 6 skills |
| Professional | $4,000 | $1,000 | Core + 2 extensions |
| Enterprise | Custom | Custom | Full platform access |
