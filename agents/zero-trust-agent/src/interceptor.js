'use strict';

/**
 * interceptor.js — Zero Trust Agent · Phase 1
 * ─────────────────────────────────────────────
 * Main orchestrator for the Zero Trust validation pipeline.
 *
 * Flow:
 *   1. Load all 6 tokens from TokenVault (D1)
 *   2. Validate each token via Cloudflare API (cf-validator)
 *   3. Run anomaly detection rules against results
 *   4. Log full run to D1 (audit_log + validation_runs)
 *   5. Return structured ValidationResult
 *
 * Usage:
 *   const interceptor = require('./interceptor');
 *   const result = await interceptor.validateAll('manual');
 *
 * CLI:
 *   node interceptor.js [trigger]    (trigger defaults to 'manual')
 *
 * Environment variables required:
 *   ENCRYPTION_KEY   — 64-char hex (AES-256-GCM key)
 *   CF_ACCOUNT_ID    — Cloudflare Account ID
 *   CF_D1_TOKEN      — D1 API token
 *   CF_D1_DB_ID      — D1 database ID for crm-db
 */

// Late-bound requires — allows test mocking via module cache patching
function tokenVault()   { return require('./token-vault'); }
function cfValidatorMod() { return require('./cf-validator'); }
function d1Client()     { return require('./d1-client'); }

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICES = ['workers', 'd1', 'stream', 'r2', 'pages', 'firewall'];

const VALID_TRIGGERS = new Set(['manual', 'scheduled', 'webhook', 'startup', 'test']);

// Anomaly thresholds (seconds)
const EXPIRY_WARN_SECS  = 7  * 24 * 3600;  // 7 days  → P1/WARN
const EXPIRY_LOG_SECS   = 30 * 24 * 3600;  // 30 days → P2/LOG

// Score weights: each service worth equal share of 100
const PER_SERVICE_SCORE = 100 / SERVICES.length;

// ─── Anomaly Detection ────────────────────────────────────────────────────────

/**
 * Analyse a single CF validation result + vault record for anomalies.
 *
 * @param {object} cfResult  — From cf-validator.validateService()
 * @param {object} vaultRec  — From token-vault.listTokens() (sanitized record)
 * @returns {AnomalyReport[]}
 */
function detectAnomalies(cfResult, vaultRec) {
  const anomalies = [];
  const now = Date.now();

  // ── Rule 1: Token invalid / unreachable ──────────────────────────────────
  if (!cfResult.valid) {
    anomalies.push({
      rule:        'TOKEN_INVALID',
      priority:    'P0',
      action:      'HALT',
      severity:    'CRITICAL',
      message:     `Token for '${cfResult.service}' failed CF API validation: ${cfResult.error || 'unknown'}`,
    });
  }

  // ── Rule 2: Token explicitly expired in vault ─────────────────────────────
  if (vaultRec?.status === 'expired') {
    anomalies.push({
      rule:        'TOKEN_EXPIRED_STATUS',
      priority:    'P0',
      action:      'HALT',
      severity:    'CRITICAL',
      message:     `Token for '${cfResult.service}' has status=expired in vault`,
    });
  }

  // ── Rule 3: expires_at window checks (use cfResult.expiresIn if available,
  //            fall back to vault expires_at) ─────────────────────────────────
  const expiresInSecs = resolveExpiresIn(cfResult, vaultRec);

  if (expiresInSecs !== null) {
    if (expiresInSecs <= 0) {
      anomalies.push({
        rule:        'TOKEN_EXPIRED',
        priority:    'P0',
        action:      'HALT',
        severity:    'CRITICAL',
        message:     `Token for '${cfResult.service}' has expired (${formatExpiry(expiresInSecs)})`,
      });
    } else if (expiresInSecs <= EXPIRY_WARN_SECS) {
      anomalies.push({
        rule:        'TOKEN_EXPIRY_SOON',
        priority:    'P1',
        action:      'WARN',
        severity:    'WARN',
        message:     `Token for '${cfResult.service}' expires in ${formatDuration(expiresInSecs)} — rotate immediately`,
      });
    } else if (expiresInSecs <= EXPIRY_LOG_SECS) {
      anomalies.push({
        rule:        'TOKEN_EXPIRY_UPCOMING',
        priority:    'P2',
        action:      'LOG',
        severity:    'INFO',
        message:     `Token for '${cfResult.service}' expires in ${formatDuration(expiresInSecs)} — plan rotation`,
      });
    }
  }

  // ── Rule 4: Scope mismatch detected by cf-validator ──────────────────────
  if (cfResult.valid && cfResult.error && cfResult.error.includes('Scope mismatch')) {
    anomalies.push({
      rule:        'SCOPE_MISMATCH',
      priority:    'P1',
      action:      'WARN',
      severity:    'WARN',
      message:     cfResult.error,
    });
  }

  return anomalies;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Compute a 0–100 composite trust score.
 * Full score for valid+no anomalies. Deductions per anomaly priority.
 *
 * @param {ServiceAudit[]} audits
 * @returns {number}
 */
function computeScore(audits) {
  let totalScore = 0;

  for (const audit of audits) {
    let serviceScore = PER_SERVICE_SCORE;

    if (!audit.cfResult.valid) {
      serviceScore = 0; // Invalid = total loss for this service
    } else {
      for (const anomaly of audit.anomalies) {
        switch (anomaly.priority) {
          case 'P0': serviceScore  = 0;                          break;
          case 'P1': serviceScore -= PER_SERVICE_SCORE * 0.5;   break;
          case 'P2': serviceScore -= PER_SERVICE_SCORE * 0.15;  break;
        }
      }
      serviceScore = Math.max(0, serviceScore);
    }

    totalScore += serviceScore;
  }

  return Math.round(Math.max(0, Math.min(100, totalScore)) * 10) / 10;
}

/**
 * Derive a human-readable recommendation from the audit results.
 *
 * @param {ServiceAudit[]} audits
 * @param {number} score
 * @returns {string}
 */
function buildRecommendation(audits, score) {
  const haltServices = audits
    .filter(a => a.anomalies.some(x => x.action === 'HALT'))
    .map(a => a.service);

  const warnServices = audits
    .filter(a => a.anomalies.some(x => x.action === 'WARN'))
    .map(a => a.service);

  if (haltServices.length > 0) {
    return `HALT — ${haltServices.length} service(s) require immediate attention: ${haltServices.join(', ')}. ` +
           `Rotate or re-issue affected tokens before resuming operations.`;
  }
  if (warnServices.length > 0) {
    return `WARN — Token rotation needed for: ${warnServices.join(', ')}. ` +
           `Score: ${score}/100. Monitor closely and rotate within 7 days.`;
  }
  if (score >= 90) {
    return `OK — All tokens valid. Score: ${score}/100. Next sweep recommended in 24h.`;
  }
  return `DEGRADED — Score ${score}/100. Review audit log for details.`;
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

/**
 * Run a full validation sweep across all 6 services.
 *
 * @param {string} trigger — manual|scheduled|webhook|startup|test
 * @returns {Promise<ValidationResult>}
 */
async function validateAll(trigger = 'manual') {
  if (!VALID_TRIGGERS.has(trigger)) {
    throw new Error(`Invalid trigger '${trigger}'. Must be one of: ${[...VALID_TRIGGERS].join(', ')}`);
  }

  const runStarted = new Date().toISOString();
  console.log(`\n[Interceptor] ═══ Zero Trust Validation Sweep ═══`);
  console.log(`[Interceptor] Trigger: ${trigger} | Started: ${runStarted}`);

  // ── Step 1: Create validation_run record ─────────────────────────────────
  const runId = await createValidationRun(trigger, runStarted);
  console.log(`[Interceptor] Run ID: ${runId}`);

  // ── Step 2: Load tokens from vault ───────────────────────────────────────
  console.log(`[Interceptor] Loading tokens from vault...`);
  const tokenMap = {};
  const vaultMap = {};
  const { listTokens, getToken, touchValidatedAt, markTokenExpired } = tokenVault();

  const vaultTokens = await listTokens().catch(err => {
    console.warn(`[Interceptor] Could not list vault tokens: ${err.message}`);
    return [];
  });

  // Index vault records by service for quick lookup
  for (const rec of vaultTokens) {
    vaultMap[rec.service] = rec;
  }

  for (const service of SERVICES) {
    try {
      const { plaintext, record } = await getToken(service);
      tokenMap[service] = {
        plaintext,
        expectedScopes: record.scope_json || [],
      };
      console.log(`[Interceptor]   ✓ Loaded token: ${service}`);
    } catch (err) {
      console.warn(`[Interceptor]   ✗ Failed to load token for ${service}: ${err.message}`);
      tokenMap[service] = null;
    }
  }

  // ── Step 3: Validate via CF API ───────────────────────────────────────────
  console.log(`[Interceptor] Validating tokens against Cloudflare API...`);
  const validationMap = {};
  const { validateAll: cfValidateAll } = cfValidatorMod();

  // Build map of service → { plaintext, expectedScopes } (skip nulls)
  const cfInputMap = {};
  for (const service of SERVICES) {
    if (tokenMap[service]) cfInputMap[service] = tokenMap[service];
  }

  const cfResults = await cfValidateAll(cfInputMap);

  for (const result of cfResults) {
    validationMap[result.service] = result;
    const icon = result.valid ? '✓' : '✗';
    console.log(`[Interceptor]   ${icon} ${result.service}: ${result.valid ? 'valid' : result.error}`);
  }

  // ── Step 4: Anomaly detection ─────────────────────────────────────────────
  console.log(`[Interceptor] Running anomaly detection...`);
  const audits = [];

  for (const service of SERVICES) {
    const cfResult  = validationMap[service] || { service, valid: false, error: 'No CF result', scopes: [], expiresIn: null, latencyMs: 0 };
    const vaultRec  = vaultMap[service]       || null;
    const anomalies = detectAnomalies(cfResult, vaultRec);

    if (anomalies.length > 0) {
      for (const a of anomalies) {
        console.warn(`[Interceptor]   [${a.priority}/${a.action}] ${service}: ${a.message}`);
      }
    }

    audits.push({ service, cfResult, vaultRec, anomalies });

    // Side effect: mark expired tokens in vault
    if (anomalies.some(a => a.rule === 'TOKEN_EXPIRED')) {
      await markTokenExpired(service).catch(() => {});
    }
    // Update last_validated_at for valid tokens
    if (cfResult.valid) {
      await touchValidatedAt(service).catch(() => {});
    }
  }

  // ── Step 5: Scoring + recommendation ─────────────────────────────────────
  const score          = computeScore(audits);
  const recommendation = buildRecommendation(audits, score);

  console.log(`[Interceptor] Score: ${score}/100`);
  console.log(`[Interceptor] Recommendation: ${recommendation}`);

  // ── Step 6: Tally stats ───────────────────────────────────────────────────
  const tokensChecked = SERVICES.length;
  const tokensValid   = audits.filter(a => a.cfResult.valid && a.anomalies.length === 0).length;
  const tokensWarned  = audits.filter(a => a.cfResult.valid && a.anomalies.some(x => x.action === 'WARN')).length;
  const tokensFailed  = audits.filter(a => !a.cfResult.valid || a.anomalies.some(x => x.action === 'HALT')).length;

  // ── Step 7: Build result objects ──────────────────────────────────────────
  const results = audits.map(a => ({
    service:    a.service,
    valid:      a.cfResult.valid,
    status:     a.cfResult.status,
    scopes:     a.cfResult.scopes,
    expiresIn:  a.cfResult.expiresIn,
    latencyMs:  a.cfResult.latencyMs,
    anomalies:  a.anomalies,
    error:      a.cfResult.error,
  }));

  const completedAt = new Date().toISOString();
  const summaryJson = JSON.stringify({ results, score, recommendation });

  // ── Step 8: Persist to D1 ────────────────────────────────────────────────
  await finalizeValidationRun(runId, completedAt, {
    tokensChecked, tokensValid, tokensWarned, tokensFailed,
    score, summaryJson,
  }).catch(err => console.warn(`[Interceptor] Failed to finalize run: ${err.message}`));

  await writeAuditLog(runId, trigger, audits, score)
    .catch(err => console.warn(`[Interceptor] Failed to write audit log: ${err.message}`));

  // ── Step 9: Return ValidationResult ──────────────────────────────────────
  const validationResult = {
    valid:          tokensFailed === 0,
    results,
    score,
    runId,
    recommendation,
    startedAt:      runStarted,
    completedAt,
    tokensChecked,
    tokensValid,
    tokensWarned,
    tokensFailed,
  };

  console.log(`[Interceptor] ═══ Sweep Complete ═══\n`);
  return validationResult;
}

// ─── D1 Persistence ───────────────────────────────────────────────────────────

async function createValidationRun(trigger, startedAt) {
  const id = generateId();
  const { d1Execute } = d1Client();
  await d1Execute(
    `INSERT INTO validation_runs (id, started_at, trigger, tokens_checked, tokens_valid, tokens_warned, tokens_failed, overall_score, summary_json)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, '{}')`,
    [id, startedAt, trigger]
  );
  return id;
}

async function finalizeValidationRun(runId, completedAt, stats) {
  const { d1Execute } = d1Client();
  await d1Execute(
    `UPDATE validation_runs
     SET completed_at = ?, tokens_checked = ?, tokens_valid = ?, tokens_warned = ?,
         tokens_failed = ?, overall_score = ?, summary_json = ?
     WHERE id = ?`,
    [
      completedAt,
      stats.tokensChecked, stats.tokensValid, stats.tokensWarned, stats.tokensFailed,
      stats.score, stats.summaryJson,
      runId,
    ]
  );
}

async function writeAuditLog(runId, trigger, audits, score) {
  const { d1Execute } = d1Client();
  for (const audit of audits) {
    const hasHalt = audit.anomalies.some(a => a.action === 'HALT');
    const hasWarn = audit.anomalies.some(a => a.action === 'WARN');

    const result   = hasHalt ? 'halt' : hasWarn ? 'warn' : audit.cfResult.valid ? 'ok' : 'fail';
    const severity = hasHalt ? 'CRITICAL' : hasWarn ? 'WARN' : audit.cfResult.valid ? 'INFO' : 'ERROR';

    await d1Execute(
      `INSERT INTO audit_log (agent_id, action, service, result, severity, detail_json, linear_issue)
       VALUES ('zero-trust-agent', 'validate', ?, ?, ?, ?, NULL)`,
      [
        audit.service,
        result,
        severity,
        JSON.stringify({
          runId,
          trigger,
          valid:     audit.cfResult.valid,
          status:    audit.cfResult.status,
          anomalies: audit.anomalies,
          error:     audit.cfResult.error,
          latencyMs: audit.cfResult.latencyMs,
        }),
      ]
    ).catch(() => {}); // Non-fatal: log failure shouldn't abort the run
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function generateId() {
  // Simple UUID-like hex ID without crypto dependency
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${rand()}${rand()}${rand()}${rand()}`;
}

function resolveExpiresIn(cfResult, vaultRec) {
  // Prefer live CF API data
  if (cfResult.expiresIn !== null && cfResult.expiresIn !== undefined) {
    return cfResult.expiresIn;
  }
  // Fall back to vault expires_at
  if (vaultRec?.expires_at) {
    const expiryMs = new Date(vaultRec.expires_at).getTime();
    if (isNaN(expiryMs)) return null;
    return Math.floor((expiryMs - Date.now()) / 1000);
  }
  return null;
}

function formatExpiry(secs) {
  if (secs <= 0) return 'expired';
  return `expires in ${formatDuration(secs)}`;
}

function formatDuration(secs) {
  if (secs < 60)        return `${secs}s`;
  if (secs < 3600)      return `${Math.floor(secs / 60)}m`;
  if (secs < 86400)     return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

if (require.main === module) {
  const trigger = process.argv[2] || 'manual';

  validateAll(trigger)
    .then(result => {
      console.log('\n[Interceptor] Result summary:');
      console.log(`  Score:          ${result.score}/100`);
      console.log(`  Valid:          ${result.valid}`);
      console.log(`  Tokens checked: ${result.tokensChecked}`);
      console.log(`  Tokens valid:   ${result.tokensValid}`);
      console.log(`  Tokens warned:  ${result.tokensWarned}`);
      console.log(`  Tokens failed:  ${result.tokensFailed}`);
      console.log(`  Recommendation: ${result.recommendation}`);
      console.log(`  Run ID:         ${result.runId}`);
      process.exit(result.valid ? 0 : 1);
    })
    .catch(err => {
      console.error(`[Interceptor] Fatal error: ${err.message}`);
      console.error(err.stack);
      process.exit(2);
    });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  validateAll,
  detectAnomalies,
  computeScore,
  buildRecommendation,
  // Exposed for testing
  _resolveExpiresIn: resolveExpiresIn,
  _formatDuration:   formatDuration,
  _generateId:       generateId,
};
