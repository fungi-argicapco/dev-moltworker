/**
 * Security Sweep — Proactive scheduled security checks
 *
 * Runs on multiple cron frequencies:
 *   - Every 15 min: request anomaly detection
 *   - Hourly: Telegram webhook integrity
 *   - Every 4h: CF API token liveness
 *
 * Pushes P0/P1 alerts to Telegram. All results stored in KV audit log.
 */

import type { MoltbotEnv } from '../types';

// ============================================================================
// Types
// ============================================================================

export type Severity = 'P0' | 'P1' | 'P2' | 'PASS';

export interface CheckResult {
  check: string;
  severity: Severity;
  score: number; // 0-100
  detail: string;
  timestamp: string;
}

export interface SweepResult {
  cron: string;
  compositeScore: number;
  checks: CheckResult[];
  timestamp: string;
  alertsSent: number;
}

const SEVERITY_SCORES: Record<Severity, number> = {
  P0: 0,
  P1: 50,
  P2: 85,
  PASS: 100,
};

// ============================================================================
// Telegram Alert Push
// ============================================================================

const ALERT_CHAT_ID = '8476535456'; // Joshua's Telegram user ID

async function sendTelegramAlert(
  botToken: string,
  result: CheckResult,
): Promise<void> {
  const severityEmoji: Record<Severity, string> = {
    P0: '🚨',
    P1: '⚠️',
    P2: 'ℹ️',
    PASS: '✅',
  };

  const text = [
    `${severityEmoji[result.severity]} **SECURITY ALERT — ${result.severity}**`,
    '━━━━━━━━━━━━━━━━━━━━━━━',
    `**Check:** ${result.check}`,
    `**Status:** ${result.severity === 'PASS' ? 'OK' : 'FAILED'}`,
    `**Detail:** ${result.detail}`,
    `**Time:** ${new Date(result.timestamp).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })}`,
    '━━━━━━━━━━━━━━━━━━━━━━━',
    result.severity === 'P0' ? '🔴 Immediate action required.' : 'Use /security for full sweep details.',
  ].join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: ALERT_CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch (err) {
    console.error('[SecuritySweep] Failed to send Telegram alert:', err);
  }
}

// ============================================================================
// Check: Webhook Integrity (Hourly)
// ============================================================================

async function checkWebhookIntegrity(env: MoltbotEnv): Promise<CheckResult> {
  const now = new Date().toISOString();
  const botToken = env.HARDSHELL_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return {
      check: 'Webhook Integrity',
      severity: 'P0',
      score: 0,
      detail: 'No bot token configured — cannot verify webhook.',
      timestamp: now,
    };
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    const data = (await resp.json()) as {
      ok: boolean;
      result: {
        url: string;
        has_custom_certificate: boolean;
        pending_update_count: number;
        last_error_date?: number;
        last_error_message?: string;
        max_connections?: number;
      };
    };

    if (!data.ok) {
      return {
        check: 'Webhook Integrity',
        severity: 'P0',
        score: 0,
        detail: 'Telegram API returned error for getWebhookInfo.',
        timestamp: now,
      };
    }

    const info = data.result;
    const issues: string[] = [];

    // Check 1: URL is set and points to our worker
    if (!info.url) {
      return {
        check: 'Webhook Integrity',
        severity: 'P0',
        score: 0,
        detail: 'No webhook URL set — bot is deaf. Needs /set-webhook.',
        timestamp: now,
      };
    }

    if (!info.url.includes('hardshell') && !info.url.includes('jfischburg')) {
      issues.push(`URL points to unknown endpoint: ${info.url}`);
    }

    // Check 2: Recent errors
    if (info.last_error_date) {
      const errorAge = Date.now() / 1000 - info.last_error_date;
      if (errorAge < 3600) {
        // Error in last hour
        issues.push(`Recent error (${Math.round(errorAge / 60)}m ago): ${info.last_error_message || 'unknown'}`);
      }
    }

    // Check 3: Pending updates piling up (webhook not processing)
    if (info.pending_update_count > 10) {
      issues.push(`${info.pending_update_count} pending updates — webhook may be stuck.`);
    }

    if (issues.length === 0) {
      return {
        check: 'Webhook Integrity',
        severity: 'PASS',
        score: 100,
        detail: `Webhook active: ${info.url.split('/').slice(-2).join('/')} — ${info.pending_update_count} pending.`,
        timestamp: now,
      };
    }

    const severity: Severity = issues.some((i) => i.includes('unknown endpoint') || i.includes('No webhook')) ? 'P0' : 'P1';
    return {
      check: 'Webhook Integrity',
      severity,
      score: SEVERITY_SCORES[severity],
      detail: issues.join(' | '),
      timestamp: now,
    };
  } catch (err) {
    return {
      check: 'Webhook Integrity',
      severity: 'P0',
      score: 0,
      detail: `Network error checking webhook: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: now,
    };
  }
}

// ============================================================================
// Check: API Token Liveness (Every 4h)
// ============================================================================

async function checkTokenLiveness(env: MoltbotEnv): Promise<CheckResult> {
  const now = new Date().toISOString();
  const apiKey = env.CLOUDFLARE_AI_GATEWAY_API_KEY;
  const accountId = env.CF_AI_GATEWAY_ACCOUNT_ID;

  if (!apiKey) {
    return {
      check: 'API Token Liveness',
      severity: 'P1',
      score: 50,
      detail: 'No CLOUDFLARE_AI_GATEWAY_API_KEY configured.',
      timestamp: now,
    };
  }

  try {
    // Verify token is alive via CF API
    const resp = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = (await resp.json()) as {
      success: boolean;
      result?: { status: string; expires_on?: string };
      errors?: Array<{ message: string }>;
    };

    if (!data.success || !data.result) {
      return {
        check: 'API Token Liveness',
        severity: 'P0',
        score: 0,
        detail: `Token verification failed: ${data.errors?.[0]?.message || 'Unknown error'}. AI Gateway is down.`,
        timestamp: now,
      };
    }

    const { status, expires_on } = data.result;

    if (status !== 'active') {
      return {
        check: 'API Token Liveness',
        severity: 'P0',
        score: 0,
        detail: `Token status: ${status}. All AI calls will fail.`,
        timestamp: now,
      };
    }

    // Check expiry proximity
    if (expires_on) {
      const daysToExpiry = (new Date(expires_on).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysToExpiry <= 0) {
        return {
          check: 'API Token Liveness',
          severity: 'P0',
          score: 0,
          detail: `Token EXPIRED on ${expires_on}. All AI calls failing.`,
          timestamp: now,
        };
      }
      if (daysToExpiry < 7) {
        return {
          check: 'API Token Liveness',
          severity: 'P1',
          score: 50,
          detail: `Token expires in ${Math.round(daysToExpiry)} days (${expires_on}). Rotation needed.`,
          timestamp: now,
        };
      }
      if (daysToExpiry < 30) {
        return {
          check: 'API Token Liveness',
          severity: 'P2',
          score: 85,
          detail: `Token expires in ${Math.round(daysToExpiry)} days. Plan rotation.`,
          timestamp: now,
        };
      }
    }

    // Also verify account access if we have account ID
    if (accountId) {
      try {
        const acctResp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const acctData = (await acctResp.json()) as { success: boolean };
        if (!acctData.success) {
          return {
            check: 'API Token Liveness',
            severity: 'P1',
            score: 50,
            detail: `Token active but cannot access account ${accountId}. Permission issue.`,
            timestamp: now,
          };
        }
      } catch {
        // Non-critical — token itself is verified
      }
    }

    return {
      check: 'API Token Liveness',
      severity: 'PASS',
      score: 100,
      detail: `Token active${expires_on ? `, expires ${expires_on}` : ', no expiration'}.`,
      timestamp: now,
    };
  } catch (err) {
    return {
      check: 'API Token Liveness',
      severity: 'P1',
      score: 50,
      detail: `Network error verifying token: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: now,
    };
  }
}

// ============================================================================
// Check: Request Anomaly (Every 15 min)
// ============================================================================

async function checkRequestAnomalies(env: MoltbotEnv): Promise<CheckResult> {
  const now = new Date().toISOString();
  const kv = env.OMEGA_PROFILES;

  if (!kv) {
    return {
      check: 'Request Anomaly',
      severity: 'P2',
      score: 85,
      detail: 'KV not available — cannot track request patterns.',
      timestamp: now,
    };
  }

  try {
    // Get the last 15-min request count from KV
    const currentWindow = `security:requests:${Math.floor(Date.now() / (15 * 60 * 1000))}`;
    const prevWindow = `security:requests:${Math.floor(Date.now() / (15 * 60 * 1000)) - 1}`;
    const baselineKey = 'security:requests:baseline';

    const [currentRaw, prevRaw, baselineRaw] = await Promise.all([
      kv.get(currentWindow),
      kv.get(prevWindow),
      kv.get(baselineKey),
    ]);

    const current = parseInt(currentRaw || '0', 10);
    const prev = parseInt(prevRaw || '0', 10);
    const baseline = parseInt(baselineRaw || '0', 10);

    // Update baseline (rolling average)
    if (prev > 0 && baseline === 0) {
      await kv.put(baselineKey, String(prev), { expirationTtl: 86400 * 7 });
    } else if (prev > 0 && baseline > 0) {
      const newBaseline = Math.round((baseline * 0.9) + (prev * 0.1));
      await kv.put(baselineKey, String(newBaseline), { expirationTtl: 86400 * 7 });
    }

    // If we have a baseline, check for anomalies
    if (baseline > 5 && current > baseline * 3) {
      return {
        check: 'Request Anomaly',
        severity: 'P1',
        score: 50,
        detail: `Spike detected: ${current} requests in 15min (baseline: ${baseline}). Possible attack or abuse.`,
        timestamp: now,
      };
    }

    return {
      check: 'Request Anomaly',
      severity: 'PASS',
      score: 100,
      detail: `Normal: ${current} requests in current window (baseline: ${baseline || 'building'}).`,
      timestamp: now,
    };
  } catch (err) {
    return {
      check: 'Request Anomaly',
      severity: 'P2',
      score: 85,
      detail: `Error checking anomalies: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: now,
    };
  }
}

// ============================================================================
// Orchestrator
// ============================================================================

/**
 * Increment the request counter for anomaly detection.
 * Call this from the webhook handler on every request.
 */
export async function incrementRequestCounter(kv: KVNamespace): Promise<void> {
  const windowKey = `security:requests:${Math.floor(Date.now() / (15 * 60 * 1000))}`;
  const current = parseInt((await kv.get(windowKey)) || '0', 10);
  await kv.put(windowKey, String(current + 1), { expirationTtl: 3600 });
}

/**
 * Run the security sweep for the given cron schedule.
 * Routes to the appropriate checks based on the cron expression.
 */
export async function runSecuritySweep(cron: string, env: MoltbotEnv): Promise<SweepResult> {
  const checks: CheckResult[] = [];
  const botToken = env.HARDSHELL_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;

  // Route checks based on which cron triggered
  if (cron === '*/15 * * * *') {
    // Every 15 min: anomaly check only
    checks.push(await checkRequestAnomalies(env));
  } else if (cron === '0 * * * *') {
    // Hourly: webhook integrity
    checks.push(await checkWebhookIntegrity(env));
  } else if (cron === '0 */4 * * *') {
    // Every 4h: token liveness + webhook (full sweep)
    checks.push(await checkWebhookIntegrity(env));
    checks.push(await checkTokenLiveness(env));
  } else {
    // For any other cron (like 6h backup), run a light check
    checks.push(await checkWebhookIntegrity(env));
  }

  // Calculate composite score
  const compositeScore = checks.length > 0
    ? Math.round(checks.reduce((sum, c) => sum + c.score, 0) / checks.length)
    : 100;

  // Send alerts for P0/P1
  let alertsSent = 0;
  if (botToken) {
    for (const check of checks) {
      if (check.severity === 'P0' || check.severity === 'P1') {
        await sendTelegramAlert(botToken, check);
        alertsSent++;
      }
    }
  }

  const result: SweepResult = {
    cron,
    compositeScore,
    checks,
    timestamp: new Date().toISOString(),
    alertsSent,
  };

  // Store audit log in KV
  const kv = env.OMEGA_PROFILES;
  if (kv) {
    const auditKey = `security:sweep:${Date.now()}`;
    await kv.put(auditKey, JSON.stringify(result), {
      expirationTtl: 86400 * 30, // 30-day retention
    });
    // Also store as "latest" for /security command
    await kv.put('security:sweep:latest', JSON.stringify(result));
  }

  // Log sweep result
  const status = compositeScore >= 90 ? '✅ HEALTHY' : compositeScore >= 50 ? '⚠️ DEGRADED' : '🚨 CRITICAL';
  console.log(`[SecuritySweep] ${status} Score: ${compositeScore}/100 (${checks.length} checks, ${alertsSent} alerts sent)`);

  return result;
}

/**
 * Get the latest sweep result for /security command.
 */
export async function getLatestSweep(kv: KVNamespace): Promise<SweepResult | null> {
  return kv.get('security:sweep:latest', 'json');
}

/**
 * Format sweep result for Telegram display.
 */
export function formatSweepForTelegram(sweep: SweepResult): string {
  const statusEmoji = sweep.compositeScore >= 90 ? '✅' : sweep.compositeScore >= 50 ? '⚠️' : '🚨';
  const statusText = sweep.compositeScore >= 90 ? 'HEALTHY' : sweep.compositeScore >= 50 ? 'DEGRADED' : 'CRITICAL';

  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
    hour12: true,
  });

  const lines = [
    `${statusEmoji} **Security Status: ${statusText}**`,
    `Score: **${sweep.compositeScore}/100**`,
    `Last sweep: ${formatter.format(new Date(sweep.timestamp))}`,
    '',
  ];

  for (const check of sweep.checks) {
    const emoji = check.severity === 'PASS' ? '✅' : check.severity === 'P2' ? 'ℹ️' : check.severity === 'P1' ? '⚠️' : '🚨';
    lines.push(`${emoji} **${check.check}** (${check.severity})`);
    lines.push(`   ${check.detail}`);
  }

  lines.push('');
  lines.push(`_Cron: ${sweep.cron} | Alerts sent: ${sweep.alertsSent}_`);

  return lines.join('\n');
}
