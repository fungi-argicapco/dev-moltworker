#!/usr/bin/env node

/**
 * Cloudflare D1 Query Wrapper
 * Execute SQL against D1 databases
 */

const https = require('https');

const D1_TOKEN = process.env.CLOUDFLARE_D1_TOKEN || 'zmuaXnd4KisSg1NDFvhxDjEFKGliH83Nrq_FMCa5';
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'a9c661749d16228083b6047aa1e8a70e';

/**
 * Query D1 database
 * @param {string} database - DB name (crm-db, crm-db-staging, contentguru-db, contentguru-db-staging)
 * @param {string} sql - SQL query
 * @returns {Promise<Array>} Result rows
 */
async function queryD1(database, sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${database}/query`;
  
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      sql: sql
    });

    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${database}/query`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${D1_TOKEN}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.success) {
            const results = result.result || [];
            // D1 returns array of result objects with 'results' property
            resolve(results.length > 0 ? results[0].results || [] : []);
          } else {
            reject(new Error(`D1 Error: ${result.errors?.[0]?.message || 'Unknown error'}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * List all tables in database
 */
async function listTables(database) {
  const sql = `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`;
  return queryD1(database, sql);
}

/**
 * Get schema for table
 */
async function getTableSchema(database, tableName) {
  const sql = `PRAGMA table_info(${tableName})`;
  return queryD1(database, sql);
}

/**
 * Explore database schema
 */
async function exploreDatabase(database) {
  console.log(`\n📊 Exploring ${database}...\n`);
  
  const tables = await listTables(database);
  console.log(`Found ${tables.length} tables:\n`);
  
  for (const table of tables) {
    const schema = await getTableSchema(database, table.name);
    console.log(`\n## ${table.name}`);
    console.log(JSON.stringify(schema, null, 2));
  }
}

module.exports = {
  queryD1,
  listTables,
  getTableSchema,
  exploreDatabase,
  D1_TOKEN
};

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const [command, database, ...sqlParts] = args;
  
  if (command === 'explore') {
    exploreDatabase(database).catch(err => {
      console.error('❌ Error:', err.message);
      process.exit(1);
    });
  } else if (command === 'query') {
    const sql = sqlParts.join(' ');
    queryD1(database, sql)
      .then(results => {
        console.log(JSON.stringify(results, null, 2));
      })
      .catch(err => {
        console.error('❌ Error:', err.message);
        process.exit(1);
      });
  } else {
    console.log(`Usage:
  node d1-query.js explore <database>
  node d1-query.js query <database> <sql>`);
  }
}
