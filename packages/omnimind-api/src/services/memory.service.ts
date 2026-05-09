import type { PrismaClient, Prisma } from '@prisma/client';
import { runValidationPipeline } from '../memory/validation/pipeline';
import { SOURCE_WEIGHTS } from '@boardroom/shared';
import { embedMemory, generateEmbeddingWithRetry } from './embedding.service';
import { logger } from '../lib/logger';
import { decrypt } from '../lib/crypto';
import { HttpError } from '../middleware/error-handler';

const MINISTRY_DEFERRED_MSG =
  'Ministry-domain memories are deferred. Single-user testing mode. ' +
  'Re-enable via Phase 6 (Ollama + encryption rollout) when ready.';

const DEDUP_THRESHOLD = 0.92;

async function findNearDuplicate(
  userId: string,
  embedding: number[],
  threshold: number,
  prisma: PrismaClient
): Promise<{ id: string; importance: number; tags: string[] } | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; importance: number; tags: string[] }>>`
      SELECT id, importance, tags
      FROM "memory_entries"
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
        AND deleted_at IS NULL
        AND status != 'ARCHIVED'
        AND 1 - (embedding <=> ${embedding}::vector) >= ${threshold}
      ORDER BY embedding <=> ${embedding}::vector
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// Create memory — validate first, then write
export async function createMemory(
  userId: string,
  input: {
    title: string;
    content: string;
    domain: string;
    sourceType: string;
    sector?: string;
    tags?: string[];
    memoryClass?: string;
    importance?: number;
    confidence?: string;
    sourceRef?: string | null;
    metadata?: Record<string, unknown>;
  },
  prisma: PrismaClient
) {
  // Ministry domain is explicitly deferred (Phase 6+). Refuse at the boundary.
  if (input.domain === 'ministry') {
    throw new HttpError(503, { code: 'MINISTRY_DEFERRED', message: MINISTRY_DEFERRED_MSG });
  }

  // Cosine dedup: if a near-identical memory exists (>0.92 similarity), update it instead of creating
  const embedText = `${input.title} ${input.content}`.slice(0, 8000);
  const dedupeEmbedding = await generateEmbeddingWithRetry(embedText, input.domain).catch(() => null);
  if (dedupeEmbedding) {
    const dupe = await findNearDuplicate(userId, dedupeEmbedding, DEDUP_THRESHOLD, prisma);
    if (dupe) {
      logger.info({ dupeId: dupe.id }, 'Near-duplicate detected — auto-superseding existing memory');
      await updateMemory(userId, dupe.id, {
        title: input.title,
        content: input.content,
        importance: Math.max(dupe.importance, input.importance ?? 0.5),
        tags: Array.from(new Set([...dupe.tags, ...(input.tags ?? [])])),
      }, prisma);
      return {
        success: true as const,
        data: { id: dupe.id, status: 'updated' as const, validation: { syncPassed: true, errors: [] } },
      };
    }
  }

  // Run validation pipeline
  const validation = await runValidationPipeline(input, userId, input.domain, prisma);
  if (!validation.valid) {
    return { success: false as const, errors: validation.errors };
  }

  // Auto-set source weight based on sourceType (fallback to MANUAL weight)
  const sourceWeight = (SOURCE_WEIGHTS as Record<string, number>)[input.sourceType] ?? SOURCE_WEIGHTS.MANUAL;

  const memory = await prisma.memoryEntry.create({
    data: {
      userId,
      title: input.title,
      content: input.content,
      domain: input.domain,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sourceType: input.sourceType as any,
      sector: input.sector ?? '',
      tags: input.tags ?? [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      memoryClass: (input.memoryClass ?? 'SEMANTIC') as any,
      importance: input.importance ?? 0.5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confidence: (input.confidence ?? 'MEDIUM') as any,
      sourceRef: input.sourceRef ?? null,
      sourceWeight,
      status: 'DRAFT' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: (input.metadata ?? {}) as any,
    },
  });

  // Trigger embedding immediately (tests expect call count synchronously)
  try {
    await embedMemory(memory.id);
  } catch (err) {
    logger.error('Embedding failed', { memoryId: memory.id, error: (err as Error).message });
  }

  return {
    success: true as const,
    data: {
      id: memory.id,
      status: 'created' as const,
      validation: { syncPassed: true, errors: [] },
    },
  };
}

// Decrypt ministry content in-place (mutates a copy)
function decryptMemory<T extends { domain: string; content: string; encryptedContent: Buffer | Uint8Array | null }>(
  mem: T
): T & { content: string } {
  if (mem.domain === 'ministry' && mem.encryptedContent) {
    const encoded = Buffer.from(mem.encryptedContent).toString('utf-8');
    return { ...mem, content: decrypt(encoded) };
  }
  return mem;
}

// Get single memory by ID, scoped to userId
export async function getMemory(userId: string, id: string, prisma: PrismaClient) {
  const memory = await prisma.memoryEntry.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!memory) return null;
  return decryptMemory(memory as typeof memory & { encryptedContent: Buffer | null });
}

// Search/filter memories
export async function searchMemories(
  userId: string,
  filters: {
    q?: string;
    domain?: string;
    tags?: string[];
    tenantId?: string;
    memoryClass?: string;
    status?: string;
    since?: string;
    sortBy?: string;
    sortOrder?: string;
    limit?: number;
    offset?: number;
  },
  prisma: PrismaClient
) {
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const where: Prisma.MemoryEntryWhereInput = {
    userId,
    deletedAt: null,
  };

  if (filters.tenantId) where.tenantId = filters.tenantId;
  if (filters.domain) where.domain = filters.domain;
  if (filters.memoryClass) where.memoryClass = filters.memoryClass as any;
  if (filters.status) {
    where.status = filters.status as any;
  } else {
    where.status = { not: 'ARCHIVED' };
  }
  if (filters.since) where.createdAt = { gte: new Date(filters.since) };
  if (filters.tags && filters.tags.length > 0) {
    where.tags = { hasEvery: filters.tags };
  }
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: 'insensitive' } },
      { content: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  const sortBy = filters.sortBy ?? 'createdAt';
  const sortOrder = filters.sortOrder ?? 'desc';
  const orderBy: Prisma.MemoryEntryOrderByWithRelationInput = {
    [sortBy]: sortOrder,
  };

  const [rawItems, total] = await Promise.all([
    prisma.memoryEntry.findMany({ where, orderBy, take: limit, skip: offset }),
    prisma.memoryEntry.count({ where }),
  ]);

  const items = rawItems.map(m =>
    decryptMemory(m as typeof m & { encryptedContent: Buffer | null })
  );

  return { items, total, offset, limit };
}

// Update memory (partial)
export async function updateMemory(
  userId: string,
  id: string,
  input: Record<string, unknown>,
  prisma: PrismaClient
) {
  // Verify ownership
  const existing = await prisma.memoryEntry.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!existing) return null;

  // Ministry domain is deferred — refuse updates too
  if (existing.domain === 'ministry') {
    throw new HttpError(503, { code: 'MINISTRY_DEFERRED', message: MINISTRY_DEFERRED_MSG });
  }

  const updateData: Record<string, unknown> = { ...input, version: { increment: 1 } };

  const memory = await prisma.memoryEntry.update({
    where: { id },
    data: updateData as Parameters<typeof prisma.memoryEntry.update>[0]['data'],
  });

  // Re-embed if content or title changed (sync for test determinism)
  if ('content' in input || 'title' in input) {
    try {
      await embedMemory(memory.id);
    } catch (err) {
      logger.error('Embedding failed', { memoryId: memory.id, error: (err as Error).message });
    }
  }

  return decryptMemory(memory as typeof memory & { encryptedContent: Buffer | null });
}

// Archive (soft delete)
export async function archiveMemory(userId: string, id: string, prisma: PrismaClient) {
  const existing = await prisma.memoryEntry.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!existing) return null;

  await prisma.memoryEntry.update({
    where: { id },
    data: {
      status: 'ARCHIVED',
      deletedAt: new Date(),
    },
  });

  return { id, status: 'archived' as const };
}

// Dry-run validation (no write)
export async function validateMemoryInput(
  userId: string,
  input: unknown,
  domain: string,
  prisma: PrismaClient
) {
  return runValidationPipeline(input, userId, domain, prisma);
}
