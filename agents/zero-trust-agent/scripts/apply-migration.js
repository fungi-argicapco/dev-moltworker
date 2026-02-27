'use strict';

/**
 * apply-migration.js — Direct migration runner using CF D1 API
 * Uses the known crm-db UUID directly without needing env vars for testing.
 */

const fs   = require('fs');
const path = require('path');

const ACCOUNT_ID = 'a9c661749d16228083b6047aa1e8a70e';
const D1_TOKEN   = 'zmuaXnd4KisSg1NDFvhxDjEFKGliH83Nrq_FMCa5';
const DB_ID      = '65d74e27-7164-4b0d-b4ac-ca0a95295a91'; // crm-db

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

async function runQuery(sql) {
  const url = `${CF_API_BASE}/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${D1_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ sql, params: [] }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`D1 error: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

async function main() {
  const sqlPath = path.resolve(__dirname, '../migrations/001_initial.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Split into individual statements (split on semicolons, filter blanks/comments)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => {
      if (!s) return false;
      // Filter out comment-only lines
      const lines = s.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
      return lines.length > 0;
    });

  console.log(`[migrate] Applying ${statements.length} statements to crm-db (${DB_ID})`);

  let ok = 0;
  let errs = 0;

  for (const stmt of statements) {
    const preview = stmt.replace(/\s+/g, ' ').substring(0, 80);
    try {
      await runQuery(stmt + ';');
      console.log(`  ✓ ${preview}...`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${preview}...`);
      console.error(`    Error: ${e.message}`);
      errs++;
    }
  }

  console.log(`\n[migrate] Done: ${ok} succeeded, ${errs} failed`);
  process.exit(errs > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
