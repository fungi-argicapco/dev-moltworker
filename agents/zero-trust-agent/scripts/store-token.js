'use strict';

/**
 * store-token.js — CLI utility to store a token in the vault
 * ────────────────────────────────────────────────────────────
 * Usage: node scripts/store-token.js <service> <token> [expiresAt] [scopes...]
 *
 * Example:
 *   node scripts/store-token.js workers MY_CF_TOKEN 2026-12-31T00:00:00Z "Workers Scripts:Edit"
 */

// Load .env if present
try { require('dotenv').config(); } catch {}

async function main() {
  const [,, service, token, expiresAt, ...scopes] = process.argv;

  if (!service || !token) {
    console.error('Usage: node store-token.js <service> <token> [expiresAt] [scopes...]');
    console.error('Services: workers | d1 | stream | r2 | pages | firewall');
    process.exit(1);
  }

  const { storeToken } = require('../src/token-vault');

  try {
    const result = await storeToken(service, token, expiresAt || null, scopes);
    console.log(`✓ Token stored for service: ${service} (id: ${result?.id || 'unknown'})`);
  } catch (err) {
    console.error(`✗ Failed to store token: ${err.message}`);
    process.exit(1);
  }
}

main();
