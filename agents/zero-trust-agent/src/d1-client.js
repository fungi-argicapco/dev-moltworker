'use strict';

/**
 * d1-client.js — Zero Trust Agent · Phase 1
 * ──────────────────────────────────────────
 * Thin wrapper around the Cloudflare D1 HTTP API.
 * Supports both query (read) and execute (write) operations.
 *
 * Environment variables required:
 *   CF_ACCOUNT_ID  — Cloudflare Account ID
 *   CF_D1_TOKEN    — API token with D1:Edit permissions
 *   CF_D1_DB_ID    — D1 database UUID for crm-db
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const d1Token   = process.env.CF_D1_TOKEN;
  const dbId      = process.env.CF_D1_DB_ID;

  const missing = [];
  if (!accountId) missing.push('CF_ACCOUNT_ID');
  if (!d1Token)   missing.push('CF_D1_TOKEN');
  if (!dbId)      missing.push('CF_D1_DB_ID');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return { accountId, d1Token, dbId };
}

// ─── HTTP Helper ─────────────────────────────────────────────────────────────

async function cfFetch(path, method, body) {
  const { accountId, d1Token, dbId } = getConfig();
  const url = `${CF_API_BASE}/accounts/${accountId}/d1/database/${dbId}/${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${d1Token}`,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await response.json().catch(() => null);

  if (!response.ok || (json && !json.success)) {
    const errors = json?.errors?.map(e => `${e.code}: ${e.message}`).join('; ') || 'Unknown error';
    throw new Error(`D1 API error [${response.status}]: ${errors}`);
  }

  return json;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute a SELECT query. Returns { results: [], meta: {} }
 *
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<{ results: object[], meta: object }>}
 */
async function d1Query(sql, params = []) {
  const data = await cfFetch('query', 'POST', { sql, params });
  // D1 query returns array of result sets; take first
  const resultSet = Array.isArray(data.result) ? data.result[0] : data.result;
  return {
    results: resultSet?.results || [],
    meta:    resultSet?.meta    || {},
  };
}

/**
 * Execute a DML statement (INSERT/UPDATE/DELETE/CREATE).
 * Returns { results: [], meta: { rows_written, ... } }
 *
 * @param {string} sql
 * @param {any[]} params
 * @returns {Promise<{ results: object[], meta: object }>}
 */
async function d1Execute(sql, params = []) {
  const data = await cfFetch('query', 'POST', { sql, params });
  const resultSet = Array.isArray(data.result) ? data.result[0] : data.result;
  return {
    results: resultSet?.results || [],
    meta:    resultSet?.meta    || {},
  };
}

/**
 * Execute multiple SQL statements (e.g. a migration file).
 * Splits on semicolons and executes each statement sequentially.
 *
 * @param {string} sqlScript — Full SQL file contents
 * @returns {Promise<{ statements: number, rowsWritten: number }>}
 */
async function d1ExecuteScript(sqlScript) {
  // Split on semicolons but ignore empty lines and comment-only blocks
  const statements = sqlScript
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let rowsWritten = 0;

  for (const stmt of statements) {
    const result = await d1Execute(stmt + ';', []);
    rowsWritten += result.meta?.rows_written || 0;
  }

  return { statements: statements.length, rowsWritten };
}

module.exports = { d1Query, d1Execute, d1ExecuteScript };
