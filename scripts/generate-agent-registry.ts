/**
 * Agent Registry Generator — Build-time SKILL.md scanner
 *
 * Scans agents/SKILL.md files, parses YAML frontmatter,
 * and emits a JSON registry that gets bundled into the Worker.
 *
 * Run: bun run scripts/generate-agent-registry.ts
 * Output: src/generated/agent-registry.json
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

interface AgentEntry {
  name: string;
  model_tier: string;
  description: string;
  team?: string;
  capabilities: string[];
  tools: string[];
}

interface AgentRegistry {
  version: string;
  generated: string;
  agents: Record<string, AgentEntry>;
  teams: Record<string, string[]>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const AGENTS_DIR = join(ROOT, 'agents');
const OUTPUT_DIR = join(ROOT, 'src', 'generated');
const OUTPUT_FILE = join(OUTPUT_DIR, 'agent-registry.json');
const ORCHESTRATION_FILE = join(ROOT, 'config', 'agent-orchestration.json');

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Simple parser — handles name, model_tier, description.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

/**
 * Extract capabilities from markdown body.
 * Looks for numbered items under "Capabilities" or "Core Capabilities" headings.
 */
function extractCapabilities(content: string): string[] {
  const capabilities: string[] = [];

  // Find capabilities section
  const capMatch = content.match(
    /###?\s*(?:Core\s+)?Capabilities\s*\n([\s\S]*?)(?=\n###?\s|\n---|\n##\s|$)/i,
  );
  if (!capMatch) return capabilities;

  // Extract numbered or bulleted items
  const lines = capMatch[1].split('\n');
  for (const line of lines) {
    const itemMatch = line.match(/^\d+\.\s+\*\*(.+?)\*\*|^[-*]\s+\*\*(.+?)\*\*/);
    if (itemMatch) {
      capabilities.push(itemMatch[1] || itemMatch[2]);
    }
  }

  return capabilities;
}

/**
 * Extract MCP tools from markdown body.
 * Looks for tool names in table rows under "Tools" headings.
 */
function extractTools(content: string): string[] {
  const tools: string[] = [];

  // Find tools table
  const toolMatch = content.match(
    /###?\s*(?:Mercury\s+)?(?:MCP\s+)?Tools?\s*\n([\s\S]*?)(?=\n###?\s|\n---|\n##\s|$)/i,
  );
  if (!toolMatch) return tools;

  // Extract from table rows: | `toolName` | ...
  const lines = toolMatch[1].split('\n');
  for (const line of lines) {
    const cellMatch = line.match(/\|\s*`?(\w+)`?\s*\|/);
    if (cellMatch && cellMatch[1] !== 'Tool' && cellMatch[1] !== '---') {
      tools.push(cellMatch[1]);
    }
  }

  return tools;
}

/**
 * Load team assignments from agent-orchestration.json
 */
async function loadTeamMap(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(ORCHESTRATION_FILE, 'utf8');
    const orchestration = JSON.parse(raw);
    const map: Record<string, string> = {};

    for (const [teamName, team] of Object.entries(orchestration.teams)) {
      const t = team as { orchestrator?: string; members: string[] };
      if (t.orchestrator) map[t.orchestrator] = teamName;
      for (const member of t.members) map[member] = teamName;
    }

    return map;
  } catch {
    return {};
  }
}

async function main() {
  console.log('🔍 Scanning agents/*/SKILL.md ...');

  const teamMap = await loadTeamMap();
  const agents: Record<string, AgentEntry> = {};
  const teams: Record<string, string[]> = {};

  const entries = await readdir(AGENTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(AGENTS_DIR, entry.name, 'SKILL.md');
    try {
      const content = await readFile(skillPath, 'utf8');
      const frontmatter = parseFrontmatter(content);

      if (!frontmatter.name) {
        console.warn(`  ⚠ ${entry.name}/SKILL.md: no name in frontmatter, skipping`);
        continue;
      }

      const capabilities = extractCapabilities(content);
      const tools = extractTools(content);
      const team = teamMap[frontmatter.name] || undefined;

      agents[frontmatter.name] = {
        name: frontmatter.name,
        model_tier: frontmatter.model_tier || 'free',
        description: frontmatter.description || '',
        team,
        capabilities,
        tools,
      };

      // Build team index
      if (team) {
        if (!teams[team]) teams[team] = [];
        teams[team].push(frontmatter.name);
      }

      console.log(
        `  ✓ ${frontmatter.name} (${frontmatter.model_tier || 'free'}) — ${capabilities.length} capabilities, ${tools.length} tools`,
      );
    } catch {
      // No SKILL.md — skip silently
    }
  }

  const registry: AgentRegistry = {
    version: '1.0',
    generated: new Date().toISOString(),
    agents,
    teams,
  };

  // Ensure output directory exists
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(registry, null, 2));

  console.log(
    `\n✅ Registry generated: ${Object.keys(agents).length} agents, ${Object.keys(teams).length} teams`,
  );
  console.log(`   → ${OUTPUT_FILE}`);
}

main().catch(console.error);
