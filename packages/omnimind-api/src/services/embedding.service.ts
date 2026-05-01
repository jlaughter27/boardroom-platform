import OpenAI from 'openai';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Read OPENAI_API_KEY lazily at call time. Reading it at module load means
// tests (and hot-reloaded envs) can't override it, and the service is
// impossible to run without the key set even though the missing-key path is
// handled gracefully.
function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export async function generateEmbeddingWithRetry(text: string): Promise<number[] | null> {
  const client = getClient();
  if (!client) {
    logger.warn('Embedding generation skipped: missing OPENAI_API_KEY');
    return null;
  }

  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    try {
      const response = await client.embeddings.create({
        model: MODEL,
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

export async function embedMemory(memoryId: string): Promise<void> {
  const memory = await prisma.memoryEntry.findUnique({
    where: { id: memoryId },
    select: { id: true, title: true, content: true },
  });
  if (!memory) return;

  const text = `${memory.title}\n\n${memory.content}`;
  const embedding = await generateEmbeddingWithRetry(text);
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
