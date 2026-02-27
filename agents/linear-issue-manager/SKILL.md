---
name: linear-issue-manager
description: Manage all Linear workspace operations — issues, projects, teams, priorities, and standup. Use for creating, updating, searching, and tracking issues across all stream-kinetics initiatives. Supports human-friendly status mapping, team auto-discovery with caching, daily standup summaries, and the Standard Client Discovery Framework.
---

# Linear Issue Manager

Comprehensive Linear management for the stream-kinetics workspace. All operations via `node scripts/linear-api.js <command>`.

## Quick Commands

```bash
node scripts/linear-api.js my-issues    # My open issues (all teams)
node scripts/linear-api.js my-todos     # My unstarted issues only
node scripts/linear-api.js urgent       # All P1 issues across workspace
node scripts/linear-api.js standup      # Daily standup: Todo/In Progress/Done
```

## Issue Operations

```bash
# View issue details
node scripts/linear-api.js issue SK-123

# Create an issue
node scripts/linear-api.js create --team SK --title "New task" --priority high --status todo

# Update issue
node scripts/linear-api.js update SK-123 --status done --priority low

# Change status (shorthand)
node scripts/linear-api.js status SK-123 done

# Set priority (shorthand)
node scripts/linear-api.js priority SK-123 urgent

# Assign to user
node scripts/linear-api.js assign SK-123 me
node scripts/linear-api.js assign SK-123 josh@streamkinetics.com

# Add comment
node scripts/linear-api.js comment SK-123 "Fixed in latest deploy"

# Search
node scripts/linear-api.js search "onboarding workflow"
```

## Team & Project Operations

```bash
node scripts/linear-api.js teams                # List all teams (cached)
node scripts/linear-api.js projects              # List all projects
node scripts/linear-api.js project "hardshell"   # Issues for a project
```

## Priority Levels

| Level | Value | Use for |
|-------|-------|---------|
| urgent | 1 | Production issues, blockers |
| high | 2 | This week, important |
| medium | 3 | This sprint/cycle |
| low | 4 | Nice to have |
| none | 0 | Backlog, someday |

## Status Mapping

Human-friendly names → auto-resolved to team-specific workflow state IDs:

| Name | Linear Category |
|------|----------------|
| backlog | Backlog |
| todo | Unstarted |
| progress | Started |
| review | Started |
| done | Completed |
| cancelled | Canceled |

## Teams (Auto-Discovered)

Team keys and IDs are fetched via API and cached locally. Use `teams` command to refresh.

Quick reference:
- **SK** — stream-kinetics (Workspace Admin)
- **CG** — contentguru.ai (Social Intelligence)
- **MM** — metamirror.ai (Self Intelligence)
- **WI** — wealthinnovation.ai (Personal Wealth)
- **FAC** — fungiagricap.com (Physical/Real Estate)
- **TAR** — tabbytarot.fun (Spiritual Intelligence)
- **HAR** — hardshell (OpenClaw Hosting)

## Discovery Framework Workflow

**Input:** JSON discovery object (client_name, tech_stack, pain_points, etc.)
**Script:** `node scripts/batch-populate-discovery.js <client_name> <initiative_key> [discovery.json]`

Creates linked Linear issue hierarchy:
```
SK-2 (Parent: Standard Client Discovery Intake Framework)
├── SK-3 (Discovery Questionnaire Template) ← populated with client Q&A
├── SK-4 (Tech Stack Assessment Matrix) ← current vs. desired stack
├── SK-5 (Pain Points & Opportunities) ← pain-opportunity mapping
├── SK-6 (Data Model Definition) ← entity schema
└── SK-8 (Client Onboarding Workflow) ← 6-week timeline
```

## Environment

- **Env var:** `LINEAR_API_KEY` (required)
- **Default workspace:** stream-kinetics
- **API:** Linear GraphQL (`api.linear.app/graphql`)
- **Caching:** Teams + workflow states cached to `/tmp/linear-*.json` (1h TTL)

## Reference Files

- `references/linear-workspace.md` — Full team/project IDs and structure
- `scripts/linear-api.js` — Core CLI tool (GraphQL wrapper + all commands)
- `scripts/batch-populate-discovery.js` — Discovery framework batch creation
