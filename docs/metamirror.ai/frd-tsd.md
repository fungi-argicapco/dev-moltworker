# MetaMirror.ai — Functional Requirements & Technical Specification

> **Status:** Shelved — Pending co-design with neuropsychologist pilot customer (meeting 2026-02-27).
> **Brand:** metamirror.ai
> **Parent Platform:** Hardshell (OpenClaw + Cloudflare)

---

## Executive Summary

MetaMirror.ai is the **Self-Intelligence vertical** of the Hardshell platform, designed for neurological and psychological practices. It provides customized AI agents that help patients with cognitive scanning, attention/meta-consciousness assessment, and self-representation mapping.

This is the **only Hardshell vertical that requires HIPAA compliance** and the **only extension agent that warrants full instantiation** (rather than being a skill loaded into Omega).

---

## Why Instantiation (Not a Skill)

MetaMirror requires an **Instantiated Agent** (not a skill) because it needs:

| Requirement | Why It Can't Be a Skill |
|-------------|------------------------|
| Persistent patient sessions | Conversation continuity across days/weeks — skills are stateless |
| Isolated memory | Patient data must never leak between sessions or agents |
| Distinct persona | Clinical assistant tone, not the same as Omega or business agents |
| HIPAA-aligned sandbox | Restricted tool profile — no exec, no browser, no external writes |
| Session ownership | Each patient's chat history belongs to them alone |

---

## Functional Requirements

### FR-1: Cognitive Scanning
- Track attention patterns across sessions (response latency, word choice evolution)
- Generate longitudinal attention profiles
- Flag deviations from patient baseline

### FR-2: Meta-Consciousness Assessment
- Deliver guided self-reflection exercises calibrated to patient baseline
- Adjustable difficulty/depth based on practitioner settings
- Pre/post session scoring

### FR-3: Self-Representation Mapping
- Build longitudinal profiles of how patients describe themselves
- Track linguistic patterns, metaphor usage, identity framing shifts
- Visualize change over time

### FR-4: Clinician Dashboards
- Summarize patient progress for the practitioner
- Exportable session summaries (PDF/structured data)
- Highlight clinically significant changes

### FR-5: Session Continuity
- Pick up exactly where the last session left off
- Maintain context window across multiple sessions
- Patient-controlled session history (right to deletion)

---

## Technical Specification

### OpenClaw Agent Configuration

```json5
{
  id: "self-intel",
  name: "Mirror",
  workspace: "~/.openclaw/workspace-mirror",
  agentDir: "~/.openclaw/agents/self-intel/agent",
  // HIPAA-aligned: no exec, no browser, no external writes
  tools: {
    profile: "minimal",
    allow: ["read", "sessions_list", "sessions_history", "session_status", "message"],
    deny: ["exec", "process", "browser", "canvas", "nodes", "cron", "gateway", "write", "edit"],
  },
  sandbox: {
    mode: "all",
    scope: "agent",  // Full isolation from other agents
  },
}
```

### Persona Files

```
workspace-mirror/
├── SOUL.md           # Clinical assistant persona (empathetic, structured, evidence-based)
├── AGENTS.md         # Cognitive scanning protocols, assessment rubrics
└── skills/
    ├── cognitive-scan/SKILL.md
    ├── meta-consciousness/SKILL.md
    ├── self-map/SKILL.md
    └── clinician-report/SKILL.md
```

### Resource Naming (per STD-RES-001)

| Resource | Name |
|----------|------|
| Agent ID | `self-intel` |
| Workspace | `workspace-mirror` |
| Worker (WfP) | `client-{practice-slug}` |
| R2 prefix | `clients/{practice-slug}/mirror/` |
| AI Gateway route | Tagged `x-hs-brand: metamirror` |

---

## HIPAA Compliance Requirements

> [!CAUTION]
> These are **hard requirements** for handling ePHI. MetaMirror cannot launch without these in place.

### Infrastructure

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| BAA with Cloudflare | CF Enterprise plan + signed BAA | ❌ Not started |
| Zero Data Retention | AI Gateway ZDR enabled for MetaMirror routes | ❌ Not started |
| Encryption at rest | D1 + R2 (CF default encryption) | ✅ Default |
| Encryption in transit | TLS everywhere (CF default) | ✅ Default |
| Access controls | CF Access + per-agent tool restrictions | ⚠️ Partial |
| Audit logging | All sessions logged to isolated R2 prefix | ❌ Not started |
| Data deletion | Patient right-to-delete across all stores | ❌ Not started |

### Communication Channel

| Option | HIPAA Status | Notes |
|--------|-------------|-------|
| Telegram | ❌ Non-compliant | No BAA possible, messages stored on Telegram servers |
| Custom web portal | ✅ Compliant | We control the entire data path, can sign BAA |
| TigerConnect SDK | ✅ Compliant | HIPAA-certified messaging SDK, but adds vendor dependency |

**Decision:** MetaMirror gets a **bespoke HIPAA-compliant web portal** (no Telegram). Other Hardshell verticals continue using Telegram.

### Data Isolation

- **Separate R2 prefix** per practice, per patient
- **OpenClaw `dmScope: peer`** — agent memory scoped to individual patient
- **No cross-agent context** — Mirror cannot access Omega's or any business agent's sessions
- **Session purge capability** — patient or clinician can delete all session data

---

## Open Questions (for Pilot Co-Design)

> [!NOTE]
> These are to be resolved during the neuropsychologist pilot engagement.

1. **Assessment frameworks** — Which validated instruments (MoCA, MMSE, custom) should Mirror support?
2. **Session cadence** — Daily, weekly, on-demand? Does the agent initiate or wait for the patient?
3. **Practitioner control surface** — What controls does the clinician need? (model selection, assessment difficulty, session frequency caps)
4. **Data export format** — HL7 FHIR, PDF reports, custom structured JSON?
5. **EHR integration** — Does the practice use an EHR system we need to integrate with?
6. **Consent workflow** — How is patient consent captured and stored?
7. **Crisis protocols** — What happens if the agent detects suicidal ideation or acute distress?
8. **Billing model** — Per-patient, per-practice, per-session?
9. **Regulatory jurisdiction** — Which state(s)? Any additional state-level requirements beyond federal HIPAA?

---

## Relationship to Hardshell Platform

MetaMirror is **Phase 5** in the Hardshell roadmap — deliberately last because:
1. It requires HIPAA infrastructure that no other vertical needs
2. The agent design should be co-created with a clinical expert
3. It has the highest regulatory risk and the longest compliance timeline
4. The pilot customer engagement (2026-02-27 meeting) will shape the actual requirements

All MetaMirror infrastructure shares the Hardshell platform (Workers for Platforms, AI Gateway, dispatch namespace) but with additional compliance controls layered on top.
