/**
 * Omega Conversation History — KV-backed per-user message buffer
 *
 * Stores the last N user/assistant message pairs per Telegram user
 * so Omega maintains conversational continuity across turns.
 *
 * Storage: KV key `convo:{userId}` → JSON array of messages
 */

const MAX_HISTORY_TURNS = 10; // 10 user/assistant pairs = 20 messages
const CONVO_KEY_PREFIX = 'convo:';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Load conversation history for a user from KV.
 */
export async function loadConversationHistory(
  kv: KVNamespace,
  userId: number,
): Promise<ConversationMessage[]> {
  const key = `${CONVO_KEY_PREFIX}${userId}`;
  const stored = await kv.get(key, 'json') as ConversationMessage[] | null;
  return stored || [];
}

/**
 * Save conversation history, capping at MAX_HISTORY_TURNS pairs.
 * Appends user + assistant messages, trims oldest if exceeding limit.
 */
export async function saveConversationTurn(
  kv: KVNamespace,
  userId: number,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  const key = `${CONVO_KEY_PREFIX}${userId}`;
  const existing = await kv.get(key, 'json') as ConversationMessage[] | null;
  const history = existing || [];

  const now = new Date().toISOString();

  // Append the new turn
  history.push(
    { role: 'user', content: userMessage, timestamp: now },
    { role: 'assistant', content: assistantResponse, timestamp: now },
  );

  // Cap at MAX_HISTORY_TURNS * 2 messages (user + assistant each)
  const maxMessages = MAX_HISTORY_TURNS * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }

  // TTL: 24 hours — conversations older than a day reset naturally
  await kv.put(key, JSON.stringify(history), { expirationTtl: 86400 });
}

/**
 * Format conversation history for the AI messages array.
 * Strips timestamps and returns only role/content pairs.
 */
export function historyToMessages(
  history: ConversationMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history.map(({ role, content }) => ({ role, content }));
}
