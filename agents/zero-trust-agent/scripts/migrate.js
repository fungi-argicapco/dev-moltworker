'use strict';

/**
 * migrate.js — Apply D1 schema migration for Zero Trust Agent
 * ─────────────────────────────────────────────────────────────
 * Usage: node scripts/migrate.js
 *
 * Reads migrations/001_initial.sql and applies it to crm-db via D1 API.
 */

// Load .env if present
try { require('dotenv').config(); } catch {}

const fs   = require('fs');
const path = require('path');

async function main() {
  // Validate env
  const required = ['CF_ACCOUNT_ID', 'CF_D1_TOKEN', 'CF_D1_DB_ID'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[migrate] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const sqlPath = path.resolve(__dirname, '../migrations/001_initial.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error(`[migrate] Migration file not found: ${sqlPath}`);
    process.exit(1);
  }

  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  console.log(`[migrate] Applying migration: 001_initial.sql`);
  console.log(`[migrate] Target: crm-db (${process.env.CF_D1_DB_ID})`);

  // Use d1-client to execute the script
  const { d1ExecuteScript } = require('../src/d1-client');

  try {
    const result = await d1ExecuteScript(sqlContent);
    console.log(`[migrate] ✓ Migration applied successfully`);
    console.log(`[migrate]   Statements executed: ${result.statements}`);
    console.log(`[migrate]   Rows written:        ${result.rowsWritten}`);
  } catch (err) {
    console.error(`[migrate] ✗ Migration failed: ${err.message}`);
    process.exit(1);
  }
}

main();
