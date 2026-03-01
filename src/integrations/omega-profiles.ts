/**
 * Omega User Profile — Persistent knowledge graph per user
 *
 * Stores observations about each user's cognition, communication style,
 * goals, and preferences. Grows over time as Omega learns each person.
 *
 * Storage: Cloudflare KV (OMEGA_PROFILES) keyed by Telegram user ID.
 */

export interface UserProfile {
  /** Telegram user ID */
  userId: number;
  /** Display name from Telegram */
  displayName: string;
  /** First interaction timestamp */
  firstSeen: string;
  /** Last interaction timestamp */
  lastSeen: string;
  /** Total messages exchanged */
  interactionCount: number;
  /** Omega's confidence in understanding this user (0-100) */
  understandingConfidence: number;
  /** Observed communication preferences */
  communication: {
    /** Detected style: 'concise' | 'detailed' | 'unknown' */
    preferredStyle: 'concise' | 'detailed' | 'unknown';
    /** Average message length sent by user */
    avgMessageLength: number;
    /** Tone observations: casual, formal, technical, mixed */
    tone: string;
  };
  /** Topics the user frequently asks about */
  topicFrequency: Record<string, number>;
  /** Omega's observations — freeform notes that grow over time */
  observations: string[];
  /** Goals or priorities the user has expressed */
  goals: string[];
  /** Teams/commands the user uses most */
  frequentCommands: Record<string, number>;
}

const DEFAULT_PROFILE: Omit<UserProfile, 'userId' | 'displayName' | 'firstSeen' | 'lastSeen'> = {
  interactionCount: 0,
  understandingConfidence: 0,
  communication: {
    preferredStyle: 'unknown',
    avgMessageLength: 0,
    tone: 'unknown',
  },
  topicFrequency: {},
  observations: [],
  goals: [],
  frequentCommands: {},
};

/**
 * Load a user profile from KV. Returns a new profile if none exists.
 */
export async function loadProfile(
  kv: KVNamespace,
  userId: number,
  displayName: string,
): Promise<UserProfile> {
  const key = `user:${userId}`;
  const stored = await kv.get(key, 'json') as UserProfile | null;

  if (stored) {
    return stored;
  }

  // First interaction — create new profile
  const now = new Date().toISOString();
  return {
    ...DEFAULT_PROFILE,
    userId,
    displayName,
    firstSeen: now,
    lastSeen: now,
  };
}

/**
 * Save a user profile to KV.
 */
export async function saveProfile(kv: KVNamespace, profile: UserProfile): Promise<void> {
  const key = `user:${profile.userId}`;
  await kv.put(key, JSON.stringify(profile));
}

/**
 * Update profile after an interaction. Tracks:
 * - Interaction count
 * - Message length patterns
 * - Timestamp
 * - Topic detection (basic keyword matching)
 */
export function updateProfileAfterInteraction(
  profile: UserProfile,
  userMessage: string,
): UserProfile {
  const now = new Date().toISOString();
  const msgLen = userMessage.length;

  // Update basics
  profile.lastSeen = now;
  profile.interactionCount += 1;

  // Update communication style based on message length
  const prevAvg = profile.communication.avgMessageLength;
  const count = profile.interactionCount;
  profile.communication.avgMessageLength = Math.round(
    (prevAvg * (count - 1) + msgLen) / count,
  );

  // Detect concise vs detailed preference
  if (count >= 3) {
    profile.communication.preferredStyle =
      profile.communication.avgMessageLength < 50 ? 'concise' : 'detailed';
  }

  // Basic topic detection
  const topicKeywords: Record<string, string[]> = {
    finance: ['cash', 'money', 'balance', 'revenue', 'tax', 'payment', 'invoice', 'p&l', 'budget'],
    legal: ['contract', 'compliance', 'hipaa', 'nda', 'legal', 'law', 'regulation'],
    infrastructure: ['deploy', 'server', 'worker', 'api', 'endpoint', 'database', 'sre'],
    growth: ['marketing', 'campaign', 'pipeline', 'client', 'lead', 'crm', 'growth'],
    product: ['feature', 'roadmap', 'release', 'sprint', 'backlog', 'product'],
    security: ['security', 'token', 'auth', 'access', 'firewall', 'zero trust'],
  };

  const lowerMsg = userMessage.toLowerCase();
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((kw) => lowerMsg.includes(kw))) {
      profile.topicFrequency[topic] = (profile.topicFrequency[topic] || 0) + 1;
    }
  }

  // Update understanding confidence based on interaction count
  // Logarithmic growth: rapid early gains, slower later
  profile.understandingConfidence = Math.min(
    100,
    Math.round(30 * Math.log2(profile.interactionCount + 1)),
  );

  return profile;
}

/**
 * Build a context string from the profile for Omega's system prompt.
 */
export function profileToContext(profile: UserProfile): string {
  const lines: string[] = [
    `## User Context (Understanding Confidence: ${profile.understandingConfidence}%)`,
  ];

  if (profile.interactionCount <= 1) {
    lines.push('This is a new user. Be curious. Ask about their goals and how they prefer information.');
    return lines.join('\n');
  }

  lines.push(`- ${profile.displayName}: ${profile.interactionCount} interactions since ${new Date(profile.firstSeen).toLocaleDateString()}`);

  if (profile.communication.preferredStyle !== 'unknown') {
    lines.push(`- Prefers ${profile.communication.preferredStyle} responses`);
  }

  if (profile.communication.tone !== 'unknown') {
    lines.push(`- Communication tone: ${profile.communication.tone}`);
  }

  // Top topics
  const sortedTopics = Object.entries(profile.topicFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  if (sortedTopics.length > 0) {
    lines.push(`- Top interests: ${sortedTopics.map(([t, c]) => `${t} (${c}x)`).join(', ')}`);
  }

  // Goals
  if (profile.goals.length > 0) {
    lines.push(`- Known goals: ${profile.goals.join('; ')}`);
  }

  // Observations
  if (profile.observations.length > 0) {
    const recent = profile.observations.slice(-5);
    lines.push(`- Observations: ${recent.join('; ')}`);
  }

  return lines.join('\n');
}
