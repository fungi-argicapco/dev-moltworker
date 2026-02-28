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
 * E.g., agent "sre" with action "health_check" →
 *   "You are the SRE agent. Perform a: health check. Provide a concise summary."
 */
export function buildAgentPrompt(agentName: string, action: string): string {
  const readableAction = action.replace(/_/g, ' ');
  const readableName = agentName.replace(/-/g, ' ');
  return `You are the ${readableName} agent. Perform a: ${readableAction}. Provide a concise summary suitable for a Telegram message (max 4000 chars, use markdown formatting).`;
}

/**
 * Get welcome text from config
 */
export function getWelcomeText(): string {
  const welcome = menus['help_menu'];
  return welcome?.text || '👋 Welcome! Use the menu commands to interact with agent teams.';
}
