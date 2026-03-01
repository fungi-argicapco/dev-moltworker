/**
 * Cognitive Memory — Vectorize integration for Cognitive Self-Portrait
 *
 * Provides semantic memory using Cloudflare Vectorize with per-client
 * namespace isolation. Embeds via Workers AI bge-base-en-v1.5 (free tier).
 *
 * Three core operations:
 *   1. ingestMemory()  — embed and store a conversation turn
 *   2. recallMemories() — semantic search for relevant past interactions
 *   3. forgetAll()      — wipe a client's cognitive namespace
 */

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIMENSIONS = 768;

/** Metadata stored alongside each vector */
export interface CognitiveMetadata {
  type: 'conversation' | 'trait' | 'goal' | 'preference' | 'interview';
  content: string;
  timestamp: string;
  source: 'telegram' | 'learn' | 'passive';
  topic?: string;
  role?: 'user' | 'assistant';
}

/** A recalled memory with similarity score */
export interface RecalledMemory {
  id: string;
  score: number;
  content: string;
  type: string;
  timestamp: string;
  topic?: string;
}

/**
 * Get the namespace key for a client's cognitive memory.
 */
export function clientNamespace(userId: number): string {
  return `client:${userId}`;
}

/**
 * Generate embeddings using Workers AI (free tier).
 */
async function embed(ai: Ai, texts: string[]): Promise<number[][]> {
  const result = await ai.run(EMBEDDING_MODEL as Parameters<typeof ai.run>[0], {
    text: texts,
  });
  // Workers AI embedding models return { shape: [n, dims], data: number[][] }
  const embedResult = result as { data: number[][] };
  return embedResult.data;
}

/**
 * Ingest a conversation turn into cognitive memory.
 *
 * Called via waitUntil (non-blocking) after every Omega response.
 * Embeds both user message and assistant response as separate vectors.
 */
export async function ingestMemory(opts: {
  ai: Ai;
  vectorize: VectorizeIndex;
  userId: number;
  userMessage: string;
  assistantResponse: string;
  topic?: string;
}): Promise<void> {
  const { ai, vectorize, userId, userMessage, assistantResponse, topic } = opts;
  const ns = clientNamespace(userId);
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();

  // Combine user+assistant for a richer embedding, but also store separately
  const combinedText = `User: ${userMessage}\nAssistant: ${assistantResponse}`;
  const texts = [combinedText, userMessage];

  try {
    const embeddings = await embed(ai, texts);

    const vectors: VectorizeVector[] = [
      {
        id: `${batchId}-conv`,
        values: embeddings[0],
        namespace: ns,
        metadata: {
          type: 'conversation',
          content: combinedText.slice(0, 1000), // Cap metadata size
          timestamp: now,
          source: 'telegram',
          topic: topic || '',
          role: 'assistant',
        } satisfies Record<string, string>,
      },
      {
        id: `${batchId}-user`,
        values: embeddings[1],
        namespace: ns,
        metadata: {
          type: 'conversation',
          content: userMessage.slice(0, 500),
          timestamp: now,
          source: 'telegram',
          topic: topic || '',
          role: 'user',
        } satisfies Record<string, string>,
      },
    ];

    await vectorize.upsert(vectors);
  } catch (err) {
    console.error('[CognitiveMemory] Ingest error:', err);
  }
}

/**
 * Ingest a cognitive trait or interview answer.
 */
export async function ingestTrait(opts: {
  ai: Ai;
  vectorize: VectorizeIndex;
  userId: number;
  content: string;
  type: 'trait' | 'goal' | 'preference' | 'interview';
  topic?: string;
}): Promise<void> {
  const { ai, vectorize, userId, content, type, topic } = opts;
  const ns = clientNamespace(userId);

  try {
    const embeddings = await embed(ai, [content]);
    const vectors: VectorizeVector[] = [
      {
        id: crypto.randomUUID(),
        values: embeddings[0],
        namespace: ns,
        metadata: {
          type,
          content: content.slice(0, 1000),
          timestamp: new Date().toISOString(),
          source: 'learn',
          topic: topic || '',
        } satisfies Record<string, string>,
      },
    ];
    await vectorize.upsert(vectors);
  } catch (err) {
    console.error('[CognitiveMemory] Trait ingest error:', err);
  }
}

/**
 * Recall relevant memories for a given query.
 *
 * Called before Omega responds to inject relevant context.
 * Returns top-K most similar past interactions.
 */
export async function recallMemories(opts: {
  ai: Ai;
  vectorize: VectorizeIndex;
  userId: number;
  query: string;
  topK?: number;
}): Promise<RecalledMemory[]> {
  const { ai, vectorize, userId, query, topK = 5 } = opts;
  const ns = clientNamespace(userId);

  try {
    const embeddings = await embed(ai, [query]);
    const matches = await vectorize.query(embeddings[0], {
      topK,
      namespace: ns,
      returnMetadata: 'all',
    });

    return matches.matches
      .filter((m) => m.score > 0.5) // Only return meaningfully similar results
      .map((m) => ({
        id: m.id,
        score: m.score,
        content: (m.metadata?.content as string) || '',
        type: (m.metadata?.type as string) || 'conversation',
        timestamp: (m.metadata?.timestamp as string) || '',
        topic: (m.metadata?.topic as string) || undefined,
      }));
  } catch (err) {
    console.error('[CognitiveMemory] Recall error:', err);
    return [];
  }
}

/**
 * Wipe all cognitive memory for a client.
 * Used by /forget command for privacy.
 */
export async function forgetAll(opts: {
  vectorize: VectorizeIndex;
  userId: number;
}): Promise<{ deleted: number }> {
  const { vectorize, userId } = opts;
  const ns = clientNamespace(userId);

  try {
    // Query all vectors in this namespace to get their IDs
    // We need a dummy vector to query — use zeros
    const dummyVector = new Array(EMBEDDING_DIMENSIONS).fill(0);
    const matches = await vectorize.query(dummyVector, {
      topK: 1000,
      namespace: ns,
    });

    if (matches.matches.length === 0) {
      return { deleted: 0 };
    }

    const ids = matches.matches.map((m) => m.id);
    await vectorize.deleteByIds(ids);
    return { deleted: ids.length };
  } catch (err) {
    console.error('[CognitiveMemory] Forget error:', err);
    return { deleted: 0 };
  }
}

/**
 * Format recalled memories for injection into Omega's system prompt.
 */
export function formatMemoriesForPrompt(memories: RecalledMemory[]): string {
  if (memories.length === 0) return '';

  const lines: string[] = [
    '## Relevant Memories',
    'These are relevant past interactions with this user (most relevant first):',
    '',
  ];

  for (const m of memories) {
    const date = new Date(m.timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/Los_Angeles',
    });
    const topicTag = m.topic ? ` [${m.topic}]` : '';
    lines.push(`- **${date}${topicTag}** (${Math.round(m.score * 100)}% match): ${m.content.slice(0, 200)}`);
  }

  return lines.join('\n');
}
