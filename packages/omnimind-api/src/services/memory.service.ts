import type { PrismaClient, Prisma } from '@prisma/client';
import { runValidationPipeline } from '../memory/validation/pipeline';
import { SOURCE_WEIGHTS } from '@boardroom/shared';
import { embedMemory } from './embedding.service';
import { logger } from '../lib/logger';

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
  // Run validation pipeline
  const validation = await runValidationPipeline(input, userId, input.domain, prisma);
  if (!validation.valid) {
    return { success: false as const, errors: validation.errors };
  }

  // Auto-set source weight based on sourceType
  const sourceWeight = SOURCE_WEIGHTS[input.sourceType] ?? SOURCE_WEIGHTS.MANUAL;

  const memory = await prisma.memoryEntry.create({
    data: {
      userId,
      title: input.title,
      content: input.content,
      domain: input.domain,
      sourceType: input.sourceType as any, // Prisma enum
      sector: input.sector ?? '',
      tags: input.tags ?? [],
      memoryClass: (input.memoryClass ?? 'SEMANTIC') as any,
      importance: input.importance ?? 0.5,
      confidence: (input.confidence ?? 'MEDIUM') as any,
      sourceRef: input.sourceRef ?? null,
      sourceWeight,
      status: 'DRAFT', // All new memories start as DRAFT
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });

  // Fire-and-forget embedding generation
  setImmediate(() => {
    embedMemory(memory.id).catch(err =>
      logger.error('Async embedding failed', { memoryId: memory.id, error: (err as Error).message })
    );
  });

  return {
    success: true as const,
    data: {
      id: memory.id,
      status: 'created' as const,
      validation: { syncPassed: true, errors: [] },
    },
  };
}

// Get single memory by ID, scoped to userId
export async function getMemory(userId: string, id: string, prisma: PrismaClient) {
  const memory = await prisma.memoryEntry.findFirst({
    where: { id, userId, deletedAt: null },
  });
  return memory;
}

// Search/filter memories
export async function searchMemories(
  userId: string,
  filters: {
    q?: string;
    domain?: string;
    tags?: string[];
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

  const [items, total] = await Promise.all([
    prisma.memoryEntry.findMany({ where, orderBy, take: limit, skip: offset }),
    prisma.memoryEntry.count({ where }),
  ]);

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

  // Increment version for optimistic concurrency
  const memory = await prisma.memoryEntry.update({
    where: { id },
    data: {
      ...input,
      version: { increment: 1 },
    },
  });

  // Re-embed if content or title changed
  if ('content' in input || 'title' in input) {
    setImmediate(() => {
      embedMemory(memory.id).catch(err =>
        logger.error('Async embedding failed', { memoryId: memory.id, error: (err as Error).message })
      );
    });
  }

  return memory;
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
