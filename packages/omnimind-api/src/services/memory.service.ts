import type { PrismaClient, Prisma } from '@prisma/client';
import { runValidationPipeline } from '../memory/validation/pipeline';
import { SOURCE_WEIGHTS } from '@boardroom/shared';
import { embedMemory, generateEmbeddingWithRetry } from './embedding.service';
import { logger } from '../lib/logger';
import { decrypt } from '../lib/crypto';
import { HttpError } from '../middleware/error-handler';
import type { AgentContext } from '../middleware/agent-context';

export type { AgentContext };

const MINISTRY_DEFERRED_MSG =
  'Ministry-domain memories are deferred. Single-user testing mode. ' +
  'Re-enable via Phase 6 (Ollama + encryption rollout) when ready.';

const DEDUP_THRESHOLD = 0.92;

/**
 * Backward-compat shim: legacy callers pass (userId, input, prisma).
 * New callers pass (userId, input, agentContext, prisma).
 *
 * Detect Prisma vs. AgentContext by structural shape:
 *   - Real PrismaClient instances expose a `memoryEntry` model client
 *     AND many `$`-prefixed methods.
 *   - Mocked Prisma in tests typically has `memoryEntry`.
 *   - AgentContext has primitive fields (agentId, tenantId, sourceWeight).
 */
function isPrismaLike(x: unknown): x is PrismaClient {
  if (!x || typeof x !== 'object') return false;
  const obj = x as Record<string, unknown>;
  // Real client: $connect. Mocked client: memoryEntry model object.
  return (
    typeof obj.$connect === 'function' ||
    (typeof obj.memoryEntry === 'object' && obj.memoryEntry !== null)
  );
}

function resolveContextAndPrisma(
  a: AgentContext | PrismaClient | undefined,
  b: PrismaClient | undefined
): { agentContext: AgentContext | undefined; prisma: PrismaClient } {
  if (isPrismaLike(a)) {
    return { agentContext: undefined, prisma: a as PrismaClient };
  }
  if (b) {
    return { agentContext: a as AgentContext | undefined, prisma: b };
  }
  // Neither shape matched — caller is broken. Surface a clear error so the
  // route handler sees it instead of a cryptic Prisma null deref later.
  throw new Error(
    'memory.service: prisma client is required as 3rd or 4th argument'
  );
}

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
  agentContextOrPrisma?: AgentContext | PrismaClient,
  prismaArg?: PrismaClient
) {
  // Backward-compat: this function used to take (userId, input, prisma).
  // New signature: (userId, input, agentContext?, prisma).
  // Detect which arg is which based on shape.
  const { agentContext, prisma } = resolveContextAndPrisma(agentContextOrPrisma, prismaArg);

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
      // CRITICAL: pass the agent context through the dedup update path so we don't strip
      // tenantId / agentId / sourceWeight on the merge (fix for Bug #3).
      logger.info('Near-duplicate detected — auto-superseding existing memory', { dupeId: dupe.id });
      await updateMemory(userId, dupe.id, {
        title: input.title,
        content: input.content,
        importance: Math.max(dupe.importance, input.importance ?? 0.5),
        tags: Array.from(new Set([...dupe.tags, ...(input.tags ?? [])])),
      }, agentContext, prisma);
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

  // Source weight resolution: agent context (from header / Agent table) wins,
  // else fall back to the static sourceType lookup table.
  const fallbackSourceWeight =
    (SOURCE_WEIGHTS as Record<string, number>)[input.sourceType] ?? SOURCE_WEIGHTS.MANUAL;
  const sourceWeight = agentContext?.sourceWeight ?? fallbackSourceWeight;

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
      // Agent context — present for MCP writes, absent for BoardRoom AI writes
      // (which will keep the schema default of tenantId='josh-personal' and agentId=NULL).
      ...(agentContext
        ? {
            agentId: agentContext.agentId,
            tenantId: agentContext.tenantId,
          }
        : {}),
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

// Get single memory by ID, scoped to userId AND tenantId (when context is present)
export async function getMemory(
  userId: string,
  id: string,
  agentContextOrPrisma?: AgentContext | PrismaClient,
  prismaArg?: PrismaClient
) {
  const { agentContext, prisma } = resolveContextAndPrisma(agentContextOrPrisma, prismaArg);

  const where: Prisma.MemoryEntryWhereInput = { id, userId, deletedAt: null };
  if (agentContext?.tenantId) {
    where.tenantId = agentContext.tenantId;
  }

  const memory = await prisma.memoryEntry.findFirst({ where });
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
    /**
     * Admin-only escape hatch: when true, do NOT enforce the tenant filter
     * derived from agentContext. Filtering by `filters.tenantId` still applies.
     */
    includeAllTenants?: boolean;
  },
  agentContextOrPrisma?: AgentContext | PrismaClient,
  prismaArg?: PrismaClient
) {
  const { agentContext, prisma } = resolveContextAndPrisma(agentContextOrPrisma, prismaArg);

  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  const where: Prisma.MemoryEntryWhereInput = {
    userId,
    deletedAt: null,
  };

  // Tenant resolution precedence:
  //   1. Explicit `filters.tenantId` (admin / cross-tenant routes)
  //   2. `agentContext.tenantId` (MCP requests carrying x-tenant-id)
  //   3. unscoped (legacy BoardRoom AI behavior) — only allowed if includeAllTenants is true
  //
  // Default: if neither a filter nor a context tenant is present, leave unfiltered.
  // The MCP route layer will pass `req.agentContext`, so MCP traffic is always scoped.
  if (filters.tenantId) {
    where.tenantId = filters.tenantId;
  } else if (agentContext?.tenantId && !filters.includeAllTenants) {
    where.tenantId = agentContext.tenantId;
  }

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
  agentContextOrPrisma?: AgentContext | PrismaClient,
  prismaArg?: PrismaClient
) {
  const { agentContext, prisma } = resolveContextAndPrisma(agentContextOrPrisma, prismaArg);

  // Verify ownership AND tenant match (when context is present).
  // This prevents cross-tenant updates: agent in tenant A cannot mutate a memory in tenant B.
  const ownershipWhere: Prisma.MemoryEntryWhereInput = { id, userId, deletedAt: null };
  if (agentContext?.tenantId) {
    ownershipWhere.tenantId = agentContext.tenantId;
  }

  const existing = await prisma.memoryEntry.findFirst({ where: ownershipWhere });
  if (!existing) return null;

  // Ministry domain is deferred — refuse updates too
  if (existing.domain === 'ministry') {
    throw new HttpError(503, { code: 'MINISTRY_DEFERRED', message: MINISTRY_DEFERRED_MSG });
  }

  // Propagate agent context onto the update — this is the path that the dedup
  // branch in createMemory takes when superseding an existing row. Without
  // this, the dedup branch silently dropped tenantId/agentId/sourceWeight
  // (Bug #3 from Hermes findings).
  // Agent-supplied input values for these fields are overridden — context wins.
  const contextOverrides = agentContext
    ? {
        agentId: agentContext.agentId,
        tenantId: agentContext.tenantId,
        sourceWeight: agentContext.sourceWeight,
      }
    : {};

  const updateData: Record<string, unknown> = {
    ...input,
    ...contextOverrides,
    version: { increment: 1 },
  };

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
export async function archiveMemory(
  userId: string,
  id: string,
  agentContextOrPrisma?: AgentContext | PrismaClient,
  prismaArg?: PrismaClient
) {
  const { agentContext, prisma } = resolveContextAndPrisma(agentContextOrPrisma, prismaArg);

  const where: Prisma.MemoryEntryWhereInput = { id, userId, deletedAt: null };
  if (agentContext?.tenantId) {
    where.tenantId = agentContext.tenantId;
  }

  const existing = await prisma.memoryEntry.findFirst({ where });
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
