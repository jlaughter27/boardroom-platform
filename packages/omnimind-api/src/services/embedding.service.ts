import OpenAI from 'openai';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

const OPENAI_MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const OLLAMA_MODEL = 'bge-base-en-v1.5';
const OLLAMA_DIMENSIONS = 768;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Read OPENAI_API_KEY lazily at call time. Reading it at module load means
// tests (and hot-reloaded envs) can't override it, and the service is
// impossible to run without the key set even though the missing-key path is
// handled gracefully.
//
// F-213: memoize the OpenAI client keyed on the current apiKey value. The
// previous implementation built a new OpenAI({apiKey}) on every call — with
// the outbox retry cron firing every 2 minutes and processing batches of 50
// that meant 50 needless constructor calls per tick. We re-init only when the
// env var changes (e.g. a hot-rotation after key revoke).
let cachedClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY ?? null;
  if (!apiKey) {
    cachedClient = null;
    cachedApiKey = null;
    return null;
  }
  if (cachedClient && cachedApiKey === apiKey) return cachedClient;
  cachedClient = new OpenAI({ apiKey });
  cachedApiKey = apiKey;
  return cachedClient;
}

// Pad a vector to 1536 dims with zeros (ministry embeddings are 768-dim)
function padTo1536(vector: number[]): number[] {
  if (vector.length === DIMENSIONS) return vector;
  const padded = new Array(DIMENSIONS).fill(0);
  for (let i = 0; i < Math.min(vector.length, DIMENSIONS); i++) {
    padded[i] = vector[i];
  }
  return padded;
}

async function ollamaEmbed(text: string): Promise<number[]> {
  const ollamaUrl = process.env.OLLAMA_API_URL ?? 'http://localhost:11434';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text.slice(0, 8000) }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama embedding failed: ${res.status}`);
    const data = await res.json() as { embedding: number[] };
    if (!data.embedding) throw new Error('Ollama returned no embedding');
    return data.embedding;
  } finally {
    clearTimeout(timer);
  }
}

// Ministry domain MUST use Ollama — never send to OpenAI
// All other domains use OpenAI text-embedding-3-small
//
// WS-6 F-101 — normalize domain so case/whitespace variants don't bypass the
// Ollama-only routing (which would otherwise send ministry text to OpenAI).
export async function generateEmbeddingWithRetry(
  text: string,
  domain?: string
): Promise<number[] | null> {
  const normalizedDomain = domain?.trim().toLowerCase();
  if (normalizedDomain === 'ministry') {
    try {
      const vec = await ollamaEmbed(text);
      return padTo1536(vec);
    } catch (err) {
      logger.error('Ministry embedding failed — Ollama unavailable. Write refused.', {
        error: (err as Error).message,
      });
      // Rule 9: never fall back to OpenAI for ministry content
      return null;
    }
  }

  const client = getOpenAIClient();
  if (!client) {
    logger.warn('Embedding generation skipped: missing OPENAI_API_KEY');
    return null;
  }

  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    try {
      const response = await client.embeddings.create({
        model: OPENAI_MODEL,
        input: text.slice(0, 8000), // limit input to ~2000 tokens
        dimensions: DIMENSIONS,
      });
      if (!response?.data?.[0]?.embedding) throw new Error('Missing embedding in response');
      return response.data[0].embedding;
    } catch (err) {
      const errorMessage = (err as Error).message;
      const isLast = attempt >= MAX_ATTEMPTS;
      logger.warn('Embedding generation failed', { attempt, error: errorMessage, isLast });
      if (isLast) {
        return null;
      }
      const backoffMs = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      await sleep(backoffMs);
    }
  }

  return null;
}

export { padTo1536, ollamaEmbed };

export async function embedMemory(memoryId: string): Promise<void> {
  const memory = await prisma.memoryEntry.findUnique({
    where: { id: memoryId },
    select: { id: true, title: true, content: true, domain: true },
  });
  if (!memory) return;

  const text = `${memory.title}\n\n${memory.content}`;
  const embedding = await generateEmbeddingWithRetry(text, memory.domain);
  if (!embedding) {
    logger.error('Embedding generation permanently failed', { memoryId });
    return;
  }

  // Store via raw query (Prisma doesn't support vector type natively)
  await prisma.$executeRaw`
    UPDATE "memory_entries"
    SET "embedding" = ${embedding}::vector
    WHERE "id" = ${memoryId}
  `;

  logger.info('Embedding generated', { memoryId });
}

export async function backfillEmbeddings(
  userId: string,
  batchSize: number = 50
): Promise<{ processed: number; total: number; remaining: number }> {
  const total = await prisma.memoryEntry.count({
    where: { userId, deletedAt: null, status: { not: 'ARCHIVED' } },
  });

  // Find memories without embeddings
  const memories = await prisma.$queryRaw<{ id: string; title: string; content: string }[]>`
    SELECT id, title, content FROM "memory_entries"
    WHERE "user_id" = ${userId}
      AND "deleted_at" IS NULL
      AND status != 'ARCHIVED'
      AND embedding IS NULL
    LIMIT ${batchSize}
  `;

  let processed = 0;
  for (const mem of memories) {
    const text = `${mem.title}\n\n${mem.content}`;
    const embedding = await generateEmbeddingWithRetry(text);
    if (!embedding) {
      logger.warn('Backfill embedding failed after retries', { memoryId: mem.id });
      continue;
    }

    await prisma.$executeRaw`
      UPDATE "memory_entries" SET "embedding" = ${embedding}::vector WHERE "id" = ${mem.id}
    `;
    processed++;
  }

  const remaining = total - processed; // approximate
  return { processed, total, remaining: Math.max(0, remaining) };
}

export async function getEmbeddingStatus(memoryId: string): Promise<'ready' | 'pending' | 'missing'> {
  const rows = await prisma.$queryRaw<Array<{ has_embedding: boolean | null }>>`
    SELECT embedding IS NOT NULL as has_embedding
    FROM "memory_entries"
    WHERE id = ${memoryId}
    LIMIT 1
  `;

  if (!rows || rows.length === 0) return 'missing';
  return rows[0].has_embedding ? 'ready' : 'pending';
}
