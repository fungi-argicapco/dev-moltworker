#!/usr/bin/env node

/**
 * OpenClaw Config Manager
 * Read, validate, and update configuration via KV
 */

const kv = require('./cloudflare-kv.js');
const fs = require('fs');

/**
 * Read local config file (if available)
 */
function readLocalConfig() {
  try {
    const configPath = '/root/.openclaw/openclaw.json';
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('⚠️  Cannot read local config:', e.message);
    return null;
  }
}

/**
 * Read config from KV (source of truth)
 */
async function getConfig() {
  console.log('📖 Reading config from KV...');
  try {
    const configStr = await kv.kvGet('openclaw-config');
    if (!configStr) {
      console.log('📋 No config in KV, using local copy...');
      return readLocalConfig();
    }
    return typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
  } catch (err) {
    console.error('❌ Error reading config:', err.message);
    return null;
  }
}

/**
 * Update config with patch
 */async function updateConfig(patch) {
  console.log('✏️  Updating config...');
  
  // Get current config
  const current = await getConfig();
  if (!current) throw new Error('Cannot read current config');
  
  // Deep merge patch
  const updated = deepMerge(current, patch);
  
  // Validate
  if (!updated.channels || !updated.agents) {
    throw new Error('Invalid config structure after patch');
  }
  
  // Write back to KV
  await kv.kvPut('openclaw-config', updated);
  console.log('✅ Config updated in KV');
  
  return updated;
}

/**
 * Update Telegram pairing
 */
async function updateTelegramPairing(userId, pairingCode) {
  console.log(`📱 Updating Telegram pairing for ${userId}...`);
  
  const patch = {
    channels: {
      telegram: {
        allowFrom: [userId],
        groupAllowFrom: [],
        dms: {
          [userId]: {
            enabled: true,
            paired: true
          }
        }
      }
    }
  };
  
  const result = await updateConfig(patch);
  console.log(`✅ Telegram pairing updated for ${userId}`);
  
  return result;
}

/**
 * Add/update API token
 */
async function setApiToken(name, token) {
  console.log(`🔑 Setting API token: ${name}...`);
  
  const patch = {
    auth: {
      profiles: {
        [name]: {
          provider: 'api',
          mode: 'api_key',
          token: token
        }
      }
    }
  };
  
  const result = await updateConfig(patch);
  console.log(`✅ API token set: ${name}`);
  
  return result;
}

/**
 * Deep merge objects
 */
function deepMerge(target, source) {
  const result = JSON.parse(JSON.stringify(target));
  
  for (const key in source) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * Validate config structure
 */
function validateConfig(config) {
  const required = ['channels', 'agents', 'models', 'gateway'];
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  return true;
}

module.exports = {
  getConfig,
  updateConfig,
  updateTelegramPairing,
  setApiToken,
  validateConfig,
  readLocalConfig
};

// CLI
if (require.main === module) {
  const [action, ...args] = process.argv.slice(2);
  
  if (action === 'get') {
    getConfig()
      .then(cfg => {
        if (cfg) console.log(JSON.stringify(cfg, null, 2));
      })
      .catch(err => { console.error('Error:', err.message); process.exit(1); });
  } else if (action === 'telegram' && args[0]) {
    const userId = args[0];
    const pairingCode = args[1] || '';
    updateTelegramPairing(userId, pairingCode)
      .then(() => console.log('Telegram pairing updated'))
      .catch(err => { console.error('Error:', err.message); process.exit(1); });
  } else if (action === 'token' && args[0] && args[1]) {
    const name = args[0];
    const token = args[1];
    setApiToken(name, token)
      .then(() => console.log('API token set'))
      .catch(err => { console.error('Error:', err.message); process.exit(1); });
  } else {
    console.log(`Usage:
  node config-manager.js get
  node config-manager.js telegram <user-id> [pairing-code]
  node config-manager.js token <name> <token>`);
  }
}
