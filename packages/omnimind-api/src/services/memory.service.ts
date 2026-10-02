import type { PrismaClient, Prisma } from '@prisma/client';
import { runValidationPipeline } from '../memory/validation/pipeline';
import { SOURCE_WEIGHTS, SourceType } from '@boardroom/shared';
import { embedMemory, generateEmbeddingWithRetry, getEmbeddingStatus } from './embedding.service';
import { logger } from '../lib/logger';
import { decryptMemory, encryptMemoryContent, normalizeDomain } from '../lib/memory-crypto';
import { HttpError } from '../middleware/error-handler';
import type { AgentContext } from '../middleware/agent-context';
import { prisma as defaultPrisma } from '../lib/db';
import { tryDecryptMemory } from '../lib/memory-crypto';
import { structuredFilter } from '../retrieval/structured-filter';
import { fulltextSearch } from '../retrieval/fulltext-search';
import { trigramSearch } from '../retrieval/trigram-search';
import { semanticSearch } from '../retrieval/semantic-search';
import { rankAndDeduplicate } from '../retrieval/ranker';

export type { AgentContext };
// O-111: single decrypt entry point shared with the retrieval layers.
export { decryptMemory };


// WS-4.2 — Strict sourceType validation set. Previously the SOURCE_WEIGHTS
// lookup silently fell back to MANUAL on invalid input, hiding data-quality
// issues (e.g. an agent sending `sourceType: 'mcp'` lowercase would get
// silently coerced to MANUAL weight). We now reject unknown values at the
// boundary so callers learn about typos immediately.
const VALID_SOURCE_TYPES = new Set(Object.values(SourceType));

const MINISTRY_DEFERRED_MSG =
  'Ministry-domain memories are deferred. Single-user testing mode. ' +
  'Re-enable via Phase 6 (Ollama + encryption rollout) when ready.';

const DEDUP_THRESHOLD = 0.92;

// WS-6 F-101 — domain normalization (defense-in-depth for callers that bypass
// Zod) now lives in lib/memory-crypto.ts so the retrieval layers share it.


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

/**
 * O-101 / F-202 — cosine near-duplicate lookup, scoped to BOTH the user and
 * the caller's tenant. Without the tenant filter an agent in tenant A could
 * "merge into" (and re-stamp) a memory that lives in tenant B.
 */
async function findNearDuplicate(
  userId: string,
  tenantId: string,
  embedding: number[],
  threshold: number,
  prisma: PrismaClient
): Promise<{ id: string; importance: number; tags: string[] } | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; importance: number; tags: string[] }>>`
      SELECT id, importance, tags
      FROM "memory_entries"
      WHERE user_id = ${userId}
        AND tenant_id = ${tenantId}
        AND embedding IS NOT NULL
        AND deleted_at IS NULL
        AND status != 'ARCHIVED'
        AND 1 - (embedding <=> ${embedding}::vector) >= ${threshold}
      ORDER BY embedding <=> ${embedding}::vector
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (err) {
    // Dedup is a best-effort heuristic; a failure here must not block the
    // write, but it must not be silent either (F-204 spirit).
    logger.warn('findNearDuplicate failed — skipping dedup for this write', {
      error: (err as Error).message,
    });
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

  // WS-6 F-101 — Defense-in-depth domain normalization. The Zod schema at the
  // route boundary normalizes too, but services can be called from other code
  // paths (jobs, tests) without going through Zod. Mutate the local copy so
  // the refusal check below + the write below both see the canonical value.
  input = { ...input, domain: normalizeDomain(input.domain) };

  // Ministry domain is explicitly deferred (Phase 6+). Refuse at the boundary.
  if (input.domain === 'ministry') {
    throw new HttpError(503, { code: 'MINISTRY_DEFERRED', message: MINISTRY_DEFERRED_MSG });
  }

  // WS-4.2 — Strict sourceType validation. Reject unknown values at the boundary
  // rather than silently coercing to MANUAL (which hid data-quality issues).
  if (!VALID_SOURCE_TYPES.has(input.sourceType as SourceType)) {
    throw new HttpError(400, {
      code: 'INVALID_SOURCE_TYPE',
      message:
        `sourceType '${input.sourceType}' is not a valid SourceType. ` +
        `Expected one of: ${Array.from(VALID_SOURCE_TYPES).join(', ')}.`,
    });
  }

  // Run validation pipeline FIRST (O-115 / rule 6): every write path —
  // including the dedup-update branch below — goes through schema + temporal
  // + budget validation. Previously the dedup branch ran before and bypassed it.
  const validation = await runValidationPipeline(input, userId, input.domain, prisma);
  if (!validation.valid) {
    return { success: false as const, errors: validation.errors };
  }

  // Cosine dedup: if a near-identical memory exists (>0.92 similarity) IN THE
  // CALLER'S TENANT, update it instead of creating.
  //
  // O-101 / F-202: only runs when an agent context (and therefore a tenant) is
  // present. BoardRoom AI writes carry no tenant and are single-user, so dedup
  // is skipped rather than searched cross-tenant.
  if (agentContext) {
    const embedText = `${input.title} ${input.content}`.slice(0, 8000);
    const dedupeEmbedding = await generateEmbeddingWithRetry(embedText, input.domain).catch(() => null);
    if (dedupeEmbedding) {
      const dupe = await findNearDuplicate(userId, agentContext.tenantId, dedupeEmbedding, DEDUP_THRESHOLD, prisma);
      if (dupe) {
        // Pass the agent context through the dedup update path so we don't strip
        // tenantId / agentId / sourceWeight on the merge (fix for Bug #3).
        logger.info('Near-duplicate detected — auto-superseding existing memory', { dupeId: dupe.id });
        const updated = await updateMemory(userId, dupe.id, {
          title: input.title,
          content: input.content,
          importance: Math.max(dupe.importance, input.importance ?? 0.5),
          tags: Array.from(new Set([...dupe.tags, ...(input.tags ?? [])])),
        }, agentContext, prisma);

        if (updated) {
          return {
            success: true as const,
            data: { id: dupe.id, status: 'updated' as const, validation: { syncPassed: true, errors: [] } },
          };
        }

        // O-101: updateMemory is user+tenant scoped and returns null when the
        // candidate is not visible to this caller. Previously we still answered
        // {status:'updated', id:<foreign id>} and silently dropped the write.
        // Now we fall through and create the memory normally.
        logger.warn('Near-duplicate update returned null (candidate not visible in caller scope) — creating instead', {
          dupeId: dupe.id,
          tenantId: agentContext.tenantId,
        });
      }
    }
  }

  // O-111: ministry content is encrypted at rest (placeholder in `content`,
  // ciphertext in `encrypted_content`). Returns null for non-ministry rows and
  // in dev/test without ENCRYPTION_KEY; throws in production without a key.
  const encrypted = encryptMemoryContent(input.domain, input.content);


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
      // O-103: undecayed importance — the decay job recomputes `importance`
      // from this every run instead of compounding on its own output.
      baseImportance: input.importance ?? 0.5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confidence: (input.confidence ?? 'MEDIUM') as any,
      sourceRef: input.sourceRef ?? null,
      sourceWeight,
      status: 'DRAFT' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: (input.metadata ?? {}) as any,
      // Agent context — present for MCP writes, absent for BoardRoom AI writes.
      // WS-4: agent_id is now NOT NULL. Non-MCP callers default to 'boardroom-ai'
      // (the service-layer counterpart to the migration's 'legacy' DB default).
      agentId: agentContext?.agentId ?? 'boardroom-ai',
      ...(agentContext ? { tenantId: agentContext.tenantId } : {}),
      // O-111: overrides `content` with the placeholder when encrypted.
      ...(encrypted ?? {}),
    },
  });


  // WS-2: Embedding outbox pattern. Enqueue an outbox row up-front so a stuck
  // embedding is always recoverable via the embedding-retry-scheduler cron,
  // even if this process crashes mid-embed. Then attempt the embed once
  // synchronously — on success we mark the outbox row resolved; on failure we
  // leave it for the cron to retry with exponential backoff. The MCP caller
  // is never blocked waiting on OpenAI past this single attempt.
  await enqueueEmbeddingOutbox(memory.id, prisma);
  await processEmbeddingOutboxEntry(memory.id, prisma);

  return {
    success: true as const,
    data: {
      id: memory.id,
      status: 'created' as const,
      validation: { syncPassed: true, errors: [] },
    },
  };
}

/**
 * Returns the outbox delegate when the connected Prisma client has it, else
 * undefined. Unit tests pass mock-Prisma instances that only stub the models
 * they exercise — without this guard those tests would explode on the new
 * outbox path. When undefined, the caller falls back to direct embedMemory
 * (the pre-WS-2 behavior) so legacy tests keep passing.
 */
type EmbeddingOutboxDelegate = PrismaClient['embeddingOutbox'];
function getOutboxDelegate(prismaClient: PrismaClient): EmbeddingOutboxDelegate | undefined {
  const candidate = (prismaClient as unknown as { embeddingOutbox?: EmbeddingOutboxDelegate })
    .embeddingOutbox;
  if (!candidate || typeof (candidate as { upsert?: unknown }).upsert !== 'function') {
    return undefined;
  }
  return candidate;
}

/**
 * WS-2.2 — Insert a pending outbox row for a freshly-created memory.
 * Uses upsert so a re-enqueue (e.g. on retry) is idempotent.
 *
 * Failures here are non-fatal: the memory row already exists, so dropping the
 * outbox insert would only mean the cron can't see this one specific row to
 * retry. We log and swallow rather than failing the parent createMemory call.
 */
export async function enqueueEmbeddingOutbox(
  memoryId: string,
  prismaArg?: PrismaClient
): Promise<void> {
  const prismaClient = prismaArg ?? defaultPrisma;
  const outbox = getOutboxDelegate(prismaClient);
  if (!outbox) return; // mock-Prisma in unit tests, or pre-migration client

  try {
    await outbox.upsert({
      where: { memoryId },
      create: { memoryId },
      update: {}, // no-op: don't clobber attempts / lastError on re-enqueue
    });
  } catch (err) {
    logger.error('Embedding outbox enqueue failed', {
      memoryId,
      error: (err as Error).message,
    });
  }
}

/**
 * WS-2.2 / WS-2.3 — Attempt to embed a single outbox-tracked memory.
 *
 * Wraps the embedMemory call with outbox bookkeeping:
 *   - increments attempts on every try
 *   - stamps lastAttemptAt (used by the cron's exponential-backoff filter)
 *   - on success: stamps succeededAt, clears lastError
 *   - on failure: stores lastError, leaves succeededAt NULL so the cron picks
 *     it up on its next tick (subject to backoff)
 *
 * Exported so the embedding-retry-scheduler can call it for each pending row.
 */
export async function processEmbeddingOutboxEntry(
  memoryId: string,
  prismaArg?: PrismaClient
): Promise<{ succeeded: boolean; error?: string }> {
  const prismaClient = prismaArg ?? defaultPrisma;
  const outbox = getOutboxDelegate(prismaClient);

  // No outbox delegate available (mock-Prisma in unit tests, or the migration
  // hasn't run yet). Fall back to the pre-WS-2 behavior: best-effort embed
  // with a swallowed error. This preserves the existing test contract.
  if (!outbox) {
    try {
      await embedMemory(memoryId);
      return { succeeded: true };
    } catch (err) {
      const message = (err as Error).message;
      logger.error('Embedding failed (no outbox available)', { memoryId, error: message });
      return { succeeded: false, error: message };
    }
  }

  const now = new Date();

  // Atomically bump attempts + lastAttemptAt before attempting the embed so
  // a crash mid-attempt still leaves a paper trail.
  try {
    await outbox.update({
      where: { memoryId },
      data: { attempts: { increment: 1 }, lastAttemptAt: now },
    });
  } catch {
    // Row doesn't exist (shouldn't happen for the createMemory path, but the
    // cron could race with a manual cleanup). Create it then continue.
    await enqueueEmbeddingOutbox(memoryId, prismaClient);
    await outbox.update({
      where: { memoryId },
      data: { attempts: { increment: 1 }, lastAttemptAt: now },
    });
  }

  let thrown: Error | null = null;
  try {
    await embedMemory(memoryId);
  } catch (err) {
    thrown = err as Error;
  }

  // embedMemory currently returns void in both success and "OpenAI down" paths
  // (it logs and swallows internally). To tell the cases apart we re-query the
  // row and check whether an embedding actually landed.
  const status = await getEmbeddingStatus(memoryId);

  if (!thrown && status === 'ready') {
    await outbox.update({
      where: { memoryId },
      data: { succeededAt: new Date(), lastError: null },
    });
    return { succeeded: true };
  }

  const message = thrown
    ? thrown.message
    : `Embedding still ${status} after attempt — provider unavailable or missing`;

  logger.error('Embedding attempt failed (outbox-tracked)', {
    memoryId,
    status,
    error: message,
  });

  try {
    await outbox.update({
      where: { memoryId },
      data: { lastError: message.slice(0, 1000) },
    });
  } catch {
    /* outbox row gone — already logged above */
  }
  return { succeeded: false, error: message };
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
  return decryptMemory(memory);
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

  const items = rawItems.map(m => decryptMemory(m));


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

  // Phase 6 (A2) — `supersedes: <oldId>`: this row (`id`) replaces `oldId`.
  // The old row is stamped `invalidAt = now, supersededBy = id` (content
  // untouched) and `oldId` is appended to this row's `consolidatedFrom`.
  // Resolved here so the old row is verified in the same user/tenant scope.
  const { supersedes, ...inputWithoutSupersedes } = input as Record<string, unknown> & { supersedes?: unknown };
  input = inputWithoutSupersedes;
  let supersededRow: { id: string } | null = null;
  if (supersedes !== undefined && supersedes !== null) {
    if (typeof supersedes !== 'string' || supersedes.length === 0) {
      throw new HttpError(422, { code: 'validation_failed', message: 'supersedes must be a memory id' });
    }
    if (supersedes === id) {
      throw new HttpError(422, { code: 'validation_failed', message: 'A memory cannot supersede itself' });
    }
    supersededRow = await prisma.memoryEntry.findFirst({
      where: { ...ownershipWhere, id: supersedes },
      select: { id: true },
    });
    if (!supersededRow) {
      throw new HttpError(404, { code: 'not_found', message: 'Memory to supersede not found' });
    }
  }

  // WS-6 F-101 — Normalize the input domain (if present) and compare existing.domain
  // case-insensitively so legacy rows with non-normalized domains are still gated.
  if (typeof input.domain === 'string') {
    input = { ...input, domain: normalizeDomain(input.domain) };
  }
  if (normalizeDomain(existing.domain) === 'ministry' || input.domain === 'ministry') {
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

  // O-103: an explicit importance change resets the undecayed base as well.
  const baseImportancePatch =
    typeof input.importance === 'number' ? { baseImportance: input.importance } : {};

  // O-111: ministry rows keep ciphertext in encrypted_content — re-encrypt on
  // content change. (Unreachable today because of the MINISTRY_DEFERRED gate
  // above; wired so the write path is complete when Phase 6 lifts the gate.)
  const encryptedPatch =
    typeof input.content === 'string'
      ? encryptMemoryContent(
          typeof input.domain === 'string' ? input.domain : existing.domain,
          input.content
        ) ?? {}
      : {};

  const alreadyConsolidated = Array.isArray((existing as { consolidatedFrom?: unknown }).consolidatedFrom)
    ? ((existing as { consolidatedFrom: string[] }).consolidatedFrom).includes(supersededRow?.id ?? '')
    : false;
  const consolidatedPatch =
    supersededRow && !alreadyConsolidated ? { consolidatedFrom: { push: supersededRow.id } } : {};

  const updateData: Record<string, unknown> = {
    ...input,
    ...contextOverrides,
    ...baseImportancePatch,
    ...encryptedPatch,
    ...consolidatedPatch,
    version: { increment: 1 },
  };


  const memory = await prisma.memoryEntry.update({
    where: { id },
    data: updateData as Parameters<typeof prisma.memoryEntry.update>[0]['data'],
  });

  if (supersededRow) {
    await prisma.memoryEntry.update({
      where: { id: supersededRow.id },
      data: { invalidAt: new Date(), supersededBy: id, version: { increment: 1 } },
    });
  }

  // Re-embed if content or title changed (sync for test determinism)
  if ('content' in input || 'title' in input) {
    try {
      await embedMemory(memory.id);
    } catch (err) {
      logger.error('Embedding failed', { memoryId: memory.id, error: (err as Error).message });
    }
  }

  return decryptMemory(memory);
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

// ---------------------------------------------------------------------------
// Phase 6 (A2) — hybrid search for MCP / BoardRoom (`POST /memories/search`).
//
// Same stack as `assembleContextForPersona`: structured + FTS + trigram +
// semantic → rankAndDeduplicate → forgetting curve (inside the layers) →
// decrypt. Differences from the persona path: no persona tag boosts / token
// budget, no recall reinforcement (an agent paging through results is not a
// persona recall), and the ranked pool is paginated with an opaque cursor.
// ---------------------------------------------------------------------------

export const HYBRID_SEARCH_MAX_LIMIT = 50;
export const HYBRID_SEARCH_DEFAULT_LIMIT = 20;
/** Candidates requested from each layer; the ranked pool is at most 4× this. */
const HYBRID_LAYER_LIMIT = 50;
const HYBRID_POOL_MAX = 200;

export interface HybridSearchParams {
  query: string;
  limit?: number;
  domain?: string;
  tags?: string[];
  status?: string;
  includeArchived?: boolean;
  asOf?: Date;
  cursor?: string | null;
}

export interface HybridSearchResult<T = unknown> {
  items: Array<T & { score: number }>;
  nextCursor: string | null;
}

/** In-memory mirror of the layers' temporal filter (defense in depth after ranking). */
function isTemporallyValid(row: { validAt: Date; invalidAt: Date | null }, asOf?: Date): boolean {
  const at = asOf ?? new Date();
  if (asOf && row.validAt.getTime() > asOf.getTime()) return false;
  return row.invalidAt === null || row.invalidAt.getTime() > at.getTime();
}

export function encodeSearchCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf-8').toString('base64');
}

/** Throws HttpError 400 on a malformed cursor. */
export function decodeSearchCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as { offset?: unknown };
    if (parsed && typeof parsed.offset === 'number' && Number.isInteger(parsed.offset) && parsed.offset >= 0) {
      return parsed.offset;
    }
  } catch {
    /* fall through */
  }
  throw new HttpError(400, { code: 'invalid_cursor', message: 'cursor is not a valid search cursor' });
}

export async function hybridSearchMemories(
  userId: string,
  params: HybridSearchParams,
  agentContext: AgentContext | undefined,
  prisma: PrismaClient
): Promise<HybridSearchResult> {
  const query = params.query.trim();
  const limit = Math.min(Math.max(Math.floor(params.limit ?? HYBRID_SEARCH_DEFAULT_LIMIT), 1), HYBRID_SEARCH_MAX_LIMIT);
  const offset = decodeSearchCursor(params.cursor);
  const domain = params.domain ? normalizeDomain(params.domain) : undefined;
  const includeArchived = params.includeArchived ?? false;
  const asOf = params.asOf;

  // Tenant: agent requests are scoped to their tenant; BoardRoom (no agent
  // context) is single-user and opts into all tenants — same as /context/for-persona.
  const tenantId = agentContext?.tenantId;
  const scope = { tenantId, includeAllTenants: !tenantId, includeArchived, asOf };

  const queryEmbedding = await generateEmbeddingWithRetry(query, domain).catch(() => null);

  const [structured, fts, trigram, semantic] = await Promise.all([
    structuredFilter(userId, query, { limit: HYBRID_LAYER_LIMIT, domain, tags: params.tags, ...scope }, prisma)
      .catch(err => { logger.error('[structured] hybrid search layer failed', { error: (err as Error).message }); return []; }),
    fulltextSearch(userId, query, { limit: HYBRID_LAYER_LIMIT, ...scope }, prisma),
    trigramSearch(userId, query, { limit: HYBRID_LAYER_LIMIT, ...scope }, prisma),
    queryEmbedding ? semanticSearch(userId, queryEmbedding, { limit: HYBRID_LAYER_LIMIT, ...scope }, prisma) : Promise.resolve([]),
  ]);

  const ranked = rankAndDeduplicate(
    [
      { layer: 'structured', results: structured },
      { layer: 'fts', results: fts },
      { layer: 'trigram', results: trigram },
      { layer: 'semantic', results: semantic },
    ],
    HYBRID_POOL_MAX
  ).filter(r => r.type === 'memory');
  if (ranked.length === 0) return { items: [], nextCursor: null };

  // Full rows for the ranked ids, with the explicit filters applied in SQL so
  // pagination runs over the filtered, ranked list.
  const where: Prisma.MemoryEntryWhereInput = {
    id: { in: ranked.map(r => r.id) },
    userId,
    deletedAt: null,
    ...(tenantId ? { tenantId } : {}),
    ...(domain ? { domain } : {}),
    ...(params.tags && params.tags.length > 0 ? { tags: { hasEvery: params.tags } } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: params.status ? (params.status as any) : { not: 'ARCHIVED' },
  };
  const rows = await prisma.memoryEntry.findMany({ where });
  const byId = new Map(rows.map(r => [r.id, r]));

  const ordered: Array<Record<string, unknown> & { score: number }> = [];
  for (const r of ranked) {
    const row = byId.get(r.id);
    if (!row) continue;
    if (!isTemporallyValid(row, asOf)) continue; // defense in depth — the layers filter too
    const dec = tryDecryptMemory(row);
    if (!dec) continue; // logged by memory-crypto; never surface ciphertext
    ordered.push({ ...dec, score: Number(r.relevanceScore.toFixed(4)) });
  }

  const page = ordered.slice(offset, offset + limit);
  const nextCursor = ordered.length > offset + limit ? encodeSearchCursor(offset + limit) : null;
  return { items: page, nextCursor };
}
