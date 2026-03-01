/**
 * Telegram Webhook Handler
 *
 * Intercepts Telegram webhook updates before the catch-all OpenClaw proxy.
 * Handles:
 *   1. Slash commands (/finance, /product, etc.) → render inline keyboards
 *   2. Callback queries with "menu:*" → navigate between team sub-menus
 *   3. Callback queries with "agent:*" → invoke agent via AI Gateway (Unified Billing)
 *      Routes by model tier from config/model-routing.json:
 *        - free/light → Workers AI models via workers-ai/ gateway path
 *        - mid/premium → Anthropic via anthropic/v1/messages gateway path
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { callMcpTool, MCP_SERVERS } from '../integrations/mcp-client';
import {
  getMenuForCommand,
  getMenuForCallback,
  buildKeyboard,
  parseCallbackData,
  buildAgentPrompt,
  getWelcomeText,
} from './telegram-menus';

// ============================================================================
// Telegram IP Allowlist
// ============================================================================

/**
 * Telegram's published webhook IP ranges (IPv4).
 * Source: https://core.telegram.org/bots/webhooks#the-short-version
 * Monitor @BotNews on Telegram for changes.
 */
const TELEGRAM_CIDRS = [
  { network: 0x959A_A000, mask: 0xFFFF_F000 }, // 149.154.160.0/20
  { network: 0x5B6C_0400, mask: 0xFFFF_FC00 }, // 91.108.4.0/22
];

/**
 * Parse an IPv4 address string to a 32-bit integer.
 */
function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  // Convert to unsigned 32-bit
  return result >>> 0;
}

/**
 * Check if an IP address falls within Telegram's published webhook CIDR ranges.
 */
function isFromTelegram(ip: string): boolean {
  const ipInt = ipToInt(ip);
  if (ipInt === null) {
    // Not a valid IPv4 — reject
    console.error(`[Telegram] Cannot parse IP: ${ip}`);
    return false;
  }
  return TELEGRAM_CIDRS.some((cidr) => (ipInt & cidr.mask) === cidr.network);
}

// ============================================================================
// Telegram API Helpers
// ============================================================================

/**
 * Get the active Telegram bot token from environment.
 * Prefers HARDSHELL_TELEGRAM_BOT_TOKEN, falls back to TELEGRAM_BOT_TOKEN.
 */
function getBotToken(env: AppEnv['Bindings']): string | null {
  return env.HARDSHELL_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || null;
}

/**
 * Call the Telegram Bot API.
 */
async function callTelegramApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    console.error(`[Telegram] API error: ${method}`, JSON.stringify(result));
  }
  return result;
}

/**
 * Send a message with an inline keyboard.
 */
async function sendMenu(
  token: string,
  chatId: number,
  text: string,
  keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
): Promise<void> {
  await callTelegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Edit an existing message to show a different menu (for callback navigation).
 */
async function editMenu(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
): Promise<void> {
  await callTelegramApi(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Answer a callback query (removes "loading" spinner on button).
 */
async function answerCallback(token: string, callbackQueryId: string, text?: string): Promise<void> {
  await callTelegramApi(token, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text || undefined,
  });
}

/**
 * Send a text message (agent response).
 */
async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  // Telegram has a 4096 char limit per message
  const maxLen = 4000;
  if (text.length > maxLen) {
    // Split into chunks
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.slice(i, i + maxLen));
    }
    for (const chunk of chunks) {
      await callTelegramApi(token, 'sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      });
    }
  } else {
    await callTelegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    });
  }
}

/**
 * Send a "typing" indicator.
 */
async function sendTyping(token: string, chatId: number): Promise<void> {
  await callTelegramApi(token, 'sendChatAction', {
    chat_id: chatId,
    action: 'typing',
  });
}

// ============================================================================
// Agent Invocation via Cloudflare AI Gateway (Unified Billing)
// ============================================================================

import modelRoutingConfig from '../../config/model-routing.json';

type ModelTier = 'free' | 'light' | 'mid' | 'premium';

interface TierConfig {
  model: string;
  description: string;
  cost_per_1m_tokens: number;
}

const tiers = modelRoutingConfig.tiers as Record<ModelTier, TierConfig>;
const agentTiers = modelRoutingConfig.agent_tiers as Record<string, ModelTier>;

/**
 * Resolve the model tier for an agent name.
 * Falls back to "free" if the agent isn't in the config.
 */
function resolveModelForAgent(agentName: string): { model: string; tier: ModelTier } {
  const tier = agentTiers[`${agentName}-agent`] || agentTiers[agentName] || 'free';
  const config = tiers[tier] || tiers['free'];
  return { model: config.model, tier };
}

/**
 * Invoke an agent by sending a prompt via Cloudflare AI Gateway.
 *
 * Routes through the appropriate provider based on model tier:
 * - Workers AI models (free/light): `workers-ai/` provider path
 * - Anthropic models (mid/premium): `anthropic/v1/messages` provider path
 *
 * All calls go through AI Gateway for Unified Billing.
 */
async function invokeAgent(
  env: AppEnv['Bindings'],
  prompt: string,
  agentName?: string,
): Promise<string> {
  try {
    const accountId = env.CF_AI_GATEWAY_ACCOUNT_ID;
    const gatewayId = env.CF_AI_GATEWAY_GATEWAY_ID;
    const apiKey = env.CLOUDFLARE_AI_GATEWAY_API_KEY;

    if (!accountId || !gatewayId || !apiKey) {
      console.error('[Telegram] AI Gateway not configured');
      return '⚠️ AI Gateway is not configured. Set CF_AI_GATEWAY_* secrets.';
    }

    // Resolve model based on agent tier
    const { model, tier } = agentName
      ? resolveModelForAgent(agentName)
      : { model: env.CF_AI_GATEWAY_MODEL || 'anthropic/claude-sonnet-4-6', tier: 'mid' as ModelTier };

    const isWorkersAI = model.startsWith('workers-ai/');
    const modelId = isWorkersAI ? model.replace('workers-ai/', '') : model;

    console.log(`[Telegram] Agent: ${agentName || 'default'}, tier: ${tier}, model: ${modelId}, provider: ${isWorkersAI ? 'workers-ai' : 'anthropic'}`);

    if (isWorkersAI) {
      // Workers AI models via binding (auto-authenticated, no token needed)
      // Routes through AI Gateway for logging/rate limiting via the gateway option
      if (!env.AI) {
        console.error('[Telegram] Workers AI binding not configured');
        return '⚠️ Workers AI binding not configured. Add "ai" binding to wrangler config.';
      }

      const gatewayId = env.CF_AI_GATEWAY_GATEWAY_ID;

      const result = await env.AI.run(
        modelId as Parameters<typeof env.AI.run>[0],
        {
          messages: [
            { role: 'user' as const, content: prompt },
          ],
          max_tokens: 2048,
        },
        gatewayId ? { gateway: { id: gatewayId, skipCache: true } } : undefined,
      );

      // env.AI.run returns { response: "..." } for text generation models
      const aiResult = result as { response?: string };
      const agentResponse = aiResult.response || '';

      if (!agentResponse) {
        console.error('[Telegram] Empty Workers AI response:', JSON.stringify(result));
        return '⚠️ Agent returned an empty response.';
      }

      return agentResponse;
    } else {
      // Anthropic models via AI Gateway (Unified Billing)
      // model format: "anthropic/claude-sonnet-4-20250514" → extract model name
      const anthropicModel = modelId.startsWith('anthropic/')
        ? modelId.replace('anthropic/', '')
        : modelId;

      const url = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/anthropic/v1/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-aig-authorization': `Bearer ${apiKey}`,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: anthropicModel,
          max_tokens: 2048,
          messages: [
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Telegram] Anthropic error (${tier}):`, response.status, errText);
        return `⚠️ Agent unavailable (AI Gateway returned ${response.status}). Try again later.`;
      }

      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };

      const textBlocks = data.content?.filter((b) => b.type === 'text') || [];
      const agentResponse = textBlocks.map((b) => b.text || '').join('\n');

      if (!agentResponse) {
        console.error('[Telegram] Empty Anthropic response:', JSON.stringify(data));
        return '⚠️ Agent returned an empty response.';
      }

      return agentResponse;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Telegram] Agent invocation failed:', msg);
    return `⚠️ Failed to reach agent: ${msg}`;
  }
}

// ============================================================================
// Webhook Route
// ============================================================================

const telegram = new Hono<AppEnv>();

/**
 * POST /webhook
 *
 * Receives Telegram webhook updates. This is mounted at /api/telegram/webhook
 * in the main app, BEFORE the catch-all proxy to OpenClaw.
 *
 * Update types handled:
 *   - message with /command text → render menu inline keyboard
 *   - callback_query with menu:* → navigate sub-menus
 *   - callback_query with agent:* → invoke agent and return response
 */
telegram.post('/webhook', async (c) => {
  // ── Layer 1: Validate source IP against Telegram's published ranges ──
  const clientIp = c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || '';
  if (!isFromTelegram(clientIp)) {
    console.error(`[Telegram] Rejected webhook from non-Telegram IP: ${clientIp}`);
    return c.json({ ok: false }, 403);
  }

  // ── Layer 2: Validate secret token ──
  // (moved before JSON parsing to short-circuit unauthorized requests)
  const webhookSecret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const receivedToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (receivedToken !== webhookSecret) {
      console.error('[Telegram] Invalid webhook secret token');
      return c.json({ ok: false }, 403);
    }
  }

  const botToken = getBotToken(c.env);
  if (!botToken) {
    console.error('[Telegram] No bot token configured');
    return c.json({ ok: false, error: 'No bot token' }, 500);
  }

  let update: Record<string, unknown>;
  try {
    update = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }


  // ── Handle slash commands ────────────────────────────────────────────
  const message = update.message as Record<string, unknown> | undefined;
  if (message?.text) {
    const text = (message.text as string).trim();
    const chatId = (message.chat as Record<string, unknown>).id as number;

    // Extract command (handle "@botname" suffix)
    const commandMatch = text.match(/^(\/\w+)(@\w+)?/);
    if (commandMatch) {
      const command = commandMatch[1];

      // Special: /start and /help show welcome
      if (command === '/start' || command === '/help') {
        const welcomeText = getWelcomeText();
        const teamMenu = getMenuForCommand('/teams');
        if (teamMenu) {
          await sendMenu(botToken, chatId, welcomeText, buildKeyboard(teamMenu));
        } else {
          await sendMessage(botToken, chatId, welcomeText);
        }
        return c.json({ ok: true });
      }

      // Slash command → team menu
      const menu = getMenuForCommand(command);
      if (menu) {
        await sendMenu(botToken, chatId, menu.text, buildKeyboard(menu, true));
        return c.json({ ok: true });
      }
    }

    // Not a recognized command — let it fall through to OpenClaw
    // by NOT returning here. The catch-all proxy will handle it.
    // But since this is a webhook, we need to return OK to Telegram.
    // The message will be processed by OpenClaw's own Telegram handler.
    return c.json({ ok: true });
  }

  // ── Handle callback queries (button taps) ──────────────────────────
  const callbackQuery = update.callback_query as Record<string, unknown> | undefined;
  if (callbackQuery) {
    const data = callbackQuery.data as string;
    const callbackId = callbackQuery.id as string;
    const chatId = ((callbackQuery.message as Record<string, unknown>)?.chat as Record<string, unknown>)
      ?.id as number;
    const messageId = (callbackQuery.message as Record<string, unknown>)?.message_id as number;

    if (!data || !chatId) {
      await answerCallback(botToken, callbackId, '⚠️ Invalid callback');
      return c.json({ ok: true });
    }

    const parsed = parseCallbackData(data);

    if (!parsed) {
      await answerCallback(botToken, callbackId, '⚠️ Unknown action');
      return c.json({ ok: true });
    }

    // Menu navigation
    if (parsed.type === 'menu') {
      const menu = getMenuForCallback(parsed.menuId);
      if (menu) {
        const isSubMenu = parsed.menuId !== 'menu:teams';
        try {
          await editMenu(botToken, chatId, messageId, menu.text, buildKeyboard(menu, isSubMenu));
        } catch {
          // editMessageText fails if content hasn't changed — ignore
          await sendMenu(botToken, chatId, menu.text, buildKeyboard(menu, isSubMenu));
        }
        await answerCallback(botToken, callbackId);
      } else {
        await answerCallback(botToken, callbackId, '⚠️ Menu not found');
      }
      return c.json({ ok: true });
    }

    // Agent invocation
    if (parsed.type === 'agent') {
      // Acknowledge the tap immediately
      await answerCallback(botToken, callbackId, `🧠 Invoking ${parsed.agentName}...`);

      // Show typing indicator
      await sendTyping(botToken, chatId);

      let response: string;

      // Direct data integrations via MCP servers
      if (parsed.agentName === 'treasury' && parsed.action === 'cash_brief') {
        // Treasury cash brief: fetch from Mercury MCP server (no LLM needed)
        try {
          response = await callMcpTool(MCP_SERVERS.mercury, 'get_cash_brief');
        } catch (err) {
          console.error('[Telegram] Mercury MCP error:', err);
          response = `⚠️ Failed to fetch Mercury data: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      } else if (
        parsed.agentName === 'tax-strategist' ||
        parsed.agentName === 'controller' ||
        parsed.agentName === 'financial-analyst'
      ) {
        // Financial agents: inject real data context from MCP servers into LLM prompt
        let dataContext = '';
        try {
          const [mercuryData, stripeData] = await Promise.allSettled([
            callMcpTool(MCP_SERVERS.mercury, 'get_accounts'),
            callMcpTool(MCP_SERVERS.stripe, 'get_revenue_summary', { period: 'qtd' }),
          ]);
          if (mercuryData.status === 'fulfilled') {
            dataContext += `\n\n## Mercury Bank Accounts (Real Data)\n${mercuryData.value}`;
          }
          if (stripeData.status === 'fulfilled') {
            dataContext += `\n\n## Stripe Revenue Summary (Real Data)\n${stripeData.value}`;
          }
        } catch (err) {
          console.error('[Telegram] MCP data fetch error:', err);
        }

        const prompt = buildAgentPrompt(parsed.agentName, parsed.action) + dataContext;
        response = await invokeAgent(c.env, prompt, parsed.agentName);
      } else {
        // All other agents: invoke via AI model (no data injection)
        const prompt = buildAgentPrompt(parsed.agentName, parsed.action);
        response = await invokeAgent(c.env, prompt, parsed.agentName);
      }

      // Send the agent's response
      const header = `🤖 *${parsed.agentName.replace(/-/g, ' ')}* → _${parsed.action.replace(/_/g, ' ')}_\n\n`;
      await sendMessage(botToken, chatId, header + response);

      return c.json({ ok: true });
    }
  }

  // Unhandled update type — return OK to prevent Telegram from retrying
  return c.json({ ok: true });
});

/**
 * POST /set-webhook
 *
 * Admin endpoint to register the webhook URL with Telegram.
 * Call once after deployment to point Telegram at this worker.
 *
 * Example: POST /api/telegram/set-webhook { "url": "https://your-worker.workers.dev/api/telegram/webhook" }
 */
telegram.post('/set-webhook', async (c) => {
  const botToken = getBotToken(c.env);
  if (!botToken) {
    return c.json({ ok: false, error: 'No bot token configured' }, 500);
  }

  let body: { url?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (!body.url) {
    return c.json({ ok: false, error: 'url is required' }, 400);
  }

  const result = await callTelegramApi(botToken, 'setWebhook', {
    url: body.url,
    allowed_updates: ['message', 'callback_query'],
    // Include secret_token if configured — Telegram will send it as
    // X-Telegram-Bot-Api-Secret-Token header with every webhook request
    ...(c.env.TELEGRAM_WEBHOOK_SECRET ? { secret_token: c.env.TELEGRAM_WEBHOOK_SECRET } : {}),
  });

  return c.json(result);
});

/**
 * DELETE /set-webhook
 *
 * Remove the webhook (for debugging — reverts to polling mode).
 */
telegram.delete('/set-webhook', async (c) => {
  const botToken = getBotToken(c.env);
  if (!botToken) {
    return c.json({ ok: false, error: 'No bot token configured' }, 500);
  }

  const result = await callTelegramApi(botToken, 'deleteWebhook', {});
  return c.json(result);
});

/**
 * GET /webhook-info
 *
 * Get current webhook status from Telegram.
 */
telegram.get('/webhook-info', async (c) => {
  const botToken = getBotToken(c.env);
  if (!botToken) {
    return c.json({ ok: false, error: 'No bot token configured' }, 500);
  }

  const result = await callTelegramApi(botToken, 'getWebhookInfo', {});
  return c.json(result);
});

export { telegram };
