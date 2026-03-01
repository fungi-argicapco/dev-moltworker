/**
 * Omega Activity Log — Persistent activity tracking
 *
 * Stores a rolling log of Omega interactions and MCP calls in KV.
 * Queryable via /logs Telegram command and admin API.
 *
 * Storage strategy: KV with a rolling window of recent entries.
 * Key: activity:log → JSON array of last N entries (capped at 200)
 * Key: activity:stats → aggregate stats
 */

import type { McpCallLog } from './mcp-client';

export interface ActivityEntry {
  /** Timestamp ISO */
  timestamp: string;
  /** Type of activity */
  type: 'chat' | 'mcp_call' | 'command' | 'error';
  /** Telegram user ID */
  userId?: number;
  /** Display name */
  userName?: string;
  /** Summary of what happened */
  summary: string;
  /** Latency in ms (for MCP calls) */
  latencyMs?: number;
  /** Status */
  status: 'ok' | 'error';
  /** Error message if any */
  error?: string;
}

export interface ActivityStats {
  totalInteractions: number;
  totalMcpCalls: number;
  totalErrors: number;
  lastActivity: string;
  mcpCallsByServer: Record<string, number>;
}

const LOG_KEY = 'activity:log';
const STATS_KEY = 'activity:stats';
const MAX_LOG_ENTRIES = 200;

/**
 * Append an activity entry to the rolling log.
 */
export async function logActivity(kv: KVNamespace, entry: ActivityEntry): Promise<void> {
  // Load existing log
  const existing = await kv.get(LOG_KEY, 'json') as ActivityEntry[] | null;
  const log = existing || [];

  // Prepend new entry (newest first)
  log.unshift(entry);

  // Cap at max entries
  if (log.length > MAX_LOG_ENTRIES) {
    log.length = MAX_LOG_ENTRIES;
  }

  await kv.put(LOG_KEY, JSON.stringify(log));

  // Update stats
  const stats = (await kv.get(STATS_KEY, 'json') as ActivityStats) || {
    totalInteractions: 0,
    totalMcpCalls: 0,
    totalErrors: 0,
    lastActivity: '',
    mcpCallsByServer: {},
  };

  stats.totalInteractions++;
  stats.lastActivity = entry.timestamp;
  if (entry.type === 'mcp_call') {
    stats.totalMcpCalls++;
    const server = entry.summary.split('/')[0] || 'unknown';
    stats.mcpCallsByServer[server] = (stats.mcpCallsByServer[server] || 0) + 1;
  }
  if (entry.status === 'error') {
    stats.totalErrors++;
  }

  await kv.put(STATS_KEY, JSON.stringify(stats));
}

/**
 * Log a chat interaction.
 */
export function chatEntry(userId: number, userName: string, message: string): ActivityEntry {
  return {
    timestamp: new Date().toISOString(),
    type: 'chat',
    userId,
    userName,
    summary: message.length > 100 ? message.slice(0, 100) + '...' : message,
    status: 'ok',
  };
}

/**
 * Log an MCP call from the structured call log.
 */
export function mcpEntry(callLog: McpCallLog): ActivityEntry {
  return {
    timestamp: callLog.timestamp,
    type: 'mcp_call',
    summary: `${callLog.server}/${callLog.tool}`,
    latencyMs: callLog.latencyMs,
    status: callLog.status,
    error: callLog.error,
  };
}

/**
 * Log a slash command usage.
 */
export function commandEntry(userId: number, userName: string, command: string): ActivityEntry {
  return {
    timestamp: new Date().toISOString(),
    type: 'command',
    userId,
    userName,
    summary: command,
    status: 'ok',
  };
}

/**
 * Get recent activity log entries.
 */
export async function getRecentActivity(
  kv: KVNamespace,
  limit: number = 20,
): Promise<ActivityEntry[]> {
  const log = await kv.get(LOG_KEY, 'json') as ActivityEntry[] | null;
  if (!log) return [];
  return log.slice(0, limit);
}

/**
 * Get activity stats.
 */
export async function getActivityStats(kv: KVNamespace): Promise<ActivityStats> {
  return (await kv.get(STATS_KEY, 'json') as ActivityStats) || {
    totalInteractions: 0,
    totalMcpCalls: 0,
    totalErrors: 0,
    lastActivity: 'never',
    mcpCallsByServer: {},
  };
}

/**
 * Format activity log for Telegram display.
 */
export function formatActivityForTelegram(
  entries: ActivityEntry[],
  stats: ActivityStats,
): string {
  const lines: string[] = [
    '📊 *Omega Activity Log*',
    '',
    `Total: ${stats.totalInteractions} interactions | ${stats.totalMcpCalls} MCP calls | ${stats.totalErrors} errors`,
    '',
    `*Last ${entries.length} events:*`,
  ];

  for (const entry of entries) {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
    });
    const icon = entry.type === 'chat' ? '💬'
      : entry.type === 'mcp_call' ? '🔌'
        : entry.type === 'command' ? '⌨️'
          : '❌';
    const statusIcon = entry.status === 'ok' ? '✓' : '✗';
    const latency = entry.latencyMs ? ` ${entry.latencyMs}ms` : '';
    const user = entry.userName ? ` [${entry.userName}]` : '';

    lines.push(`${icon} ${time} ${statusIcon}${user} ${entry.summary}${latency}`);
  }

  return lines.join('\n');
}
