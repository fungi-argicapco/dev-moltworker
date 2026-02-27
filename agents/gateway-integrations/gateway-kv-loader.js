#!/usr/bin/env node
/**
 * gateway-kv-loader.js
 * 
 * Cloudflare KV-backed Telegram pairing loader for OpenClaw gateway.
 * 
 * This module integrates directly with the gateway startup to:
 * 1. Load approved Telegram users from Cloudflare KV
 * 2. Merge them into the Telegram channel config
 * 3. Ensure approvals persist across gateway reboots
 * 
 * Usage (Option A - Programmatic):
 *   import { loadTelegramPairingFromKV } from './gateway-kv-loader.js';
 *   const config = await loadTelegramPairingFromKV(config);
 * 
 * Usage (Option B - CLI before startup):
 *   node gateway-kv-loader.js --config ~/.openclaw/openclaw.json --apply
 * 
 * Usage (Option C - Environment hook):
 *   export OPENCLAW_GATEWAY_INIT_HOOKS=/path/to/gateway-kv-loader.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG_PATH = path.join(
  process.env.HOME || "/root",
  ".openclaw",
  "openclaw.json"
);

const TELEGRAM_KV_NAMESPACE = "telegram-pairing";
const KV_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

// ============================================================================
// Environment & Credential Resolution
// ============================================================================

function resolveCredentials() {
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;
  const kvNamespaceId = process.env.TELEGRAM_KV_NAMESPACE_ID;

  return { cfAccountId, cfApiToken, kvNamespaceId };
}

function validateCredentials({ cfAccountId, cfApiToken }) {
  if (!cfAccountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID environment variable not set");
  }
  if (!cfApiToken) {
    throw new Error("CLOUDFLARE_API_TOKEN environment variable not set");
  }
  if (cfAccountId.length < 10) {
    throw new Error("Invalid CLOUDFLARE_ACCOUNT_ID format");
  }
  if (cfApiToken.length < 20) {
    throw new Error("Invalid CLOUDFLARE_API_TOKEN format");
  }
}

// ============================================================================
// KV Namespace Resolution
// ============================================================================

async function resolveKVNamespaceId(cfAccountId, cfApiToken, kvNamespaceId) {
  if (kvNamespaceId) {
    return kvNamespaceId;
  }

  try {
    const response = await fetch(
      `${KV_API_BASE}/${cfAccountId}/storage/kv/namespaces`,
      {
        headers: {
          Authorization: `Bearer ${cfApiToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `KV API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    if (!data.success || !Array.isArray(data.result)) {
      throw new Error("Invalid KV API response");
    }

    const ns = data.result.find((n) => n.title === TELEGRAM_KV_NAMESPACE);
    if (!ns) {
      console.warn(
        `[gateway-kv-loader] KV namespace "${TELEGRAM_KV_NAMESPACE}" not found. Approvals will not persist.`
      );
      return null;
    }

    return ns.id;
  } catch (err) {
    console.warn(
      `[gateway-kv-loader] Failed to resolve KV namespace: ${err.message}`
    );
    return null;
  }
}

// ============================================================================
// KV Read Operations
// ============================================================================

async function listKVKeys(cfAccountId, cfApiToken, kvNamespaceId, prefix) {
  const url = `${KV_API_BASE}/${cfAccountId}/storage/kv/namespaces/${kvNamespaceId}/keys?prefix=${encodeURIComponent(prefix)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfApiToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`KV list error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.success || !Array.isArray(data.result)) {
    throw new Error("Invalid KV list response");
  }

  return data.result.map((item) => item.name);
}

async function readKVKey(cfAccountId, cfApiToken, kvNamespaceId, key) {
  const url = `${KV_API_BASE}/${cfAccountId}/storage/kv/namespaces/${kvNamespaceId}/values/${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfApiToken}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`KV read error: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn(`[gateway-kv-loader] Failed to parse KV value for ${key}`);
    return null;
  }
}

// ============================================================================
// Pairing State Fetch
// ============================================================================

async function fetchApprovedUsersFromKV(
  cfAccountId,
  cfApiToken,
  kvNamespaceId,
  accountId = "default"
) {
  if (!kvNamespaceId) {
    return [];
  }

  try {
    const prefix = `telegram:${accountId}:`;
    const keys = await listKVKeys(cfAccountId, cfApiToken, kvNamespaceId, prefix);

    const approved = [];
    for (const key of keys) {
      const value = await readKVKey(cfAccountId, cfApiToken, kvNamespaceId, key);
      if (value && value.approved === true && value.userId) {
        approved.push({
          userId: String(value.userId),
          approved: true,
          approvedAt: value.approvedAt,
          username: value.username,
          metadata: value.metadata,
        });
      }
    }

    return approved;
  } catch (err) {
    console.warn(
      `[gateway-kv-loader] Failed to fetch approved users from KV: ${err.message}`
    );
    return [];
  }
}

// ============================================================================
// Config Merging
// ============================================================================

function mergeApprovedUsersIntoConfig(
  config,
  approvedUsers,
  accountId = "default"
) {
  if (!approvedUsers || approvedUsers.length === 0) {
    return config;
  }

  const nextConfig = JSON.parse(JSON.stringify(config)); // Deep clone
  const channels = nextConfig.channels || {};
  const telegram = channels.telegram || {};

  // Determine if this is the default account
  const isDefaultAccount = accountId === "default" || !accountId;

  // Extract existing allowFrom
  const existing = new Set();
  if (isDefaultAccount) {
    if (Array.isArray(telegram.allowFrom)) {
      telegram.allowFrom.forEach((u) =>
        existing.add(String(u).toLowerCase())
      );
    }
  } else {
    if (
      telegram.accounts &&
      telegram.accounts[accountId] &&
      Array.isArray(telegram.accounts[accountId].allowFrom)
    ) {
      telegram.accounts[accountId].allowFrom.forEach((u) =>
        existing.add(String(u).toLowerCase())
      );
    }
  }

  // Add approved users
  for (const user of approvedUsers) {
    existing.add(String(user.userId).toLowerCase());
  }

  // Write back to config
  if (isDefaultAccount) {
    if (!nextConfig.channels) {
      nextConfig.channels = {};
    }
    if (!nextConfig.channels.telegram) {
      nextConfig.channels.telegram = {};
    }
    nextConfig.channels.telegram.allowFrom = Array.from(existing);
  } else {
    if (!nextConfig.channels) {
      nextConfig.channels = {};
    }
    if (!nextConfig.channels.telegram) {
      nextConfig.channels.telegram = {};
    }
    if (!nextConfig.channels.telegram.accounts) {
      nextConfig.channels.telegram.accounts = {};
    }
    if (!nextConfig.channels.telegram.accounts[accountId]) {
      nextConfig.channels.telegram.accounts[accountId] = {};
    }
    nextConfig.channels.telegram.accounts[accountId].allowFrom =
      Array.from(existing);
  }

  return nextConfig;
}

// ============================================================================
// Main Load Function
// ============================================================================

export async function loadTelegramPairingFromKV(config, options = {}) {
  const {
    cfAccountId: optCfAccountId,
    cfApiToken: optCfApiToken,
    kvNamespaceId: optKvNamespaceId,
    accountId = "default",
    verbose = false,
    throwOnError = false,
  } = options;

  try {
    // Resolve credentials
    const envCreds = resolveCredentials();
    const cfAccountId = optCfAccountId || envCreds.cfAccountId;
    const cfApiToken = optCfApiToken || envCreds.cfApiToken;
    let kvNamespaceId =
      optKvNamespaceId || envCreds.kvNamespaceId;

    // Validate we have what we need
    validateCredentials({ cfAccountId, cfApiToken });

    if (verbose) {
      console.log(`[gateway-kv-loader] Account ID: ${cfAccountId}`);
      console.log(
        `[gateway-kv-loader] KV Namespace: ${kvNamespaceId || "resolving..."}`
      );
    }

    // Resolve KV namespace if needed
    if (!kvNamespaceId) {
      kvNamespaceId = await resolveKVNamespaceId(
        cfAccountId,
        cfApiToken,
        kvNamespaceId
      );
    }

    if (!kvNamespaceId) {
      console.warn(
        `[gateway-kv-loader] No KV namespace available. Telegram approvals will not persist.`
      );
      return config;
    }

    if (verbose) {
      console.log(
        `[gateway-kv-loader] Fetching approved users from KV (namespace: ${kvNamespaceId})...`
      );
    }

    // Fetch approved users
    const approvedUsers = await fetchApprovedUsersFromKV(
      cfAccountId,
      cfApiToken,
      kvNamespaceId,
      accountId
    );

    if (verbose) {
      console.log(
        `[gateway-kv-loader] Found ${approvedUsers.length} approved users`
      );
      approvedUsers.forEach((u) => {
        console.log(
          `  - ${u.userId} (${u.username || "unknown"}) approved at ${u.approvedAt || "unknown"}`
        );
      });
    }

    // Merge into config
    const nextConfig = mergeApprovedUsersIntoConfig(
      config,
      approvedUsers,
      accountId
    );

    if (verbose) {
      const allowFrom = nextConfig.channels?.telegram?.allowFrom;
      console.log(
        `[gateway-kv-loader] ✅ Merged into config. allowFrom: [${allowFrom?.join(", ") || ""}]`
      );
    }

    return nextConfig;
  } catch (err) {
    const message = `[gateway-kv-loader] Error loading Telegram pairing from KV: ${err.message}`;
    if (throwOnError) {
      throw new Error(message);
    } else {
      console.error(message);
      console.error("[gateway-kv-loader] Continuing with existing config...");
      return config;
    }
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const options = {
    config: DEFAULT_CONFIG_PATH,
    apply: false,
    verbose: false,
    dryRun: false,
  };

  // Parse args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && i + 1 < args.length) {
      options.config = args[++i];
    } else if (args[i] === "--apply") {
      options.apply = true;
    } else if (args[i] === "--dry-run") {
      options.dryRun = true;
    } else if (args[i] === "--verbose" || args[i] === "-v") {
      options.verbose = true;
    }
  }

  try {
    // Load config
    if (options.verbose) {
      console.log(`[gateway-kv-loader] Loading config: ${options.config}`);
    }
    const configContent = fs.readFileSync(options.config, "utf-8");
    const config = JSON.parse(configContent);

    // Load pairing from KV
    const nextConfig = await loadTelegramPairingFromKV(config, {
      verbose: options.verbose,
    });

    // Apply or preview
    if (options.apply && !options.dryRun) {
      fs.writeFileSync(
        options.config,
        JSON.stringify(nextConfig, null, 2),
        "utf-8"
      );
      console.log(`[gateway-kv-loader] ✅ Wrote updated config to ${options.config}`);
    } else if (options.dryRun || !options.apply) {
      console.log("\n[gateway-kv-loader] DRY RUN - Would write:");
      console.log(JSON.stringify(nextConfig.channels?.telegram, null, 2));
    }
  } catch (err) {
    console.error(`[gateway-kv-loader] Fatal error: ${err.message}`);
    process.exit(1);
  }
}

// Run CLI if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default {
  loadTelegramPairingFromKV,
  fetchApprovedUsersFromKV,
  mergeApprovedUsersIntoConfig,
};
