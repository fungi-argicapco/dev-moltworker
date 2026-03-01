/**
 * Omega User Profile — Persistent knowledge graph per user
 *
 * Stores observations about each user's cognition, communication style,
 * goals, and preferences. Grows over time as Omega learns each person.
 *
 * Storage: Cloudflare KV (OMEGA_PROFILES) keyed by Telegram user ID.
 * Backups: R2 (MOLTBOT_BUCKET) under omega-profiles/ prefix.
 */

// Current schema version — increment when adding/changing fields
const CURRENT_SCHEMA_VERSION = 2;

export interface UserProfile {
  /** Schema version for migration */
  schemaVersion: number;
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

// ============================================================================
// Schema Migration
// ============================================================================

/**
 * Migrate a profile from any older schema version to the current version.
 * Always additive — never removes fields, only adds defaults for new ones.
 */
function migrateProfile(raw: Record<string, unknown>): UserProfile {
  const version = (raw.schemaVersion as number) || 1;

  // v1 → v2: added schemaVersion, goals, frequentCommands
  if (version < 2) {
    if (!raw.goals) raw.goals = [];
    if (!raw.frequentCommands) raw.frequentCommands = {};
    if (!raw.observations) raw.observations = [];
  }

  // Future migrations go here:
  // if (version < 3) { ... }

  raw.schemaVersion = CURRENT_SCHEMA_VERSION;
  return raw as unknown as UserProfile;
}

// ============================================================================
// Load / Save
// ============================================================================

/**
 * Load a user profile from KV. Returns a new profile if none exists.
 * Automatically migrates older schema versions.
 */
export async function loadProfile(
  kv: KVNamespace,
  userId: number,
  displayName: string,
): Promise<UserProfile> {
  const key = `user:${userId}`;
  const stored = await kv.get(key, 'json') as Record<string, unknown> | null;

  if (stored) {
    // Migrate if needed
    const profile = migrateProfile(stored);
    // Update display name in case it changed
    profile.displayName = displayName;
    return profile;
  }

  // First interaction — create new profile
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    userId,
    displayName,
    firstSeen: now,
    lastSeen: now,
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
}

/**
 * Save a user profile to KV.
 */
export async function saveProfile(kv: KVNamespace, profile: UserProfile): Promise<void> {
  const key = `user:${profile.userId}`;
  await kv.put(key, JSON.stringify(profile));
}

// ============================================================================
// Profile Update Logic
// ============================================================================

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

// ============================================================================
// Context Generation
// ============================================================================

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

  // Use explicit Intl.DateTimeFormat for reliable timezone conversion on Workers
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
  const firstSeenDate = formatter.format(new Date(profile.firstSeen));

  lines.push(`- ${profile.displayName}: ${profile.interactionCount} interactions since ${firstSeenDate}`);

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

// ============================================================================
// R2 Backup & Restore
// ============================================================================

/**
 * Backup all user profiles from KV to R2.
 * Creates a timestamped snapshot: omega-profiles/backup-{ISO}.json
 * Also maintains a latest pointer: omega-profiles/latest.json
 */
export async function backupProfilesToR2(
  kv: KVNamespace,
  r2: R2Bucket,
): Promise<{ profileCount: number; backupKey: string }> {
  const profiles: UserProfile[] = [];
  let cursor: string | undefined;

  // List all KV keys with user: prefix
  do {
    const list = await kv.list({ prefix: 'user:', cursor });
    for (const key of list.keys) {
      const profile = await kv.get(key.name, 'json') as UserProfile | null;
      if (profile) {
        profiles.push(profile);
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupKey = `omega-profiles/backup-${timestamp}.json`;
  const backupData = JSON.stringify({
    version: CURRENT_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    profileCount: profiles.length,
    profiles,
  }, null, 2);

  // Write timestamped backup
  await r2.put(backupKey, backupData, {
    customMetadata: {
      type: 'omega-profile-backup',
      profileCount: String(profiles.length),
      schemaVersion: String(CURRENT_SCHEMA_VERSION),
    },
  });

  // Update latest pointer
  await r2.put('omega-profiles/latest.json', backupData, {
    customMetadata: {
      type: 'omega-profile-backup',
      profileCount: String(profiles.length),
      schemaVersion: String(CURRENT_SCHEMA_VERSION),
      sourceBackup: backupKey,
    },
  });

  return { profileCount: profiles.length, backupKey };
}

/**
 * Restore user profiles from R2 to KV.
 * Reads from a specific backup key or the latest snapshot.
 * Merges with existing data — newer profiles (by lastSeen) win.
 */
export async function restoreProfilesFromR2(
  kv: KVNamespace,
  r2: R2Bucket,
  backupKey?: string,
): Promise<{ restored: number; skipped: number; merged: number }> {
  const key = backupKey || 'omega-profiles/latest.json';
  const object = await r2.get(key);

  if (!object) {
    throw new Error(`Backup not found: ${key}`);
  }

  const backup = await object.json() as {
    version: number;
    profiles: Record<string, unknown>[];
  };

  let restored = 0;
  let skipped = 0;
  let merged = 0;

  for (const rawProfile of backup.profiles) {
    const profile = migrateProfile(rawProfile);
    const kvKey = `user:${profile.userId}`;

    // Check if existing profile is newer
    const existing = await kv.get(kvKey, 'json') as UserProfile | null;
    if (existing) {
      const existingDate = new Date(existing.lastSeen).getTime();
      const restoreDate = new Date(profile.lastSeen).getTime();

      if (existingDate > restoreDate) {
        // Existing is newer — keep it but merge any missing fields
        skipped++;
        continue;
      }

      // Backup is newer or same — merge: keep higher interaction counts
      if (existing.interactionCount > profile.interactionCount) {
        profile.interactionCount = existing.interactionCount;
        profile.understandingConfidence = existing.understandingConfidence;
      }
      // Merge observations (deduplicate)
      const allObs = new Set([...existing.observations, ...profile.observations]);
      profile.observations = [...allObs];
      // Merge goals (deduplicate)
      const allGoals = new Set([...existing.goals, ...profile.goals]);
      profile.goals = [...allGoals];
      merged++;
    } else {
      restored++;
    }

    await kv.put(kvKey, JSON.stringify(profile));
  }

  return { restored, skipped, merged };
}

/**
 * List available R2 backups.
 */
export async function listBackups(
  r2: R2Bucket,
): Promise<Array<{ key: string; uploaded: Date; profileCount: string }>> {
  const list = await r2.list({ prefix: 'omega-profiles/backup-' });
  return list.objects.map((obj) => ({
    key: obj.key,
    uploaded: obj.uploaded,
    profileCount: obj.customMetadata?.profileCount || 'unknown',
  }));
}
