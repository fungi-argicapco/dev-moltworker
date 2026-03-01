/**
 * worker.js — Zero Trust Agent · Cloudflare Worker Entry Point
 * ─────────────────────────────────────────────────────────────
 * Exposes the Zero Trust Agent as a CF Worker with:
 *   GET  /validate        — run a full validation sweep
 *   GET  /health          — quick health check
 *   GET  /tokens          — list token status (no plaintext)
 *   POST /store           — store a token in the vault
 *   GET  /audit           — recent audit log entries
 *
 * Secrets (set via wrangler secret put):
 *   ENCRYPTION_KEY     — 64-char hex AES-256-GCM key
 *   CF_WORKERS_TOKEN   — scoped token for Workers
 *   CF_D1_TOKEN        — scoped token for D1 (also used for vault storage)
 *   CF_STREAM_TOKEN    — scoped token for Stream
 *   CF_R2_TOKEN        — scoped token for R2
 *   CF_PAGES_TOKEN     — scoped token for Pages
 *   CF_FIREWALL_TOKEN  — scoped token for Firewall
 *
 * Cron: runs validate sweep on schedule (see wrangler.toml)
 */

// ─── Service token map ────────────────────────────────────────────────────────

function getServiceTokens(env) {
  return {
    workers:  env.CF_WORKERS_TOKEN,
    d1:       env.CF_D1_TOKEN,
    stream:   env.CF_STREAM_TOKEN,
    r2:       env.CF_R2_TOKEN,
    pages:    env.CF_PAGES_TOKEN,
    firewall: env.CF_FIREWALL_TOKEN,
  };
}

const SERVICES = ['workers', 'd1', 'stream', 'r2', 'pages', 'firewall'];

// CF API endpoints per service
const CF_ENDPOINTS = {
  workers:  (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
  d1:       (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`,
  stream:   (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`,
  r2:       (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
  pages:    (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
  firewall: (accountId) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/firewall/access-rules/rules`,
};

// ─── Crypto (Web Crypto API — available in CF Workers) ────────────────────────

async function getEncryptionKey(hexKey) {
  const keyBytes = hexToBytes(hexKey);
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function encryptToken(plaintext, hexKey) {
  const key = await getEncryptionKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return {
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
    iv: bytesToBase64(iv),
  };
}

async function decryptToken(ciphertextB64, ivB64, hexKey) {
  const key = await getEncryptionKey(hexKey);
  const iv = base64ToBytes(ivB64);
  const cipherBuf = base64ToBytes(ciphertextB64);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuf);
  return new TextDecoder().decode(decrypted);
}

async function hashToken(token) {
  const encoded = new TextEncoder().encode(token);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToBase64(new Uint8Array(hashBuf));
}

// ─── D1 Helpers ───────────────────────────────────────────────────────────────

async function d1Query(db, sql, params = []) {
  const stmt = db.prepare(sql);
  return params.length ? stmt.bind(...params).all() : stmt.all();
}

async function d1Execute(db, sql, params = []) {
  const stmt = db.prepare(sql);
  return params.length ? stmt.bind(...params).run() : stmt.run();
}

function generateId() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Token Vault ──────────────────────────────────────────────────────────────

async function storeToken(db, encKey, service, plaintext, expiresAt) {
  const { ciphertext, iv } = await encryptToken(plaintext, encKey);
  const hash = await hashToken(plaintext);
  const id = generateId();
  const expiry = expiresAt || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

  await d1Execute(db,
    `INSERT INTO service_tokens (id, service, token_hash, token_enc, enc_iv, created_at, expires_at, status)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 'active')
     ON CONFLICT(service) DO UPDATE SET
       token_hash=excluded.token_hash, token_enc=excluded.token_enc,
       enc_iv=excluded.enc_iv, expires_at=excluded.expires_at,
       status='active', last_validated_at=NULL`,
    [id, service, hash, ciphertext, iv, expiry]
  );
  return { id, service };
}

async function getToken(db, encKey, service) {
  const result = await d1Query(db,
    `SELECT token_enc, enc_iv, status FROM service_tokens WHERE service = ? AND status = 'active'`,
    [service]
  );
  const row = result.results?.[0];
  if (!row) throw new Error(`No active token found for service: ${service}`);
  return decryptToken(row.token_enc, row.enc_iv, encKey);
}

async function listTokens(db) {
  const result = await d1Query(db,
    `SELECT id, service, token_hash, status, created_at, expires_at, last_validated_at, last_used_at FROM service_tokens ORDER BY service`
  );
  return result.results || [];
}

// ─── CF API Validator ─────────────────────────────────────────────────────────

async function validateService(accountId, service, token) {
  const url = CF_ENDPOINTS[service](accountId);
  const start = Date.now();
  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const latencyMs = Date.now() - start;
    const body = await resp.json();
    return {
      service,
      valid: resp.status === 200 && body.success === true,
      status: resp.status,
      error: resp.status !== 200 ? (body.errors?.[0]?.message || `HTTP ${resp.status}`) : null,
      latencyMs,
    };
  } catch (err) {
    return {
      service,
      valid: false,
      status: 0,
      error: err.message,
      latencyMs: Date.now() - start,
    };
  }
}

// ─── Anomaly Detection ────────────────────────────────────────────────────────

function detectAnomalies(vaultRecord, cfResult) {
  const anomalies = [];
  if (!cfResult.valid) {
    anomalies.push({ code: 'TOKEN_INVALID', severity: 'p0', action: 'HALT',
      message: `Token invalid: ${cfResult.error}` });
  }
  if (vaultRecord?.expires_at) {
    const secsLeft = (new Date(vaultRecord.expires_at).getTime() - Date.now()) / 1000;
    if (secsLeft <= 0) {
      anomalies.push({ code: 'TOKEN_EXPIRED', severity: 'p0', action: 'HALT',
        message: 'Token has expired' });
    } else if (secsLeft < 7 * 86400) {
      anomalies.push({ code: 'TOKEN_EXPIRY_SOON', severity: 'p1', action: 'WARN',
        message: `Token expires in ${Math.floor(secsLeft / 86400)} days` });
    } else if (secsLeft < 30 * 86400) {
      anomalies.push({ code: 'TOKEN_EXPIRY_UPCOMING', severity: 'p2', action: 'LOG',
        message: `Token expires in ${Math.floor(secsLeft / 86400)} days` });
    }
  }
  return anomalies;
}

function computeScore(results) {
  const perService = 100 / SERVICES.length;
  let total = 0;
  for (const r of results) {
    const hasHalt = r.anomalies?.some(a => a.action === 'HALT');
    const hasWarn = r.anomalies?.some(a => a.action === 'WARN');
    const hasLog  = r.anomalies?.some(a => a.action === 'LOG');
    if (hasHalt)      total += 0;
    else if (hasWarn) total += perService * 0.5;
    else if (hasLog)  total += perService * 0.85;
    else              total += perService;
  }
  return Math.round(total);
}

// ─── Main Validate ────────────────────────────────────────────────────────────

async function validateAll(env, trigger = 'scheduled') {
  const accountId = env.CF_ACCOUNT_ID || 'a9c661749d16228083b6047aa1e8a70e';
  const encKey = env.ENCRYPTION_KEY;
  const db = env.DB;
  const tokens = getServiceTokens(env);
  const runId = generateId();
  const startedAt = new Date().toISOString();

  // Get vault records for all services
  const vaultList = await listTokens(db);
  const vaultMap = Object.fromEntries(vaultList.map(r => [r.service, r]));

  const results = [];
  let tokensChecked = 0, tokensValid = 0, tokensWarned = 0, tokensFailed = 0;

  for (const service of SERVICES) {
    const token = tokens[service];
    if (!token) {
      results.push({ service, valid: false, error: 'Secret not set', anomalies: [
        { code: 'TOKEN_MISSING', severity: 'p0', action: 'HALT', message: 'Wrangler secret not configured' }
      ]});
      tokensFailed++;
      tokensChecked++;
      continue;
    }

    // Store token in vault if not already there
    if (!vaultMap[service]) {
      await storeToken(db, encKey, service, token, null);
    }

    const cfResult = await validateService(accountId, service, token);
    const vaultRecord = vaultMap[service];
    const anomalies = detectAnomalies(vaultRecord, cfResult);
    const hasHalt = anomalies.some(a => a.action === 'HALT');
    const hasWarn = anomalies.some(a => a.action === 'WARN');

    results.push({ service, valid: cfResult.valid, status: cfResult.status,
      latencyMs: cfResult.latencyMs, anomalies, error: cfResult.error });

    tokensChecked++;
    if (hasHalt)       tokensFailed++;
    else if (hasWarn)  tokensWarned++;
    else               tokensValid++;

    // Update last_validated_at
    await d1Execute(db,
      `UPDATE service_tokens SET last_validated_at = datetime('now') WHERE service = ?`,
      [service]
    );

    // Append to audit log
    await d1Execute(db,
      `INSERT INTO audit_log (id, agent_id, action, service, result, severity, detail_json)
       VALUES (?, 'zero-trust', 'validate', ?, ?, ?, ?)`,
      [generateId(), service,
        hasHalt ? 'fail' : hasWarn ? 'warn' : 'pass',
        hasHalt ? 'p0' : hasWarn ? 'p1' : 'info',
        JSON.stringify({ cfResult, anomalies, trigger })]
    );
  }

  const score = computeScore(results);
  const valid = tokensFailed === 0;
  const summary = { runId, trigger, startedAt, completedAt: new Date().toISOString(),
    score, valid, tokensChecked, tokensValid, tokensWarned, tokensFailed, results };

  // Record validation run
  await d1Execute(db,
    `INSERT INTO validation_runs (id, started_at, completed_at, trigger, tokens_checked, tokens_valid, tokens_warned, tokens_failed, overall_score, summary_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [runId, startedAt, summary.completedAt, trigger,
      tokensChecked, tokensValid, tokensWarned, tokensFailed, score, JSON.stringify(summary)]
  );

  return summary;
}

// ─── HTTP Router ──────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Simple auth: require internal bearer token
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.INTERNAL_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (path === '/validate' && request.method === 'GET') {
    const trigger = url.searchParams.get('trigger') || 'manual';
    const result = await validateAll(env, trigger);
    return json(result, result.valid ? 200 : 207);
  }

  if (path === '/health' && request.method === 'GET') {
    return json({ status: 'ok', ts: new Date().toISOString() });
  }

  if (path === '/tokens' && request.method === 'GET') {
    const tokens = await listTokens(env.DB);
    return json({ tokens, count: tokens.length });
  }

  if (path === '/audit' && request.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const result = await d1Query(env.DB,
      `SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?`, [limit]);
    return json({ entries: result.results || [], count: result.results?.length || 0 });
  }

  if (path === '/store' && request.method === 'POST') {
    const body = await request.json();
    const { service, token, expiresAt } = body;
    if (!service || !token) return json({ error: 'service and token required' }, 400);
    const result = await storeToken(env.DB, env.ENCRYPTION_KEY, service, token, expiresAt);
    return json({ success: true, ...result });
  }

  return json({ error: 'Not found' }, 404);
}

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
  // HTTP fetch handler
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      return json({ error: err.message, stack: err.stack }, 500);
    }
  },

  // Cron trigger handler
  async scheduled(event, env, ctx) {
    try {
      const result = await validateAll(env, 'scheduled');
      console.log(`[ZeroTrust] Scheduled sweep complete. Score: ${result.score}/100. Valid: ${result.valid}`);
    } catch (err) {
      console.error(`[ZeroTrust] Scheduled sweep failed: ${err.message}`);
    }
  },
};
