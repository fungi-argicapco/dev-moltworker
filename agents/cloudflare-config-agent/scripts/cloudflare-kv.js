#!/usr/bin/env node

/**
 * Cloudflare KV Wrapper
 * Read/write to KV for config persistence
 */

const https = require('https');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'a9c661749d16228083b6047aa1e8a70e';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '0r-f9JkPTH1KuAGodvGGhlweZODCSvXqe3vCSunG';
const KV_NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID || 'b5b621f57b12446f983930388945137d';

/**
 * Make HTTPS request to Cloudflare API
 */
function cfApiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}${path}`;
    
    let data = null;
    if (body) {
      data = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}${path}`,
      method: method,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.success) {
            resolve(result.result || result);
          } else {
            reject(new Error(`Cloudflare Error: ${result.errors?.[0]?.message || 'Unknown'}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Read value from KV
 */
async function kvGet(key) {
  try {
    const result = await cfApiRequest('GET', `/values/${encodeURIComponent(key)}`);
    return result;
  } catch (err) {
    if (err.message.includes('not found')) return null;
    throw err;
  }
}

/**
 * Write value to KV
 */
async function kvPut(key, value, expirationTtl = null) {
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
  const path = `/values/${encodeURIComponent(key)}${expirationTtl ? `?expiration_ttl=${expirationTtl}` : ''}`;
  
  return cfApiRequest('PUT', path, stringValue);
}

/**
 * Delete key from KV
 */
async function kvDelete(key) {
  return cfApiRequest('DELETE', `/values/${encodeURIComponent(key)}`);
}

/**
 * List all keys in namespace
 */
async function kvList(prefix = null) {
  const path = `/keys${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`;
  return cfApiRequest('GET', path);
}

module.exports = {
  kvGet,
  kvPut,
  kvDelete,
  kvList,
  ACCOUNT_ID,
  KV_NAMESPACE_ID
};

// CLI
if (require.main === module) {
  const [action, key, ...valueParts] = process.argv.slice(2);
  
  if (action === 'get' && key) {
    kvGet(key)
      .then(val => console.log(val === null ? 'null' : val))
      .catch(err => { console.error('Error:', err.message); process.exit(1); });
  } else if (action === 'put' && key) {
    const value = valueParts.join(' ');
    kvPut(key, value)
      .then(() => console.log('✅ Written to KV'))
      .catch(err => { console.error('Error:', err.message); process.exit(1); });
  } else if (action === 'delete' && key) {
    kvDelete(key)
      .then(() => console.log('✅ Deleted from KV'))
      .catch(err => { console.error('Error:', err.message); process.exit(1); });
  } else if (action === 'list') {
    kvList(key)
      .then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(err => { console.error('Error:', err.message); process.exit(1); });
  } else {
    console.log(`Usage:
  node cloudflare-kv.js get <key>
  node cloudflare-kv.js put <key> <value>
  node cloudflare-kv.js delete <key>
  node cloudflare-kv.js list [prefix]`);
  }
}
