---
name: discovery-framework-agent
description: Extract discovery patterns from client transcripts, conversations, and intake data. Use when analyzing new client engagements, comparing discovery patterns across clients, building discovery questionnaires, or generating structured intake reports for downstream agents.
---

# Discovery Framework Agent

Extract structured insights from client discovery calls and intake data. This is the entry point for every new client engagement — discovery output feeds into data-model, onboarding-playbook, and linear-issue-manager.

## Core Operations

### Transcript Analysis
- Parse transcripts (PDF, text, JSON, audio transcription)
- Identify pain points, opportunities, and unmet needs
- Extract tech stack details (current vs. desired)
- Detect budget signals and timeline expectations
- Capture decision-maker context and stakeholder mapping

### Pattern Extraction
- Compare discovery patterns across existing clients
- Identify common pain points by industry/vertical
- Surface cross-sell opportunities based on pattern similarity
- Build client similarity scores for resource planning

### Questionnaire Generation
- Generate tailored discovery questionnaires based on vertical
- Pre-populate answers from available intake data
- Identify gaps requiring follow-up

## Tools & Scripts

- `scripts/extract-patterns.js` — Parse transcript → structured JSON

## Output

All discovery analyses produce:
1. **Discovery Summary** — Structured JSON with client profile, pain points, tech stack, opportunities
2. **Pattern Match Report** — Similarity to existing client profiles
3. **Gap Analysis** — Missing information requiring follow-up
4. **Downstream Triggers** — Recommended next skills (data-model, onboarding-playbook, linear-manager)

## Integration Flow

```
Discovery Call (transcript)
  → extract-patterns.js → Discovery JSON
    → data-model-agent (schema design)
    → onboarding-playbook-agent (timeline)
    → linear-issue-manager (issue hierarchy)
    → crm-analyst-agent (customer record)
```

## Discovery JSON Schema

```json
{
  "client_name": "string",
  "industry": "string",
  "pain_points": ["string"],
  "opportunities": ["string"],
  "tech_stack": {
    "current": ["string"],
    "desired": ["string"]
  },
  "budget_range": "string",
  "timeline": "string",
  "stakeholders": [{"name": "string", "role": "string"}],
  "decision_criteria": ["string"]
}
```

## Reference

See `docs/discovery/` for real client discovery transcripts and outputs.
