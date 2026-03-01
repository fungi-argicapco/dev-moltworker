'use strict';

/**
 * phase1.test.js — Zero Trust Agent · Phase 1 Unit Tests
 * ────────────────────────────────────────────────────────
 * Tests: token encrypt/decrypt round-trip, CF API validator (mocked),
 *        anomaly detection rules, interceptor orchestration.
 *
 * Runner: Node.js built-in test runner (node:test) — no external runner needed.
 * Run: node tests/phase1.test.js
 */

const { test, describe, before, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// ─── Setup: Provide required env vars before loading modules ─────────────────

process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.CF_ACCOUNT_ID  = 'test-account-id';
process.env.CF_D1_TOKEN    = 'test-d1-token';
process.env.CF_D1_DB_ID    = 'test-db-id';

// ─── Load modules AFTER env is set ───────────────────────────────────────────

const vault       = require('../src/token-vault');
const cfValidator = require('../src/cf-validator');
const interceptor = require('../src/interceptor');

// ════════════════════════════════════════════════════════════════════════════
// SUITE 1: Token Vault — Encryption / Decryption
// ════════════════════════════════════════════════════════════════════════════

describe('TokenVault — AES-256-GCM Crypto', () => {

  test('encrypt → decrypt round-trip produces original plaintext', () => {
    const plaintext  = 'my-super-secret-cf-api-token-12345';
    const { ciphertext, iv } = vault._encrypt(plaintext);

    assert.ok(ciphertext, 'ciphertext should be non-empty');
    assert.ok(iv,         'iv should be non-empty');
    assert.notEqual(ciphertext, plaintext, 'ciphertext should differ from plaintext');

    const recovered = vault._decrypt(ciphertext, iv);
    assert.equal(recovered, plaintext, 'decrypted value must match original');
  });

  test('encrypt produces different ciphertext each time (unique IV)', () => {
    const plaintext = 'same-token-value';
    const enc1 = vault._encrypt(plaintext);
    const enc2 = vault._encrypt(plaintext);

    assert.notEqual(enc1.ciphertext, enc2.ciphertext, 'ciphertexts should differ (different IV)');
    assert.notEqual(enc1.iv, enc2.iv, 'IVs should differ');

    // Both should decrypt to same plaintext
    assert.equal(vault._decrypt(enc1.ciphertext, enc1.iv), plaintext);
    assert.equal(vault._decrypt(enc2.ciphertext, enc2.iv), plaintext);
  });

  test('decrypt with wrong IV throws authentication error', () => {
    const plaintext = 'token-to-tamper-with';
    const { ciphertext } = vault._encrypt(plaintext);
    const wrongIv = Buffer.from(crypto.randomBytes(12)).toString('base64');

    assert.throws(
      () => vault._decrypt(ciphertext, wrongIv),
      /Unsupported state|bad decrypt|auth|tag/i,
      'Should throw GCM authentication error with wrong IV'
    );
  });

  test('decrypt with tampered ciphertext throws authentication error', () => {
    const plaintext = 'tamper-test-token';
    const { ciphertext, iv } = vault._encrypt(plaintext);

    // Flip a byte in the ciphertext
    const buf = Buffer.from(ciphertext, 'base64');
    buf[5] ^= 0xff;
    const tampered = buf.toString('base64');

    assert.throws(
      () => vault._decrypt(tampered, iv),
      /Unsupported state|bad decrypt|auth|tag/i,
      'Should throw GCM authentication error with tampered ciphertext'
    );
  });

  test('hashToken produces consistent SHA-256 hex digest', () => {
    const token = 'consistent-hash-token';
    const hash1 = vault._hashToken(token);
    const hash2 = vault._hashToken(token);

    assert.equal(hash1, hash2, 'Same input must produce same hash');
    assert.equal(hash1.length, 64, 'SHA-256 hex should be 64 chars');
    assert.match(hash1, /^[0-9a-f]{64}$/, 'Should be lowercase hex');
  });

  test('hashToken produces different hashes for different tokens', () => {
    const h1 = vault._hashToken('token-a');
    const h2 = vault._hashToken('token-b');
    assert.notEqual(h1, h2, 'Different tokens must produce different hashes');
  });

  test('getEncryptionKey throws on missing/invalid ENCRYPTION_KEY', () => {
    const originalKey = process.env.ENCRYPTION_KEY;

    process.env.ENCRYPTION_KEY = 'tooshort';
    assert.throws(() => vault._encrypt('x'), /ENCRYPTION_KEY must be a 64-character hex/);

    process.env.ENCRYPTION_KEY = originalKey;
  });

});

// ════════════════════════════════════════════════════════════════════════════
// SUITE 2: CF Validator — Mock HTTP Responses
// ════════════════════════════════════════════════════════════════════════════

describe('CFValidator — Service Validation', () => {

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Create a mock fetch that returns the given status/body.
   */
  function makeMockFetch(responses) {
    // responses: Map<urlPattern, { status, body }>  OR a single default
    return async (url, opts) => {
      let resp = responses.default || { status: 200, body: { success: true, result: [] } };

      for (const [pattern, r] of Object.entries(responses)) {
        if (pattern !== 'default' && url.includes(pattern)) {
          resp = r;
          break;
        }
      }

      return {
        ok:     resp.status >= 200 && resp.status < 300,
        status: resp.status,
        json:   async () => resp.body,
      };
    };
  }

  function withMockFetch(mockImpl, fn) {
    const original = global.fetch;
    global.fetch = mockImpl;
    try {
      return fn();
    } finally {
      global.fetch = original;
    }
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  test('_scopesMatch returns true when expected is empty', () => {
    assert.ok(cfValidator._scopesMatch([], ['Workers Scripts:Read']));
  });

  test('_scopesMatch returns true when all expected scopes found', () => {
    const expected = ['workers scripts'];
    const actual   = ['Workers Scripts:Read', 'Workers Scripts:Edit'];
    assert.ok(cfValidator._scopesMatch(expected, actual));
  });

  test('_scopesMatch returns false when a scope is missing', () => {
    const expected = ['D1:Edit'];
    const actual   = ['Workers Scripts:Read'];
    assert.ok(!cfValidator._scopesMatch(expected, actual));
  });

  test('_buildResult returns correct shape', () => {
    const result = cfValidator._buildResult('workers', true, 200, ['scope1'], 86400, null, Date.now() - 50);
    assert.equal(result.service,   'workers');
    assert.equal(result.valid,     true);
    assert.equal(result.status,    200);
    assert.deepEqual(result.scopes, ['scope1']);
    assert.equal(result.expiresIn, 86400);
    assert.equal(result.error,     null);
    assert.ok(result.latencyMs >= 0 && result.latencyMs < 5000);
  });

  test('validateService returns invalid result on 401', async () => {
    const mockFetch = makeMockFetch({
      default: { status: 401, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } },
    });

    await withMockFetch(mockFetch, async () => {
      const result = await cfValidator.validateService('workers', 'bad-token', []);
      assert.equal(result.valid,   false);
      assert.equal(result.status,  401);
      assert.ok(result.error.includes('invalid or revoked'));
    });
  });

  test('validateService returns invalid result on 403', async () => {
    const mockFetch = makeMockFetch({
      default: { status: 403, body: { success: false, errors: [{ code: 10001, message: 'Forbidden' }] } },
    });

    await withMockFetch(mockFetch, async () => {
      const result = await cfValidator.validateService('d1', 'perm-denied-token', []);
      assert.equal(result.valid,   false);
      assert.equal(result.status,  403);
      assert.ok(result.error.includes('Insufficient permissions'));
    });
  });

  test('validateService returns valid result on 200', async () => {
    const mockFetch = makeMockFetch({
      // List endpoint succeeds
      '/workers/scripts': {
        status: 200,
        body: { success: true, result: [] },
      },
      // Token verify endpoint
      '/user/tokens/verify': {
        status: 200,
        body: {
          success: true,
          result: {
            id:         'abc123',
            status:     'active',
            expires_on: null,
            policies:   [{ permission_groups: [{ name: 'Workers Scripts:Edit' }] }],
          },
        },
      },
    });

    await withMockFetch(mockFetch, async () => {
      const result = await cfValidator.validateService('workers', 'valid-token', []);
      assert.equal(result.valid,  true);
      assert.equal(result.status, 200);
    });
  });

  test('validateAll returns one result per service', async () => {
    const mockFetch = makeMockFetch({
      default: { status: 200, body: { success: true, result: [] } },
      '/user/tokens/verify': {
        status: 200,
        body: { success: true, result: { policies: [], expires_on: null } },
      },
    });

    await withMockFetch(mockFetch, async () => {
      const tokenMap = {};
      for (const svc of ['workers', 'd1', 'stream', 'r2', 'pages', 'firewall']) {
        tokenMap[svc] = { plaintext: `token-${svc}`, expectedScopes: [] };
      }
      const results = await cfValidator.validateAll(tokenMap);
      assert.equal(results.length, 6, 'Should return 6 results');
      for (const r of results) {
        assert.ok('service'   in r, 'Result must have service');
        assert.ok('valid'     in r, 'Result must have valid');
        assert.ok('status'    in r, 'Result must have status');
        assert.ok('scopes'    in r, 'Result must have scopes');
        assert.ok('expiresIn' in r, 'Result must have expiresIn');
      }
    });
  });

  test('validateAll returns no-token error for missing services', async () => {
    const mockFetch = makeMockFetch({
      default: { status: 200, body: { success: true, result: [] } },
    });

    await withMockFetch(mockFetch, async () => {
      // Only provide workers token — rest should get "no token" error
      const results = await cfValidator.validateAll({
        workers: { plaintext: 'tok', expectedScopes: [] },
      });
      assert.equal(results.length, 6);
      const missing = results.filter(r => r.service !== 'workers');
      for (const r of missing) {
        assert.equal(r.valid, false);
        assert.ok(r.error?.includes('No token available'));
      }
    });
  });

});

// ════════════════════════════════════════════════════════════════════════════
// SUITE 3: Anomaly Detection Rules
// ════════════════════════════════════════════════════════════════════════════

describe('Interceptor — Anomaly Detection', () => {

  const { detectAnomalies } = interceptor;

  function makeResult(overrides = {}) {
    return {
      service:   'workers',
      valid:     true,
      status:    200,
      scopes:    [],
      expiresIn: null,
      error:     null,
      latencyMs: 50,
      ...overrides,
    };
  }

  function makeVaultRec(overrides = {}) {
    return {
      service:    'workers',
      status:     'active',
      expires_at: null,
      scope_json: [],
      ...overrides,
    };
  }

  test('no anomalies for valid token with no expiry', () => {
    const anomalies = detectAnomalies(makeResult(), makeVaultRec());
    assert.equal(anomalies.length, 0);
  });

  test('P0/HALT for invalid (failed) token', () => {
    const anomalies = detectAnomalies(
      makeResult({ valid: false, error: 'Token is invalid or revoked' }),
      makeVaultRec()
    );
    const p0 = anomalies.find(a => a.priority === 'P0' && a.action === 'HALT');
    assert.ok(p0, 'Should have P0/HALT anomaly');
    assert.equal(p0.rule, 'TOKEN_INVALID');
  });

  test('P0/HALT for vault status=expired', () => {
    const anomalies = detectAnomalies(
      makeResult(),
      makeVaultRec({ status: 'expired' })
    );
    const p0 = anomalies.find(a => a.rule === 'TOKEN_EXPIRED_STATUS');
    assert.ok(p0, 'Should have TOKEN_EXPIRED_STATUS anomaly');
    assert.equal(p0.action, 'HALT');
  });

  test('P0/HALT for expiresIn <= 0 (already expired)', () => {
    const anomalies = detectAnomalies(
      makeResult({ expiresIn: -100 }),
      makeVaultRec()
    );
    const p0 = anomalies.find(a => a.rule === 'TOKEN_EXPIRED');
    assert.ok(p0, 'Should have TOKEN_EXPIRED anomaly');
    assert.equal(p0.priority, 'P0');
    assert.equal(p0.action, 'HALT');
  });

  test('P0/HALT for expiresIn = 0', () => {
    const anomalies = detectAnomalies(makeResult({ expiresIn: 0 }), makeVaultRec());
    assert.ok(anomalies.some(a => a.rule === 'TOKEN_EXPIRED'));
  });

  test('P1/WARN for expiresIn < 7 days (6 days)', () => {
    const sixDays = 6 * 24 * 3600;
    const anomalies = detectAnomalies(makeResult({ expiresIn: sixDays }), makeVaultRec());
    const p1 = anomalies.find(a => a.rule === 'TOKEN_EXPIRY_SOON');
    assert.ok(p1, 'Should have TOKEN_EXPIRY_SOON anomaly');
    assert.equal(p1.priority, 'P1');
    assert.equal(p1.action, 'WARN');
  });

  test('P1/WARN for expiresIn exactly at 7-day boundary', () => {
    const sevenDays = 7 * 24 * 3600;
    const anomalies = detectAnomalies(makeResult({ expiresIn: sevenDays }), makeVaultRec());
    assert.ok(anomalies.some(a => a.rule === 'TOKEN_EXPIRY_SOON'));
  });

  test('P2/LOG for expiresIn < 30 days (15 days)', () => {
    const fifteenDays = 15 * 24 * 3600;
    const anomalies = detectAnomalies(makeResult({ expiresIn: fifteenDays }), makeVaultRec());
    const p2 = anomalies.find(a => a.rule === 'TOKEN_EXPIRY_UPCOMING');
    assert.ok(p2, 'Should have TOKEN_EXPIRY_UPCOMING anomaly');
    assert.equal(p2.priority, 'P2');
    assert.equal(p2.action, 'LOG');
  });

  test('no expiry anomaly for expiresIn > 30 days (45 days)', () => {
    const fortyFiveDays = 45 * 24 * 3600;
    const anomalies = detectAnomalies(makeResult({ expiresIn: fortyFiveDays }), makeVaultRec());
    const expiryAnomalies = anomalies.filter(a => a.rule.startsWith('TOKEN_EXPIRY'));
    assert.equal(expiryAnomalies.length, 0, 'No expiry anomalies for 45-day token');
  });

  test('P1/WARN for scope mismatch error from CF validator', () => {
    const anomalies = detectAnomalies(
      makeResult({ valid: true, error: 'Scope mismatch — expected: [D1:Edit], got: [Workers:Read]' }),
      makeVaultRec()
    );
    const scopeAnomaly = anomalies.find(a => a.rule === 'SCOPE_MISMATCH');
    assert.ok(scopeAnomaly, 'Should detect SCOPE_MISMATCH');
    assert.equal(scopeAnomaly.priority, 'P1');
    assert.equal(scopeAnomaly.action, 'WARN');
  });

  test('P0/HALT takes precedence — multiple anomalies can coexist', () => {
    // Token invalid + expired + scope mismatch = multiple anomalies
    const anomalies = detectAnomalies(
      makeResult({ valid: false, expiresIn: -50, error: 'Token is invalid or revoked' }),
      makeVaultRec({ status: 'expired' })
    );
    assert.ok(anomalies.length >= 2, 'Should have multiple anomalies');
    assert.ok(anomalies.some(a => a.priority === 'P0'));
  });

  test('uses vault expires_at when cfResult.expiresIn is null', () => {
    const expiresAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(); // 3 days
    const anomalies = detectAnomalies(
      makeResult({ expiresIn: null }),
      makeVaultRec({ expires_at: expiresAt })
    );
    // 3 days < 7 days → should get P1/WARN
    assert.ok(anomalies.some(a => a.rule === 'TOKEN_EXPIRY_SOON'), '3-day vault expiry should trigger P1');
  });

});

// ════════════════════════════════════════════════════════════════════════════
// SUITE 4: Scoring & Recommendation
// ════════════════════════════════════════════════════════════════════════════

describe('Interceptor — Scoring & Recommendations', () => {

  const { computeScore, buildRecommendation } = interceptor;

  function makeAudit(service, valid, anomalies = []) {
    return {
      service,
      cfResult: { valid, status: valid ? 200 : 401, scopes: [], expiresIn: null, error: null, latencyMs: 50 },
      vaultRec: null,
      anomalies,
    };
  }

  const SERVICES = ['workers', 'd1', 'stream', 'r2', 'pages', 'firewall'];

  test('score = 100 when all 6 tokens valid with no anomalies', () => {
    const audits = SERVICES.map(s => makeAudit(s, true, []));
    assert.equal(computeScore(audits), 100);
  });

  test('score = 0 when all 6 tokens invalid', () => {
    const audits = SERVICES.map(s => makeAudit(s, false, [{ priority: 'P0', action: 'HALT' }]));
    assert.equal(computeScore(audits), 0);
  });

  test('score is ~83.3 when 1 of 6 tokens is invalid (no partial credit)', () => {
    const audits = [
      ...SERVICES.slice(0, 5).map(s => makeAudit(s, true, [])),
      makeAudit('firewall', false, [{ priority: 'P0', action: 'HALT' }]),
    ];
    const score = computeScore(audits);
    assert.ok(score > 80 && score < 90, `Score should be ~83.3, got ${score}`);
  });

  test('P1/WARN deducts 50% of service share', () => {
    const audits = [
      ...SERVICES.slice(0, 5).map(s => makeAudit(s, true, [])),
      makeAudit('firewall', true, [{ priority: 'P1', action: 'WARN' }]),
    ];
    const score = computeScore(audits);
    // 5 full services + 0.5 of 1 service = 5.5/6 * 100 = 91.67
    assert.ok(score > 88 && score < 95, `Score should be ~91.7, got ${score}`);
  });

  test('score is clamped to [0, 100]', () => {
    const audits = SERVICES.map(s => makeAudit(s, true, []));
    const score = computeScore(audits);
    assert.ok(score >= 0 && score <= 100);
  });

  test('recommendation = HALT when any P0 anomaly exists', () => {
    const audits = [
      makeAudit('workers', false, [{ action: 'HALT', priority: 'P0' }]),
      ...SERVICES.slice(1).map(s => makeAudit(s, true, [])),
    ];
    const rec = buildRecommendation(audits, 83);
    assert.ok(rec.startsWith('HALT'), `Expected HALT recommendation, got: ${rec}`);
  });

  test('recommendation = WARN when P1 but no P0', () => {
    const audits = [
      makeAudit('workers', true, [{ action: 'WARN', priority: 'P1' }]),
      ...SERVICES.slice(1).map(s => makeAudit(s, true, [])),
    ];
    const rec = buildRecommendation(audits, 92);
    assert.ok(rec.startsWith('WARN'), `Expected WARN recommendation, got: ${rec}`);
  });

  test('recommendation = OK when score >= 90 and no anomalies', () => {
    const audits = SERVICES.map(s => makeAudit(s, true, []));
    const rec = buildRecommendation(audits, 100);
    assert.ok(rec.startsWith('OK'), `Expected OK recommendation, got: ${rec}`);
  });

  test('recommendation = DEGRADED when score < 90 but no halt/warn', () => {
    const audits = SERVICES.map(s => makeAudit(s, true, []));
    const rec = buildRecommendation(audits, 75);
    assert.ok(rec.startsWith('DEGRADED'), `Expected DEGRADED recommendation, got: ${rec}`);
  });

});

// ════════════════════════════════════════════════════════════════════════════
// SUITE 5: Interceptor Orchestration (mocked D1 + CF)
// ════════════════════════════════════════════════════════════════════════════

describe('Interceptor — Full Orchestration (mocked)', () => {

  /**
   * Mock the D1 client and token vault to return canned data,
   * and mock fetch for CF API calls.
   */

  const MOCK_VAULT_TOKENS = [
    { service: 'workers',  token_hash: 'hash1', status: 'active', expires_at: null, scope_json: [], created_at: '2026-01-01', last_validated_at: null, last_used_at: null },
    { service: 'd1',       token_hash: 'hash2', status: 'active', expires_at: null, scope_json: [], created_at: '2026-01-01', last_validated_at: null, last_used_at: null },
    { service: 'stream',   token_hash: 'hash3', status: 'active', expires_at: null, scope_json: [], created_at: '2026-01-01', last_validated_at: null, last_used_at: null },
    { service: 'r2',       token_hash: 'hash4', status: 'active', expires_at: null, scope_json: [], created_at: '2026-01-01', last_validated_at: null, last_used_at: null },
    { service: 'pages',    token_hash: 'hash5', status: 'active', expires_at: null, scope_json: [], created_at: '2026-01-01', last_validated_at: null, last_used_at: null },
    { service: 'firewall', token_hash: 'hash6', status: 'active', expires_at: null, scope_json: [], created_at: '2026-01-01', last_validated_at: null, last_used_at: null },
  ];

  function patchModules(opts = {}) {
    const mockStatus = opts.cfStatus || 200;

    // We patch global.fetch to intercept both D1 API calls and CF API calls.
    // D1 calls go to api.cloudflare.com/client/v4/accounts/.../d1/...
    // CF validation calls go to api.cloudflare.com/client/v4/accounts/.../workers|d1|stream|...
    // Token verify calls go to /user/tokens/verify
    global.fetch = async (url) => {
      // D1 database queries (always succeed so interceptor can create run records)
      if (url.includes('/d1/database/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [{ results: [{ id: 'mock-run-id', service: 'workers' }], meta: { rows_written: 1 } }],
          }),
        };
      }

      // CF token verify endpoint
      if (url.includes('/user/tokens/verify')) {
        return {
          ok: mockStatus < 300,
          status: mockStatus,
          json: async () => ({
            success: mockStatus < 300,
            result: mockStatus < 300 ? { policies: [], expires_on: null } : null,
            errors: mockStatus >= 400 ? [{ code: 10000, message: 'Mock error' }] : [],
          }),
        };
      }

      // CF service validation endpoints (workers, stream, r2, etc.)
      return {
        ok:     mockStatus < 300,
        status: mockStatus,
        json:   async () => ({
          success: mockStatus < 300,
          result:  [],
          errors:  mockStatus >= 400 ? [{ code: 10000, message: 'Mock error' }] : [],
        }),
      };
    };

    // Patch token-vault module exports (interceptor uses destructured require,
    // so we patch the module cache directly)
    const tv = require('../src/token-vault');
    tv.listTokens = async () => MOCK_VAULT_TOKENS;
    tv.getToken = async (service) => ({
      plaintext: `plaintext-token-for-${service}`,
      record: MOCK_VAULT_TOKENS.find(t => t.service === service),
    });
    tv.touchValidatedAt = async () => {};
    tv.markTokenExpired = async () => {};
  }

  test('validateAll returns correct shape', async () => {
    patchModules({ cfStatus: 200 });

    const result = await interceptor.validateAll('test');

    assert.ok('valid'          in result, 'Must have valid');
    assert.ok('results'        in result, 'Must have results');
    assert.ok('score'          in result, 'Must have score');
    assert.ok('runId'          in result, 'Must have runId');
    assert.ok('recommendation' in result, 'Must have recommendation');
    assert.ok('tokensChecked'  in result, 'Must have tokensChecked');
    assert.ok('tokensValid'    in result, 'Must have tokensValid');
    assert.ok('tokensWarned'   in result, 'Must have tokensWarned');
    assert.ok('tokensFailed'   in result, 'Must have tokensFailed');

    assert.equal(result.results.length, 6, 'Should have 6 service results');
    assert.equal(result.tokensChecked, 6);
  });

  test('validateAll score = 100 when all services return 200', async () => {
    patchModules({ cfStatus: 200 });
    const result = await interceptor.validateAll('test');
    assert.equal(result.score, 100);
    assert.equal(result.valid, true);
  });

  test('validateAll score = 0 when all services return 401', async () => {
    patchModules({ cfStatus: 401 });
    const result = await interceptor.validateAll('test');
    assert.equal(result.score, 0);
    assert.equal(result.valid, false);
    assert.equal(result.tokensFailed, 6);
    assert.ok(result.recommendation.startsWith('HALT'));
  });

  test('validateAll accepts all valid trigger types', async () => {
    patchModules({ cfStatus: 200 });
    for (const trigger of ['manual', 'scheduled', 'webhook', 'startup', 'test']) {
      const result = await interceptor.validateAll(trigger);
      assert.ok(result.runId, `Should have runId for trigger: ${trigger}`);
    }
  });

  test('validateAll rejects invalid trigger', async () => {
    await assert.rejects(
      () => interceptor.validateAll('invalid-trigger'),
      /Invalid trigger/
    );
  });

  test('each result has expected service keys', async () => {
    patchModules({ cfStatus: 200 });
    const result = await interceptor.validateAll('test');
    const serviceNames = result.results.map(r => r.service).sort();
    assert.deepEqual(serviceNames, ['d1', 'firewall', 'pages', 'r2', 'stream', 'workers']);
  });

});

// ════════════════════════════════════════════════════════════════════════════
// SUITE 6: Utility Functions
// ════════════════════════════════════════════════════════════════════════════

describe('Interceptor — Utilities', () => {

  test('_formatDuration: seconds', () => {
    // Access internal via module
    const { _formatDuration: fmt } = interceptor;
    assert.equal(fmt(30),    '30s');
    assert.equal(fmt(59),    '59s');
  });

  test('_formatDuration: minutes', () => {
    const { _formatDuration: fmt } = interceptor;
    assert.equal(fmt(60),    '1m');
    assert.equal(fmt(3599),  '59m');
  });

  test('_formatDuration: hours', () => {
    const { _formatDuration: fmt } = interceptor;
    assert.equal(fmt(3600),  '1h');
    assert.equal(fmt(86399), '23h');
  });

  test('_formatDuration: days', () => {
    const { _formatDuration: fmt } = interceptor;
    assert.equal(fmt(86400),   '1d');
    assert.equal(fmt(86400*7), '7d');
  });

  test('_generateId returns a non-empty string', () => {
    const { _generateId: gen } = interceptor;
    const id = gen();
    assert.ok(typeof id === 'string' && id.length > 0);
  });

  test('_generateId produces unique values', () => {
    const { _generateId: gen } = interceptor;
    const ids = new Set([gen(), gen(), gen(), gen(), gen()]);
    assert.ok(ids.size >= 4, 'Should produce mostly unique IDs');
  });

  test('_resolveExpiresIn prefers cfResult.expiresIn', () => {
    const { _resolveExpiresIn: resolve } = interceptor;
    const cf = { expiresIn: 12345 };
    const vault = { expires_at: new Date(Date.now() + 99999000).toISOString() };
    assert.equal(resolve(cf, vault), 12345);
  });

  test('_resolveExpiresIn falls back to vault expires_at', () => {
    const { _resolveExpiresIn: resolve } = interceptor;
    const futureMs = Date.now() + 86400 * 1000; // 1 day from now
    const vault = { expires_at: new Date(futureMs).toISOString() };
    const secs = resolve({ expiresIn: null }, vault);
    assert.ok(secs > 86390 && secs < 86410, `Expected ~86400 seconds, got ${secs}`);
  });

  test('_resolveExpiresIn returns null when both are absent', () => {
    const { _resolveExpiresIn: resolve } = interceptor;
    assert.equal(resolve({ expiresIn: null }, null), null);
    assert.equal(resolve({ expiresIn: null }, {}), null);
  });

});
