import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreateMemoryRequestSchema, UpdateMemoryRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as memoryService from '../services/memory.service';
import { backfillEmbeddings } from '../services/embedding.service';

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
    const result = await memoryService.searchMemories(userId, {
      q: req.query.q as string | undefined,
      domain: req.query.domain as string | undefined,
      tags,
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

export const memoriesRouter: IRouter = router;
