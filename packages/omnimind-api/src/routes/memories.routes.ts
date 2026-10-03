import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { z } from 'zod';
import { CreateMemoryRequestSchema, MemoryStatusSchema, UpdateMemoryRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as memoryService from '../services/memory.service';
import { backfillEmbeddings, generateEmbeddingWithRetry } from '../services/embedding.service';
import { isAdminRequest } from '../middleware/admin-auth';
import { idempotent } from '../middleware/idempotency';
import { entityExists, normalizeLinkEntityType, LEGACY_LINK_ENTITY_TYPES } from '../services/unlinked-mentions.service';

// Phase 6 (A2) — PATCH /memories/:id gains `supersedes: <oldMemoryId>`
// (old row → invalidAt=now, supersededBy=:id; :id.consolidatedFrom += old).
// Extended locally: lane A2 may not edit the shared schema.
const PatchMemoryBodySchema = UpdateMemoryRequestSchema.extend({
  supersedes: z.string().min(1).optional(),
});

// Phase 6 (A2) — POST /memories/search body
const HybridSearchBodySchema = z.object({
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().min(1).max(memoryService.HYBRID_SEARCH_MAX_LIMIT).optional(),
  domain: z.string().trim().min(1).optional(),
  tags: z.array(z.string().min(1)).max(20).optional(),
  status: MemoryStatusSchema.optional(),
  includeArchived: z.boolean().optional(),
  asOf: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().max(256).nullable().optional(),
});


const router: IRouter = Router();

// POST /memories — create (Idempotency-Key aware, Phase 6)
router.post('/', idempotent('memories.create'), async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = CreateMemoryRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const result = await memoryService.createMemory(userId, parseResult.data, req.agentContext, prisma);
    if (!result.success) {
      res.status(422).json({ error: 'validation_failed', details: result.errors });
      return;
    }

    res.status(201).json(result.data);
  } catch (err) { next(err); }
});

// POST /memories/backfill-embeddings
router.post('/backfill-embeddings', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }
    const result = await backfillEmbeddings(userId);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /memories/search-similar — cosine similarity search with threshold (used by MCP fact-extractor dedup)
// Must appear before /:id routes. R-O-02: invalidated / superseded rows are
// never returned (a dedup merge into one would resurrect a replaced belief).
router.post('/search-similar', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const { query, threshold = 0.80, limit = 1, domain } = req.body as {
      query: string;
      threshold?: number;
      limit?: number;
      domain?: string;
    };
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'query', message: 'query is required' }] }); return;
    }

    const embedding = await generateEmbeddingWithRetry(query, domain);
    if (!embedding) {
      res.json({ memories: [] }); return;
    }

    const safeThreshold = Math.max(0, Math.min(1, threshold));
    const safeLimit = Math.min(Math.max(1, limit), 20);

    // CRITICAL: filter by tenantId when agent context is present.
    // Previously this route dropped the tenant scope entirely (Bug #2 from Hermes findings),
    // letting an MCP agent in tenant A see semantically-similar memories from tenant B.
    const tenantId = req.agentContext?.tenantId ?? null;

    const rows = tenantId
      ? await prisma.$queryRaw<Array<{
          id: string; title: string; content: string; domain: string;
          tags: string[]; importance: number; source_type: string;
          tenant_id: string; source_weight: number;
          created_at: Date; updated_at: Date; similarity: number;
        }>>`
          SELECT id, title, content, domain, tags, importance, source_type,
                 tenant_id, source_weight, created_at, updated_at,
                 1 - (embedding <=> ${embedding}::vector) AS similarity
          FROM "memory_entries"
          WHERE "user_id" = ${userId}
            AND tenant_id = ${tenantId}
            AND embedding IS NOT NULL
            AND "deleted_at" IS NULL
            AND status != 'ARCHIVED'
            AND invalid_at IS NULL
            AND superseded_by IS NULL
            AND 1 - (embedding <=> ${embedding}::vector) >= ${safeThreshold}
          ORDER BY embedding <=> ${embedding}::vector
          LIMIT ${safeLimit}
        `
      : await prisma.$queryRaw<Array<{
          id: string; title: string; content: string; domain: string;
          tags: string[]; importance: number; source_type: string;
          tenant_id: string; source_weight: number;
          created_at: Date; updated_at: Date; similarity: number;
        }>>`
          SELECT id, title, content, domain, tags, importance, source_type,
                 tenant_id, source_weight, created_at, updated_at,
                 1 - (embedding <=> ${embedding}::vector) AS similarity
          FROM "memory_entries"
          WHERE "user_id" = ${userId}
            AND embedding IS NOT NULL
            AND "deleted_at" IS NULL
            AND status != 'ARCHIVED'
            AND invalid_at IS NULL
            AND superseded_by IS NULL
            AND 1 - (embedding <=> ${embedding}::vector) >= ${safeThreshold}
          ORDER BY embedding <=> ${embedding}::vector
          LIMIT ${safeLimit}
        `;

    const memories = rows.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      domain: r.domain,
      tags: r.tags,
      importance: r.importance,
      sourceType: r.source_type,
      tenantId: r.tenant_id,
      sourceWeight: r.source_weight,
      similarity: r.similarity,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ memories });
  } catch (err) { next(err); }
});

// POST /memories/search — Phase 6 (A2) hybrid search for MCP / BoardRoom.
// Same stack as /context/for-persona (structured + FTS + trigram + semantic →
// rank, forgetting curve, decrypt). Tenant from req.agentContext. Must be
// before /:id.
// Body: { query, limit?≤50, domain?, tags?, status?, includeArchived?, asOf?, cursor? }
// Response: { items: (Memory & { score })[], nextCursor: string|null }
router.post('/search', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parsed = HybridSearchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const { asOf, ...rest } = parsed.data;
    const result = await memoryService.hybridSearchMemories(
      userId,
      { ...rest, asOf: asOf ? new Date(asOf) : undefined },
      req.agentContext,
      prisma,
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /memories/validate — dry-run (must be before /:id to avoid matching "validate" as id)
router.post('/validate', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const domain = (req.body as Record<string, unknown>).domain as string ?? '';
    const result = await memoryService.validateMemoryInput(userId, req.body, domain, prisma);

    res.json(result);
  } catch (err) { next(err); }
});

// GET /memories — search/filter
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined;
    const tenantId = req.query.tenantId as string | undefined;
    // R-O-02: invalidated rows are hidden by default; ?includeInvalidated=true opts in.
    const includeInvalidated =
      typeof req.query.includeInvalidated === 'string' &&
      req.query.includeInvalidated.toLowerCase() === 'true';

    // O-105: an agent may not read outside its own tenant by passing
    // ?tenantId=<other>. Only an admin (x-admin-key) who explicitly opts in
    // with ?includeAllTenants=true may cross tenants.
    const includeAllTenants =
      typeof req.query.includeAllTenants === 'string' &&
      req.query.includeAllTenants.toLowerCase() === 'true' &&
      isAdminRequest(req);
    const ctxTenant = req.agentContext?.tenantId;
    if (ctxTenant && tenantId && tenantId !== ctxTenant && !includeAllTenants) {
      res.status(403).json({
        error: 'tenant_mismatch',
        message: `tenantId '${tenantId}' does not match the caller's tenant`,
      });
      return;
    }

    const result = await memoryService.searchMemories(userId, {

      q: req.query.q as string | undefined,
      domain: req.query.domain as string | undefined,
      tags,
      tenantId,
      memoryClass: req.query.memoryClass as string | undefined,
      status: req.query.status as string | undefined,
      since: req.query.since as string | undefined,
      sortBy: req.query.sortBy as string | undefined,
      sortOrder: req.query.sortOrder as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      includeAllTenants,
      includeInvalidated,
    }, req.agentContext, prisma);

    res.json(result);
  } catch (err) { next(err); }
});

// GET /memories/:id

router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const memory = await memoryService.getMemory(userId, req.params.id, req.agentContext, prisma);
    if (!memory) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    res.json(memory);
  } catch (err) { next(err); }
});

// PATCH /memories/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = PatchMemoryBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const memory = await memoryService.updateMemory(userId, req.params.id, parseResult.data, req.agentContext, prisma);
    if (!memory) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    res.json(memory);
  } catch (err) { next(err); }
});

// DELETE /memories/:id (soft delete / archive)
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await memoryService.archiveMemory(userId, req.params.id, req.agentContext, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    res.json(result);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Memory Entity Links
// ---------------------------------------------------------------------------

// POST /memories/:id/links — create a MemoryEntityLink
// R-O-13: entityType is lower-cased + enum-validated and the target entity
// must exist for this user (same lookup as POST /graph/unlinked-mentions/link).
router.post('/:id/links', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const { entityType: rawEntityType, entityId, linkType } = req.body as { entityType?: unknown; entityId?: unknown; linkType?: unknown };
    if (!rawEntityType || typeof entityId !== 'string' || entityId.length === 0) {
      res.status(422).json({ error: 'validation_failed', details: [{ field: 'entityType/entityId', message: 'entityType and entityId are required' }] });
      return;
    }
    const entityType = normalizeLinkEntityType(rawEntityType);
    if (!entityType) {
      res.status(422).json({ error: 'validation_failed', details: [{ field: 'entityType', message: `entityType must be one of ${LEGACY_LINK_ENTITY_TYPES.join('|')}` }] });
      return;
    }
    if (linkType !== undefined && (typeof linkType !== 'string' || linkType.length === 0 || linkType.length > 64)) {
      res.status(422).json({ error: 'validation_failed', details: [{ field: 'linkType', message: 'linkType must be a non-empty string (≤64 chars)' }] });
      return;
    }

    // Verify memory belongs to user (and tenant, when an agent context is present)
    const memory = await prisma.memoryEntry.findFirst({
      where: { id: req.params.id, userId, deletedAt: null, ...(req.agentContext?.tenantId ? { tenantId: req.agentContext.tenantId } : {}) },
    });
    if (!memory) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    if (!(await entityExists(prisma, userId, entityType, entityId))) {
      res.status(404).json({ error: 'not_found', message: `${entityType} not found` });
      return;
    }

    const link = await prisma.memoryEntityLink.create({
      data: {
        memoryId: req.params.id,
        entityType,
        entityId,
        linkType: (linkType as string | undefined) ?? 'relates_to',
      },
    });

    res.status(201).json(link);
  } catch (err) { next(err); }
});

// GET /memories/:id/links — list links for a memory
router.get('/:id/links', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    // Verify memory belongs to user
    const memory = await prisma.memoryEntry.findFirst({ where: { id: req.params.id, userId, deletedAt: null } });
    if (!memory) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    const links = await prisma.memoryEntityLink.findMany({
      where: { memoryId: req.params.id },
    });

    res.json(links);
  } catch (err) { next(err); }
});

// DELETE /memories/:id/links/:linkId — remove a link
router.delete('/:id/links/:linkId', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    // Verify memory belongs to user
    const memory = await prisma.memoryEntry.findFirst({ where: { id: req.params.id, userId, deletedAt: null } });
    if (!memory) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    const link = await prisma.memoryEntityLink.findFirst({ where: { id: req.params.linkId, memoryId: req.params.id } });
    if (!link) { res.status(404).json({ error: 'not_found', message: 'Link not found' }); return; }

    await prisma.memoryEntityLink.delete({ where: { id: req.params.linkId } });
    res.json({ status: 'deleted' });
  } catch (err) { next(err); }
});

export const memoriesRouter: IRouter = router;
