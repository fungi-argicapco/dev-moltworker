/**
 * Agent Registry Types — Shared between build script and runtime
 */

export interface AgentEntry {
  name: string;
  model_tier: string;
  description: string;
  team?: string;
  capabilities: string[];
  tools: string[];
}

export interface AgentRegistry {
  version: string;
  generated: string;
  agents: Record<string, AgentEntry>;
  teams: Record<string, string[]>;
}
