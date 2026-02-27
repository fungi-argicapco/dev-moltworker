/**
 * telegram-kv-pairing-hook.js
 * 
 * Integration hook for Telegram channel plugin.
 * Writes pairing approvals to Cloudflare KV so they persist across reboots.
 * 
 * This module wraps the Telegram channel's pairing.notifyApproval function
 * to also store the approval in KV.
 * 
 * Usage in gateway config:
 *   const hook = require('./telegram-kv-pairing-hook');
 *   hook.install(telegramPlugin);
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Configuration
// ============================================================================

const TELEGRAM_KV_NAMESPACE = "telegram-pairing";

// ============================================================================
// KV Operations
// ============================================================================

async function storeApprovalInKV({
  kvNamespaceId,
  accountId,
  userId,
  username,
  approvedAt,
  metadata,
}) {
  if (!kvNamespaceId) {
    console.warn(
      "[telegram-kv-pairing-hook] KV namespace ID not configured, skipping KV store"
    );
    return;
  }

  const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.warn(
      "[telegram-kv-pairing-hook] CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not set, cannot write to KV"
    );
    return;
  }

  const key = `telegram:${accountId}:${userId}`;
  const value = {
    userId: String(userId),
    accountId,
    approved: true,
    approvedAt: approvedAt || new Date().toISOString(),
    username: username || null,
    metadata: metadata || {},
  };

  const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/${encodeURIComponent(key)}`;

  try {
    const response = await fetch(kvUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    });

    if (!response.ok) {
      console.error(
        `[telegram-kv-pairing-hook] Failed to store approval in KV: ${response.status} ${response.statusText}`
      );
      return;
    }

    console.log(
      `[telegram-kv-pairing-hook] ✅ Stored approval in KV: ${key}`
    );
  } catch (err) {
    console.error(
      `[telegram-kv-pairing-hook] Error writing to KV: ${err.message}`
    );
  }
}

// ============================================================================
// Hook Installation
// ============================================================================

export function installPairingHook(telegramPlugin, { kvNamespaceId, accountId = "default" } = {}) {
  if (!telegramPlugin?.pairing?.notifyApproval) {
    throw new Error(
      "Invalid telegramPlugin: missing pairing.notifyApproval"
    );
  }

  const originalNotifyApproval = telegramPlugin.pairing.notifyApproval;

  // Wrap the approval handler
  telegramPlugin.pairing.notifyApproval = async (ctx) => {
    const { cfg, id } = ctx;
    const resolvedAccountId = accountId || ctx.accountId || "default";

    // First, call the original approval flow (sends message to user)
    const result = await originalNotifyApproval(ctx);

    // Then, store in KV
    await storeApprovalInKV({
      kvNamespaceId,
      accountId: resolvedAccountId,
      userId: id,
      username: ctx.username || null,
      approvedAt: new Date().toISOString(),
      metadata: {
        approvalMethod: "manual",
        channel: ctx.channel || "unknown",
        sessionId: ctx.sessionId || null,
      },
    });

    return result;
  };

  console.log("[telegram-kv-pairing-hook] ✅ Installed pairing approval hook");
  return telegramPlugin;
}

// ============================================================================
// Context Helper (for gateway startup)
// ============================================================================

export function createPairingHookContext({
  kvNamespaceId,
  accountId = "default",
  cfAccountId,
  cfApiToken,
} = {}) {
  // Set environment if provided
  if (cfAccountId) {
    process.env.CLOUDFLARE_ACCOUNT_ID = cfAccountId;
  }
  if (cfApiToken) {
    process.env.CLOUDFLARE_API_TOKEN = cfApiToken;
  }

  return {
    kvNamespaceId,
    accountId,
  };
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  installPairingHook,
  createPairingHookContext,
  storeApprovalInKV,
};
