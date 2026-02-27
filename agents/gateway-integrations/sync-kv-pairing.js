#!/usr/bin/env node
/**
 * sync-kv-pairing.js
 * 
 * Syncs Telegram pairing state from Cloudflare KV to local config.
 * Run this before starting the OpenClaw gateway to ensure approved users persist across reboots.
 * 
 * Usage:
 *   node sync-kv-pairing.js [--config /path/to/openclaw.json] [--kv-namespace-id <id>] [--dry-run]
 * 
 * Environment:
 *   CLOUDFLARE_ACCOUNT_ID: Account ID (required)
 *   CLOUDFLARE_API_TOKEN: API token (required)
 *   OPENCLAW_CONFIG: Path to openclaw.json (optional, default: ~/.openclaw/openclaw.json)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const TELEGRAM_KV_NAMESPACE = "telegram-pairing";
const CONFIG_PATHS = [
  process.env.OPENCLAW_CONFIG,
  path.join(process.env.HOME || "/root", ".openclaw", "openclaw.json"),
  path.join(__dirname, "..", ".openclaw", "openclaw.json"),
];

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

// ============================================================================
// Argument parsing
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    config: null,
    kvNamespaceId: null,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && i + 1 < args.length) {
      opts.config = args[++i];
    } else if (args[i] === "--kv-namespace-id" && i + 1 < args.length) {
      opts.kvNamespaceId = args[++i];
    } else if (args[i] === "--dry-run") {
      opts.dryRun = true;
    } else if (args[i] === "--verbose" || args[i] === "-v") {
      opts.verbose = true;
    }
  }

  return opts;
}

// ============================================================================
// KV Namespace ID Resolution
// ============================================================================

async function resolveKVNamespaceId(namespaceId) {
  if (namespaceId) {
    return namespaceId;
  }

  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set to resolve KV namespace ID"
    );
  }

  // Fetch all KV namespaces for this account
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces`,
    {
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch KV namespaces: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  if (!data.success || !data.result) {
    throw new Error("Failed to list KV namespaces");
  }

  const ns = data.result.find((n) => n.title === TELEGRAM_KV_NAMESPACE);
  if (!ns) {
    throw new Error(
      `KV namespace "${TELEGRAM_KV_NAMESPACE}" not found. Create it first or provide --kv-namespace-id`
    );
  }

  return ns.id;
}

// ============================================================================
// KV Read
// ============================================================================

async function readKVPairingState(namespaceId, accountId = "default") {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required to read KV"
    );
  }

  const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${namespaceId}/keys`;
  const response = await fetch(`${kvUrl}?prefix=telegram:${accountId}:`, {
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to list KV keys: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  if (!data.success) {
    throw new Error("Failed to list KV keys");
  }

  const approvedUsers = [];
  for (const keyObj of data.result) {
    const key = keyObj.name;
    const valueResponse = await fetch(`${kvUrl}/${encodeURIComponent(key)}`, {
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
      },
    });

    if (!valueResponse.ok) {
      console.warn(`Warning: Could not read KV key ${key}`);
      continue;
    }

    const value = await valueResponse.json();
    if (value && value.approved) {
      approvedUsers.push({
        userId: value.userId || key.split(":")[2],
        approved: true,
        approvedAt: value.approvedAt,
        username: value.username,
      });
    }
  }

  return approvedUsers;
}

// ============================================================================
// Config File Management
// ============================================================================

function findConfigFile(providedPath) {
  if (providedPath && fs.existsSync(providedPath)) {
    return providedPath;
  }

  for (const configPath of CONFIG_PATHS) {
    if (configPath && fs.existsSync(configPath)) {
      return configPath;
    }
  }

  throw new Error(
    `Could not find openclaw.json. Checked: ${CONFIG_PATHS.filter(Boolean).join(", ")}`
  );
}

function loadConfig(configPath) {
  const content = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(content);
}

function saveConfig(configPath, config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// ============================================================================
// Sync Logic
// ============================================================================

function mergeApprovedUsers(config, approvedUsers, accountId = "default") {
  const channels = config.channels || {};
  const telegram = channels.telegram || {};

  // Determine config path for this account
  const isDefaultAccount = accountId === "default" || !accountId;
  const basePath = isDefaultAccount
    ? channels.telegram
    : channels.telegram?.accounts?.[accountId];

  if (!basePath) {
    console.warn(`No Telegram config found for account: ${accountId}`);
    return config;
  }

  // Extract existing allowFrom
  const existing = new Set(
    (basePath.allowFrom || []).map((u) => String(u).toLowerCase())
  );

  // Add approved users
  for (const user of approvedUsers) {
    existing.add(String(user.userId).toLowerCase());
  }

  // Update config
  if (isDefaultAccount) {
    config.channels.telegram.allowFrom = Array.from(existing);
    // Ensure dmPolicy allows these users
    if (config.channels.telegram.dmPolicy === "pairing") {
      config.channels.telegram.dmPolicy = "pairing";
    }
  } else {
    if (!config.channels.telegram.accounts) {
      config.channels.telegram.accounts = {};
    }
    if (!config.channels.telegram.accounts[accountId]) {
      config.channels.telegram.accounts[accountId] = {};
    }
    config.channels.telegram.accounts[accountId].allowFrom = Array.from(
      existing
    );
  }

  return config;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs();

  try {
    // Find and load config
    const configPath = findConfigFile(opts.config);
    if (opts.verbose) {
      console.log(`[sync-kv-pairing] Config file: ${configPath}`);
    }
    let config = loadConfig(configPath);

    // Resolve KV namespace ID
    let kvNamespaceId = opts.kvNamespaceId;
    if (!kvNamespaceId) {
      if (opts.verbose) {
        console.log(
          `[sync-kv-pairing] Resolving KV namespace ID for "${TELEGRAM_KV_NAMESPACE}"...`
        );
      }
      kvNamespaceId = await resolveKVNamespaceId();
    }
    if (opts.verbose) {
      console.log(`[sync-kv-pairing] KV namespace ID: ${kvNamespaceId}`);
    }

    // Read pairing state from KV
    if (opts.verbose) {
      console.log(`[sync-kv-pairing] Reading approved users from KV...`);
    }
    const approvedUsers = await readKVPairingState(
      kvNamespaceId,
      "default"
    );
    if (opts.verbose) {
      console.log(`[sync-kv-pairing] Found ${approvedUsers.length} approved users`);
      approvedUsers.forEach((u) => {
        console.log(`  - ${u.userId} (${u.username || "unknown"}) since ${u.approvedAt || "unknown"}`);
      });
    }

    // Merge into config
    const updated = mergeApprovedUsers(config, approvedUsers, "default");

    // Save (unless dry-run)
    if (opts.dryRun) {
      console.log(
        "[sync-kv-pairing] DRY RUN: Would update config with allowFrom:"
      );
      console.log(
        JSON.stringify(updated.channels?.telegram?.allowFrom, null, 2)
      );
    } else {
      saveConfig(configPath, updated);
      console.log(`[sync-kv-pairing] ✅ Synced ${approvedUsers.length} approved users to config`);
      if (opts.verbose) {
        console.log(`[sync-kv-pairing] Updated allowFrom: ${updated.channels?.telegram?.allowFrom?.join(", ")}`);
      }
    }
  } catch (err) {
    console.error(`[sync-kv-pairing] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
