'use strict';

/**
 * cf-validator.js — Zero Trust Agent · Phase 1
 * ──────────────────────────────────────────────
 * Validates Cloudflare API tokens by making live authenticated requests
 * to the minimal required endpoint for each of 6 services.
 *
 * Environment variables required:
 *   CF_ACCOUNT_ID  — Cloudflare Account ID
 *
 * Each validate* function accepts the plaintext token as its argument
 * (retrieved from TokenVault by the Interceptor).
 *
 * Returns a ValidationResult:
 *   { service, valid, status, scopes, expiresIn, error }
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// ─── Service Definitions ──────────────────────────────────────────────────────

/**
 * Map of service key → endpoint template.
 * {accountId} is substituted at runtime.
 */
const SERVICE_ENDPOINTS = {
  workers:  '/accounts/{accountId}/workers/scripts',
  d1:       '/accounts/{accountId}/d1/database',
  stream:   '/accounts/{accountId}/stream',
  r2:       '/accounts/{accountId}/r2/buckets',
  pages:    '/accounts/{accountId}/pages/projects',
  firewall: '/accounts/{accountId}/firewall/access-rules/rules',
};

/** Services that require a ?per_page=1 to avoid large payloads */
const PAGINATE_SERVICES = new Set(['workers', 'firewall']);

// ─── Core Validator ───────────────────────────────────────────────────────────

/**
 * Validate a single service token against its CF API endpoint.
 *
 * @param {string} service       — One of the 6 service keys
 * @param {string} token         — Plaintext CF API token
 * @param {string[]} expectedScopes — Expected scopes to compare against
 * @returns {Promise<ValidationResult>}
 */
async function validateService(service, token, expectedScopes = []) {
  const startedAt = Date.now();
  const accountId = getAccountId();

  const endpoint = SERVICE_ENDPOINTS[service];
  if (!endpoint) {
    return buildResult(service, false, null, [], null, `Unknown service: ${service}`, startedAt);
  }

  const path = endpoint.replace('{accountId}', accountId);
  const qs   = PAGINATE_SERVICES.has(service) ? '?per_page=1' : '';
  const url  = `${CF_API_BASE}${path}${qs}`;

  let response;
  let json;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    json = await response.json().catch(() => null);
  } catch (err) {
    return buildResult(service, false, 0, [], null, `Network error: ${err.message}`, startedAt);
  }

  // HTTP 401 / 403 = token invalid or insufficient permissions
  if (response.status === 401) {
    return buildResult(service, false, response.status, [], null, 'Token is invalid or revoked', startedAt);
  }
  if (response.status === 403) {
    return buildResult(service, false, response.status, [], null, 'Insufficient permissions for this service', startedAt);
  }

  // 200 or other 2xx = valid
  const valid = response.ok && (json?.success !== false);

  // Extract scopes from token verify endpoint if available
  let scopes    = [];
  let expiresIn = null;

  if (valid) {
    // Attempt to verify token metadata (not always available on list endpoints)
    const tokenMeta = await getTokenMetadata(token).catch(() => null);
    if (tokenMeta) {
      scopes    = tokenMeta.scopes    || [];
      expiresIn = tokenMeta.expiresIn ?? null;
    }
  }

  const scopeMismatch = expectedScopes.length > 0 && !scopesMatch(expectedScopes, scopes);
  const finalValid = valid && !scopeMismatch;
  const error = !valid
    ? `API returned ${response.status}: ${json?.errors?.[0]?.message || 'error'}`
    : scopeMismatch
      ? `Scope mismatch — expected: [${expectedScopes.join(', ')}], got: [${scopes.join(', ')}]`
      : null;

  return buildResult(service, finalValid, response.status, scopes, expiresIn, error, startedAt);
}

/**
 * Validate all 6 services in parallel.
 *
 * @param {Object} tokenMap — { serviceName: { plaintext, expectedScopes } }
 * @returns {Promise<ValidationResult[]>}
 */
async function validateAll(tokenMap) {
  const services = Object.keys(SERVICE_ENDPOINTS);
  const promises = services.map(service => {
    const entry = tokenMap[service];
    if (!entry) {
      return Promise.resolve(
        buildResult(service, false, null, [], null, 'No token available in vault', Date.now())
      );
    }
    return validateService(service, entry.plaintext, entry.expectedScopes || []);
  });

  return Promise.allSettled(promises).then(results =>
    results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return buildResult(services[i], false, null, [], null, r.reason?.message || 'Unexpected error', Date.now());
    })
  );
}

// ─── Token Metadata ───────────────────────────────────────────────────────────

/**
 * Call CF token verify endpoint to get scopes and expiry.
 * Uses /user/tokens/verify which is always available for any valid token.
 *
 * @param {string} token
 * @returns {Promise<{ scopes: string[], expiresIn: number|null }>}
 */
async function getTokenMetadata(token) {
  const response = await fetch(`${CF_API_BASE}/user/tokens/verify`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) return null;

  const json = await response.json().catch(() => null);
  if (!json?.success || !json?.result) return null;

  const result = json.result;
  const scopes = extractScopes(result);

  let expiresIn = null;
  if (result.expires_on) {
    const expiryMs  = new Date(result.expires_on).getTime();
    const nowMs     = Date.now();
    expiresIn = Math.max(0, Math.floor((expiryMs - nowMs) / 1000)); // seconds remaining
  }

  return { scopes, expiresIn };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAccountId() {
  const id = process.env.CF_ACCOUNT_ID;
  if (!id) throw new Error('CF_ACCOUNT_ID environment variable is required');
  return id;
}

/**
 * Extract human-readable scope strings from a CF token result object.
 */
function extractScopes(tokenResult) {
  if (!tokenResult?.policies) return [];
  return tokenResult.policies.flatMap(policy =>
    (policy.permission_groups || []).map(pg => pg.name || pg.id)
  );
}

/**
 * Check whether all expected scopes are present in actual scopes.
 * Case-insensitive substring match (CF scope names can be verbose).
 */
function scopesMatch(expected, actual) {
  if (!expected || expected.length === 0) return true;
  const actualLower = actual.map(s => s.toLowerCase());
  return expected.every(exp =>
    actualLower.some(act => act.includes(exp.toLowerCase()))
  );
}

/**
 * Build a canonical ValidationResult.
 */
function buildResult(service, valid, status, scopes, expiresIn, error, startedAt) {
  return {
    service,
    valid:     Boolean(valid),
    status:    status ?? null,
    scopes:    Array.isArray(scopes) ? scopes : [],
    expiresIn: expiresIn ?? null,  // seconds until expiry, or null
    error:     error   ?? null,
    latencyMs: Date.now() - startedAt,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  validateService,
  validateAll,
  getTokenMetadata,
  SERVICE_ENDPOINTS,
  // Exposed for testing
  _scopesMatch:   scopesMatch,
  _buildResult:   buildResult,
  _extractScopes: extractScopes,
};
