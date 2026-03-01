/**
 * Telegram Menu Configuration
 *
 * Loads telegram-menu.json and provides helpers for building
 * Telegram InlineKeyboardMarkup from the menu config.
 */

import menuConfig from '../../config/telegram-menu.json';

// ============================================================================
// Types
// ============================================================================

interface TelegramButton {
  text: string;
  callback_data: string;
}

interface MenuEntry {
  text: string;
  buttons: TelegramButton[][];
}

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

// ============================================================================
// Menu Lookups
// ============================================================================

const menus = (menuConfig as Record<string, unknown>).inline_keyboards as Record<string, MenuEntry>;

/**
 * Map slash commands to menu keys.
 * /finance → finance_menu, /product → product_menu, etc.
 */
const COMMAND_TO_MENU: Record<string, string> = {
  '/start': 'help_menu',
  '/help': 'help_menu',
  '/finance': 'finance_menu',
  '/legal': 'legal_menu',
  '/security': 'security_menu',
  '/ops': 'ops_menu',
  '/growth': 'growth_menu',
  '/product': 'product_menu',
  '/teams': 'team_menu',
  '/team': 'team_menu',
  '/talent': 'team_menu', // talent shows via team overview for now
  '/platform': 'team_menu', // platform shows via team overview for now
};

/**
 * Map callback_data menu: prefixes to menu keys.
 * menu:finance → finance_menu, menu:security → security_menu, etc.
 */
const CALLBACK_TO_MENU: Record<string, string> = {
  'menu:finance': 'finance_menu',
  'menu:legal': 'legal_menu',
  'menu:security': 'security_menu',
  'menu:ops': 'ops_menu',
  'menu:growth': 'growth_menu',
  'menu:product': 'product_menu',
  'menu:teams': 'team_menu',
};

// ============================================================================
// Exports
// ============================================================================

/**
 * Get menu config by slash command (e.g., "/finance")
 */
export function getMenuForCommand(command: string): MenuEntry | null {
  const menuKey = COMMAND_TO_MENU[command];
  if (!menuKey) return null;
  return menus[menuKey] || null;
}

/**
 * Get menu config by callback_data (e.g., "menu:finance")
 */
export function getMenuForCallback(callbackData: string): MenuEntry | null {
  const menuKey = CALLBACK_TO_MENU[callbackData];
  if (!menuKey) return null;
  return menus[menuKey] || null;
}

/**
 * Build InlineKeyboardMarkup from a MenuEntry.
 * Adds a "← Back to Teams" button at the bottom of sub-menus.
 */
export function buildKeyboard(menu: MenuEntry, addBackButton = false): InlineKeyboardMarkup {
  const keyboard: InlineKeyboardButton[][] = menu.buttons.map((row) =>
    row.map((btn) => ({
      text: btn.text,
      callback_data: btn.callback_data,
    })),
  );

  if (addBackButton) {
    keyboard.push([{ text: '← Back to Teams', callback_data: 'menu:teams' }]);
  }

  return { inline_keyboard: keyboard };
}

/**
 * Parse callback_data into its components.
 *
 * Format: "agent:{name}:{action}" or "menu:{name}"
 *
 * Returns:
 *  - { type: 'menu', menuId: 'finance' }
 *  - { type: 'agent', agentName: 'sre', action: 'health_check' }
 *  - null if unparseable
 */
export function parseCallbackData(
  data: string,
): { type: 'menu'; menuId: string } | { type: 'agent'; agentName: string; action: string } | null {
  if (data.startsWith('menu:')) {
    return { type: 'menu', menuId: data };
  }
  if (data.startsWith('agent:')) {
    const parts = data.split(':');
    if (parts.length >= 3) {
      return {
        type: 'agent',
        agentName: parts[1],
        action: parts.slice(2).join(':'),
      };
    }
  }
  return null;
}

/**
 * Build a prompt for an agent from callback_data action.
 *
 * When registry is provided, injects the agent's full SKILL.md content
 * as its system prompt — giving it deep knowledge of its role, capabilities,
 * tools, output formats, and security boundaries.
 *
 * Falls back to a generic prompt when registry is not provided.
 */
export function buildAgentPrompt(
  agentName: string,
  action: string,
  registry?: { agents: Record<string, { skillContent?: string; description?: string }> },
): string {
  const readableAction = action.replace(/_/g, ' ');
  const readableName = agentName.replace(/-/g, ' ');

  // Current date context
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const fiscalYear = now.getFullYear();

  // Try to load agent's SKILL.md content from registry
  const agentEntry = registry?.agents?.[agentName] || registry?.agents?.[`${agentName}-agent`];
  const skillContent = agentEntry?.skillContent;

  if (skillContent) {
    // Rich prompt using SKILL.md
    return [
      skillContent,
      '',
      '---',
      '',
      `Today is ${dateStr}. Current quarter: Q${quarter} ${fiscalYear}.`,
      `Task: ${readableAction}.`,
      '',
      'Provide a concise, actionable response suitable for a Telegram message (max 4000 chars, use markdown formatting).',
      'IMPORTANT: Use real dates relative to today. Do NOT use placeholder amounts — if you don\'t have real data, say so explicitly.',
    ].join('\n');
  }

  // Fallback: generic prompt when no SKILL.md available
  return [
    `You are the ${readableName} agent.`,
    `Today is ${dateStr}. Current quarter: Q${quarter} ${fiscalYear}. Fiscal year: ${fiscalYear}.`,
    `Task: ${readableAction}.`,
    `Provide a concise, actionable summary suitable for a Telegram message (max 4000 chars, use markdown formatting).`,
    `IMPORTANT: Use real dates relative to today. Do NOT use placeholder amounts like "$X,XXX" — if you don't have real data, say so explicitly.`,
  ].join('\n');
}

/**
 * Get welcome text from config
 */
export function getWelcomeText(): string {
  const welcome = menus['help_menu'];
  return welcome?.text || '👋 Welcome! Use the menu commands to interact with agent teams.';
}

/**
 * Get Omega's CLI context — dynamically generated from the live menu config.
 * This ensures Omega always knows every command that exists.
 */
export function getOmegaCliContext(): string {
  const config = menuConfig as {
    bot_commands: Array<{ command: string; description: string }>;
    inline_keyboards: Record<string, { text: string; buttons: Array<Array<{ text: string; callback_data: string }>> }>;
  };

  // Build command list from bot_commands (the source of truth)
  const commandLines = config.bot_commands.map(
    (cmd) => `/${cmd.command} — ${cmd.description}`,
  );

  // Build team menu details — what each team offers
  const teamDetails: string[] = [];
  for (const [menuKey, menu] of Object.entries(config.inline_keyboards)) {
    if (menuKey === 'help_menu' || menuKey === 'team_menu') continue;
    const teamName = menu.text.split('\n')[0];
    const actions = menu.buttons
      .flat()
      .filter((btn) => btn.callback_data.startsWith('agent:'))
      .map((btn) => `  • ${btn.text}`);
    if (actions.length > 0) {
      teamDetails.push(`${teamName}\n${actions.join('\n')}`);
    }
  }

  return [
    'AVAILABLE SLASH COMMANDS (from live config — these ALL work):',
    ...commandLines,
    '',
    'TEAM MENUS AND THEIR AGENT ACTIONS:',
    ...teamDetails,
    '',
    'IMPORTANT: Every command listed above is real and functional.',
    'NEVER deny a command exists if it is in this list.',
    'When a user asks about a topic, suggest the most relevant command.',
    'You can also answer questions directly — use commands as tools.',
  ].join('\n');
}
