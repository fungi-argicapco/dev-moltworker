/**
 * Telegram Webhook Handler
 *
 * Intercepts Telegram webhook updates before the catch-all OpenClaw proxy.
 * Handles:
 *   1. Slash commands (/finance, /product, etc.) → render inline keyboards
 *   2. Callback queries with "menu:*" → navigate between team sub-menus
 *   3. Callback queries with "agent:*" → invoke agent via OpenClaw gateway
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ensureMoltbotGateway } from '../gateway';
import { MOLTBOT_PORT } from '../config';
import {
  getMenuForCommand,
  getMenuForCallback,
  buildKeyboard,
  parseCallbackData,
  buildAgentPrompt,
  getWelcomeText,
} from './telegram-menus';

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
// Agent Invocation via OpenClaw Gateway
// ============================================================================

/**
 * Invoke an agent by sending a prompt through the OpenClaw gateway's HTTP API.
 *
 * OpenClaw exposes a simple chat endpoint on its HTTP port.
 * We send the agent prompt as a user message and collect the response.
 */
async function invokeAgent(
  sandbox: AppEnv['Variables']['sandbox'],
  env: AppEnv['Bindings'],
  prompt: string,
): Promise<string> {
  try {
    // Ensure gateway is running
    await ensureMoltbotGateway(sandbox, env);

    // Use the OpenClaw REST-style chat endpoint inside the container
    // This communicates with the AI via the configured gateway
    const token = env.MOLTBOT_GATEWAY_TOKEN || '';
    const gatewayUrl = `http://localhost:${MOLTBOT_PORT}/api/v1/chat`;

    const request = new Request(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: prompt,
      }),
    });
    const response = await sandbox.containerFetch(request, MOLTBOT_PORT);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Telegram] Gateway response error:', response.status, errText);
      return `⚠️ Agent unavailable (gateway returned ${response.status}). Try again later.`;
    }

    const data = (await response.json()) as Record<string, unknown>;
    // OpenClaw returns { response: "..." } or { message: "..." }
    const agentResponse =
      (data.response as string) || (data.message as string) || (data.text as string);

    if (!agentResponse) {
      console.error('[Telegram] No response field in gateway reply:', JSON.stringify(data));
      return '⚠️ Agent returned an empty response. The gateway may still be initializing.';
    }

    return agentResponse;
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

      // Build the prompt and invoke
      const prompt = buildAgentPrompt(parsed.agentName, parsed.action);
      const sandbox = c.get('sandbox');
      const response = await invokeAgent(sandbox, c.env, prompt);

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
