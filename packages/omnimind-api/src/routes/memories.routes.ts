import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreateMemoryRequestSchema, UpdateMemoryRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as memoryService from '../services/memory.service';
import { backfillEmbeddings, generateEmbeddingWithRetry } from '../services/embedding.service';

const router: IRouter = Router();

// POST /memories — create
router.post('/', async (req, res, next) => {
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

    const result = await memoryService.createMemory(userId, parseResult.data, prisma);
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
// Must appear before /:id routes
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

    const rows = await prisma.$queryRaw<Array<{
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
    }, prisma);

    res.json(result);
  } catch (err) { next(err); }
});

// GET /memories/:id
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const memory = await memoryService.getMemory(userId, req.params.id, prisma);
    if (!memory) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    res.json(memory);
  } catch (err) { next(err); }
});

// PATCH /memories/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = UpdateMemoryRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const memory = await memoryService.updateMemory(userId, req.params.id, parseResult.data, prisma);
    if (!memory) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    res.json(memory);
  } catch (err) { next(err); }
});

// DELETE /memories/:id (soft delete / archive)
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await memoryService.archiveMemory(userId, req.params.id, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    res.json(result);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Memory Entity Links
// ---------------------------------------------------------------------------

// POST /memories/:id/links — create a MemoryEntityLink
router.post('/:id/links', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const { entityType, entityId, linkType } = req.body as { entityType: string; entityId: string; linkType?: string };
    if (!entityType || !entityId) {
      res.status(422).json({ error: 'validation_failed', details: [{ field: 'entityType/entityId', message: 'entityType and entityId are required' }] });
      return;
    }

    // Verify memory belongs to user
    const memory = await prisma.memoryEntry.findFirst({ where: { id: req.params.id, userId, deletedAt: null } });
    if (!memory) { res.status(404).json({ error: 'not_found', message: 'Memory not found' }); return; }

    const link = await prisma.memoryEntityLink.create({
      data: {
        memoryId: req.params.id,
        entityType,
        entityId,
        linkType: linkType ?? 'relates_to',
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
