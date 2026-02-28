---
name: telegram-command-menu
model_tier: free
description: Telegram slash command handler and inline keyboard navigation for agent team access. Routes /finance, /legal, /tax, /cash, /hipaa, /contract, /team, /compliance, and /help commands to appropriate agents with button-driven UX.
---

# Telegram Command Menu

> **Stream Kinetics** · Managed Service Skill · Reusable
> Maintained by: Omega (AI Agent) | Owner: Joshua Fischburg

---

## Purpose

The **Telegram Command Menu** provides user-friendly navigation for the full agent team via Telegram slash commands and inline keyboard buttons. It intercepts commands, shows contextual menus, and routes actions to the appropriate specialist agent.

### Core Capabilities

1. **Slash Command Handling** — Intercept `/finance`, `/legal`, etc. and show menus
2. **Inline Keyboard Generation** — Dynamic button layouts for agent actions
3. **Callback Routing** — Route button presses to the correct agent + action
4. **Quick Actions** — One-tap access to common operations (cash brief, tax estimate)
5. **Help System** — `/help` shows all available commands and navigation guide

---

## Command Reference

| Command | Action | Agent Routed To |
|---------|--------|----------------|
| `/finance` | Show financial team menu buttons | CFO (overview) |
| `/legal` | Show legal team menu buttons | General Counsel (overview) |
| `/tax` | Generate quarterly tax estimate | Tax Strategist |
| `/cash` | Generate cash position brief | Treasury |
| `/hipaa` | Show HIPAA compliance status | Healthcare Compliance |
| `/contract` | Start contract review triage | Corporate & Contracts |
| `/team` | Show full team dashboard | CFO (Aria) |
| `/compliance` | Show unified compliance calendar | Regulatory + Healthcare |
| `/help` | Show available commands | Self (no agent) |

---

## Callback Data Format

Button callbacks use the format: `{type}:{target}:{action}`

```
agent:treasury:cash_brief       → Treasury agent, run cash brief
agent:quant:portfolio_analysis   → Quant agent, run portfolio analysis
menu:finance                     → Show finance inline keyboard
menu:legal                       → Show legal inline keyboard
dashboard:alerts                 → Generate active alerts summary
dashboard:deadlines              → Generate upcoming deadlines
dashboard:costs                  → Generate cost/usage dashboard
```

---

## Implementation Notes

### In OpenClaw

The command menu is handled in OpenClaw's Telegram integration layer. When a slash command arrives:

1. Parse command from message text
2. Load `config/telegram-menu.json` for keyboard definitions
3. Send reply with inline keyboard markup
4. On callback_query, parse `callback_data` → route to agent

### BotFather Registration

Commands must be registered with @BotFather for autocomplete:

```
finance - 💰 Financial team dashboard
legal - ⚖️ Legal team dashboard
tax - 🧮 Quick: quarterly tax estimate
cash - 💵 Quick: cash position brief
hipaa - 🏥 Quick: HIPAA compliance status
contract - 📜 Quick: contract review triage
team - 👥 Full agent team overview
compliance - 📋 Compliance calendar (all teams)
help - ❓ Available commands and navigation
```

---

## Security Boundaries

### MUST NOT
- Process menu rendering with premium models (always use free tier)
- Expose internal agent names or system architecture to users
- Allow unauthenticated command access (Telegram user ID validation)
