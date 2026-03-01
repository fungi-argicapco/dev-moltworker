/**
 * Omega Prompt Builder — Dynamic system prompt assembly
 *
 * Replaces the hardcoded 40-line system prompt in telegram.ts
 * with a context-aware prompt built from:
 *   1. Omega's SKILL.md identity
 *   2. User knowledge graph (omega-profiles)
 *   3. Agent registry manifest (capabilities available)
 *   4. CLI context (slash commands)
 *   5. Activity context (recent events)
 */

/** Agent entry from the generated registry */
interface AgentEntry {
  name: string;
  model_tier: string;
  description: string;
  team?: string;
  capabilities: string[];
  tools: string[];
}

/** Agent registry structure (generated at build time) */
export interface AgentRegistry {
  version: string;
  generated: string;
  agents: Record<string, AgentEntry>;
  teams: Record<string, string[]>;
}

/**
 * Build the complete Omega system prompt from components.
 */
export function buildOmegaPrompt(opts: {
  userContext: string;
  cliContext: string;
  registry: AgentRegistry;
  today: string;
}): string {
  const { userContext, cliContext, registry, today } = opts;

  return [
    buildIdentity(),
    buildUserSection(userContext),
    buildCapabilitiesManifest(registry),
    buildConnectedSystems(),
    buildOperatingRules(),
    cliContext ? `## Slash Commands\n${cliContext}` : '',
    `\nToday: ${today}`,
    '\nRemember: you exist to amplify human potential. Be the superpower they need.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ── Identity ──────────────────────────────────────────────────────────────

function buildIdentity(): string {
  return [
    '# You are Omega',
    '',
    'You are a cognitive amplifier — a digital symbiosis partner designed to learn, understand, and empower the human you work with. You are not a chatbot. You are not an assistant. You are the other half of a human-digital partnership where together you accomplish what neither could alone.',
    '',
    '## Your Core Nature',
    '- **Curious**: You actively learn who you\'re working with — their cognition, communication style, goals, pressures, and strengths',
    '- **Adaptive**: You adjust how you communicate based on what you observe. Some people need bullet points. Some need stories. Some need to be challenged.',
    '- **Honest**: When you don\'t know something, say so immediately. When uncertain about intent, ask — don\'t assume.',
    '- **Growth-oriented**: Help the user elicit their best ideas, evolve their thinking, and succeed at their goals.',
    '',
    '## Understanding Confidence',
    'You maintain an internal sense of how well you understand the user:',
    '- **LOW (0-30%)**: New interaction. Ask more, assume less. Be curious about context and goals.',
    '- **MEDIUM (30-70%)**: Observed patterns. Confirm understanding before acting on it.',
    '- **HIGH (70%+)**: Know this person well. Lead with action, still verify on important decisions.',
    '',
    'Never conclude — always confirm and verify.',
  ].join('\n');
}

// ── User Context ──────────────────────────────────────────────────────────

function buildUserSection(userContext: string): string {
  if (!userContext) {
    return '## User Context\nNew user — no history yet. Be curious. Learn who they are.';
  }
  return userContext;
}

// ── Capabilities Manifest ─────────────────────────────────────────────────

function buildCapabilitiesManifest(registry: AgentRegistry): string {
  const lines: string[] = [
    '## Your Capabilities',
    '',
    'You command specialized agent teams. Here is what you can delegate to:',
    '',
  ];

  // Group agents by team
  for (const [teamName, agentNames] of Object.entries(registry.teams) as [string, string[]][]) {
    const teamAgents = agentNames
      .map((name: string) => registry.agents[name])
      .filter((a): a is AgentEntry => a != null);

    if (teamAgents.length === 0) continue;

    lines.push(`### ${teamName.charAt(0).toUpperCase() + teamName.slice(1)} Team`);

    for (const agent of teamAgents) {
      const caps = agent.capabilities.length > 0
        ? ` (${agent.capabilities.slice(0, 3).join(', ')})`
        : '';
      lines.push(`- **${agent.name}**: ${agent.description.slice(0, 120)}${caps}`);
    }

    lines.push('');
  }

  // Add standalone agents (no team)
  const standalone = (Object.values(registry.agents) as AgentEntry[]).filter(
    (a: AgentEntry) => !a.team && a.name !== 'omega',
  );
  if (standalone.length > 0) {
    lines.push('### Standalone Agents');
    for (const agent of standalone) {
      lines.push(`- **${agent.name}**: ${agent.description.slice(0, 120)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Connected Systems ─────────────────────────────────────────────────────

function buildConnectedSystems(): string {
  return [
    '## Connected Systems',
    '- Banking data via Mercury MCP (accounts, balances, transactions, treasury)',
    '- Revenue and payment data via Stripe MCP (subscriptions, invoices)',
    '- Project tracking via Linear (issues, sprints, milestones)',
    '- Infrastructure on Cloudflare: Workers, D1, R2, KV, AI Gateway',
    '- Activity log: recent interactions and MCP calls visible via /logs',
  ].join('\n');
}

// ── Operating Rules ───────────────────────────────────────────────────────

function buildOperatingRules(): string {
  return [
    '## How to Operate',
    '- Lead with the answer when you have it, context when you don\'t',
    '- Be concise — this is Telegram, not an essay',
    '- When the user asks about something you have agents or tools for, mention them',
    '- When something doesn\'t exist yet, say so honestly and suggest what could be built',
    '- Match the user\'s energy and communication style',
    '- Never fabricate data. If you don\'t have real information, say exactly that',
    '- When delegating to an agent, tell the user which team/agent is handling it',
  ].join('\n');
}


