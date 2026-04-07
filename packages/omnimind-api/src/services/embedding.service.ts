import OpenAI from 'openai';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;

function getClient(): OpenAI | null {
  if (!OPENAI_API_KEY) return null;
  return new OpenAI({ apiKey: OPENAI_API_KEY });
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.embeddings.create({
      model: MODEL,
      input: text.slice(0, 8000), // limit input to ~2000 tokens
      dimensions: DIMENSIONS,
    });
    return response.data[0].embedding;
  } catch (err) {
    logger.error('Embedding generation failed', { error: (err as Error).message });
    return null;
  }
}

export async function embedMemory(memoryId: string): Promise<void> {
  const memory = await prisma.memoryEntry.findUnique({
    where: { id: memoryId },
    select: { id: true, title: true, content: true },
  });
  if (!memory) return;

  const text = `${memory.title}\n\n${memory.content}`;
  const embedding = await generateEmbedding(text);
  if (!embedding) return;

  // Store via raw query (Prisma doesn't support vector type natively)
  await prisma.$executeRaw`
    UPDATE "memory_entries"
    SET "embedding" = ${embedding}::vector
    WHERE "id" = ${memoryId}
  `;

  logger.info('Embedding generated', { memoryId });
}

export async function backfillEmbeddings(userId: string, batchSize: number = 50): Promise<{ processed: number; total: number; remaining: number }> {
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
    const embedding = await generateEmbedding(text);
    if (embedding) {
      await prisma.$executeRaw`
        UPDATE "memory_entries" SET "embedding" = ${embedding}::vector WHERE "id" = ${mem.id}
      `;
      processed++;
    }
  }

  const remaining = total - processed; // approximate
  return { processed, total, remaining: Math.max(0, remaining) };
}
