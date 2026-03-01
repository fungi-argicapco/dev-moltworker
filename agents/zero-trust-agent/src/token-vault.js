'use strict';

/**
 * token-vault.js — Zero Trust Agent · Phase 1
 * ─────────────────────────────────────────────
 * Secure token storage layer backed by Cloudflare D1 (crm-db).
 * All tokens are AES-256-GCM encrypted at rest.
 *
 * Environment variables required:
 *   ENCRYPTION_KEY  — 64-char hex string (32 bytes) for AES-256-GCM
 *   CF_ACCOUNT_ID   — Cloudflare Account ID
 *   CF_D1_TOKEN     — Cloudflare D1 API token
 *   CF_D1_DB_ID     — D1 database ID for crm-db
 */

const crypto = require('crypto');
const { d1Query, d1Execute } = require('./d1-client');

const ALGORITHM  = 'aes-256-gcm';
const IV_BYTES   = 12;   // 96-bit IV recommended for GCM
const AUTH_TAG_BYTES = 16;

// ─── Key Management ──────────────────────────────────────────────────────────

function getEncryptionKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

// ─── Crypto Helpers ───────────────────────────────────────────────────────────

/**
 * Encrypt plaintext using AES-256-GCM.
 * @param {string} plaintext
 * @returns {{ ciphertext: string, iv: string }} Both base64-encoded
 */
function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv  = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Prepend auth tag to ciphertext so it's stored together
  const payload = Buffer.concat([authTag, encrypted]);

  return {
    ciphertext: payload.toString('base64'),
    iv: iv.toString('base64'),
  };
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * @param {string} ciphertextB64 — base64 payload (authTag + ciphertext)
 * @param {string} ivB64         — base64 IV
 * @returns {string} plaintext
 */
function decrypt(ciphertextB64, ivB64) {
  const key     = getEncryptionKey();
  const iv      = Buffer.from(ivB64, 'base64');
  const payload = Buffer.from(ciphertextB64, 'base64');

  if (payload.length < AUTH_TAG_BYTES) {
    throw new Error('Invalid ciphertext: too short to contain auth tag');
  }

  const authTag    = payload.subarray(0, AUTH_TAG_BYTES);
  const ciphertext = payload.subarray(AUTH_TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * SHA-256 hash of a token for fast lookup/comparison (no decryption needed).
 * @param {string} token
 * @returns {string} hex digest
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Store (or update) an encrypted token in D1.
 *
 * @param {string} service      — Service key: workers|d1|stream|r2|pages|firewall
 * @param {string} plaintextToken
 * @param {string|null} expiresAt — ISO-8601 datetime or null
 * @param {string[]} scopes     — Expected permission scopes
 * @returns {Promise<{ id: string, service: string }>}
 */
async function storeToken(service, plaintextToken, expiresAt = null, scopes = []) {
  validateServiceName(service);
  if (!plaintextToken || typeof plaintextToken !== 'string') {
    throw new Error('plaintextToken must be a non-empty string');
  }

  const { ciphertext, iv } = encrypt(plaintextToken);
  const tokenHash = hashToken(plaintextToken);
  const scopeJson = JSON.stringify(scopes);

  // Upsert: update if service exists, insert if not
  const sql = `
    INSERT INTO service_tokens (service, token_hash, token_enc, enc_iv, expires_at, status, scope_json)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
    ON CONFLICT(service) DO UPDATE SET
      token_hash        = excluded.token_hash,
      token_enc         = excluded.token_enc,
      enc_iv            = excluded.enc_iv,
      expires_at        = excluded.expires_at,
      status            = 'active',
      scope_json        = excluded.scope_json,
      created_at        = datetime('now')
    RETURNING id, service
  `;

  const result = await d1Execute(sql, [service, tokenHash, ciphertext, iv, expiresAt, scopeJson]);

  console.log(`[TokenVault] Stored token for service: ${service}`);
  return result.results[0];
}

/**
 * Retrieve and decrypt a token from D1.
 *
 * @param {string} service
 * @returns {Promise<{ plaintext: string, record: object }>}
 */
async function getToken(service) {
  validateServiceName(service);

  const sql = `
    SELECT id, service, token_enc, enc_iv, expires_at, status, scope_json, created_at
    FROM service_tokens
    WHERE service = ?
    LIMIT 1
  `;
  const result = await d1Query(sql, [service]);

  if (!result.results || result.results.length === 0) {
    throw new Error(`No token found for service: ${service}`);
  }

  const record = result.results[0];

  if (record.status === 'revoked') {
    throw new Error(`Token for service '${service}' has been revoked`);
  }

  const plaintext = decrypt(record.token_enc, record.enc_iv);

  // Update last_used_at timestamp
  await d1Execute(
    `UPDATE service_tokens SET last_used_at = datetime('now') WHERE service = ?`,
    [service]
  ).catch(err => console.warn(`[TokenVault] Failed to update last_used_at: ${err.message}`));

  return {
    plaintext,
    record: sanitizeRecord(record),
  };
}

/**
 * List all token records — hashes only, no plaintext or ciphertext.
 *
 * @returns {Promise<object[]>}
 */
async function listTokens() {
  const sql = `
    SELECT id, service, token_hash, created_at, expires_at,
           last_validated_at, last_used_at, status, scope_json
    FROM service_tokens
    ORDER BY service ASC
  `;
  const result = await d1Query(sql, []);

  return (result.results || []).map(sanitizeRecord);
}

/**
 * Verify that a given plaintext token matches the stored hash for a service.
 *
 * @param {string} service
 * @param {string} token — plaintext token to verify
 * @returns {Promise<boolean>}
 */
async function validateTokenHash(service, token) {
  validateServiceName(service);

  const sql = `SELECT token_hash FROM service_tokens WHERE service = ? LIMIT 1`;
  const result = await d1Query(sql, [service]);

  if (!result.results || result.results.length === 0) {
    return false;
  }

  const storedHash  = result.results[0].token_hash;
  const incomingHash = hashToken(token);

  // Constant-time comparison to prevent timing attacks
  if (storedHash.length !== incomingHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(storedHash, 'hex'),
    Buffer.from(incomingHash, 'hex')
  );
}

/**
 * Mark a token as expired in D1 (does not delete).
 *
 * @param {string} service
 * @returns {Promise<void>}
 */
async function markTokenExpired(service) {
  validateServiceName(service);
  await d1Execute(
    `UPDATE service_tokens SET status = 'expired' WHERE service = ?`,
    [service]
  );
  console.log(`[TokenVault] Marked token as expired: ${service}`);
}

/**
 * Update last_validated_at after a successful CF API check.
 *
 * @param {string} service
 * @returns {Promise<void>}
 */
async function touchValidatedAt(service) {
  validateServiceName(service);
  await d1Execute(
    `UPDATE service_tokens SET last_validated_at = datetime('now') WHERE service = ?`,
    [service]
  );
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

const VALID_SERVICES = new Set(['workers', 'd1', 'stream', 'r2', 'pages', 'firewall']);

function validateServiceName(service) {
  if (!VALID_SERVICES.has(service)) {
    throw new Error(
      `Invalid service '${service}'. Must be one of: ${[...VALID_SERVICES].join(', ')}`
    );
  }
}

/** Strip sensitive fields from a D1 record before returning to caller. */
function sanitizeRecord(record) {
  const { token_enc, enc_iv, ...safe } = record; // eslint-disable-line no-unused-vars
  return {
    ...safe,
    scope_json: safeParseJson(record.scope_json, []),
  };
}

function safeParseJson(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  storeToken,
  getToken,
  listTokens,
  validateTokenHash,
  markTokenExpired,
  touchValidatedAt,
  // Exposed for testing
  _encrypt: encrypt,
  _decrypt: decrypt,
  _hashToken: hashToken,
};
