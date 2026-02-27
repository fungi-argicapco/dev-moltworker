---
name: linear-issue-manager
description: Manage all Linear workspace operations (CRUD, templating, batch updates, approval workflows). Use when creating, updating, linking issues across initiatives; populating discovery frameworks; or managing Linear as single source of truth for client projects, proposals, and engagement timelines.
---

# Linear Issue Manager

Autonomous agent for managing stream-kinetics Linear workspace across all initiatives (contentguru, metamirror, wealthinnovation, fungiagricap, tabbytarot, hardshell).

## Core Operations

### Create Issues at Scale
- Batch create parent + child issue hierarchies
- Populate with templated content
- Link to initiatives, projects, teams
- Set status workflows

### Populate Issue Content
- Fill discovery questionnaires (SK-3)
- Populate tech stack matrices (SK-4)
- Create pain point canvases (SK-5)
- Define data models (SK-6)
- Generate onboarding workflows (SK-8)

### Update Workflow States
- Move issues through approval gates
- Assign to team members
- Add comments for stakeholder updates
- Track decision gates

### Link & Reference
- Create parent-child relationships
- Link related issues
- Reference documents/resources
- Build issue dependency chains

## Workflow: Populate Discovery Framework

**Input:** JSON discovery object (client_name, tech_stack, pain_points, etc.)

**Output:** Linked Linear issue hierarchy

```
SK-2 (Parent: Standard Client Discovery Intake Framework)
├── SK-3 (Discovery Questionnaire Template) ← populated with client Q&A
├── SK-4 (Tech Stack Assessment Matrix) ← current vs. desired stack
├── SK-5 (Pain Points & Opportunities) ← pain-opportunity mapping
├── SK-6 (Data Model Definition) ← entity schema
└── SK-8 (Client Onboarding Workflow) ← 6-week timeline
```

## Tools & Scripts

See `scripts/` directory:
- `linear-api.js` - GraphQL query/mutation wrapper
- `batch-issue-create.js` - Bulk issue creation with hierarchy
- `populate-issue.js` - Update issue description with formatted content
- `link-issues.js` - Create parent-child and reference links

## API Token

Use environment variable: `LINEAR_API_TOKEN`
Default workspace: `stream-kinetics`

## Key Teams & Projects

See `references/linear-workspace.md` for full team/project IDs and structure.

Quick reference:
- **SK (stream-kinetics team)**: Framework & playbooks
- **MM (metamirror team)**: Dr. Monique Lowe neuropsych
- **CG (contentguru team)**: Seattle Unity
- **MM-8**: Monique's parent engagement issue
- **CG-1**: Diane presentation parent issue
