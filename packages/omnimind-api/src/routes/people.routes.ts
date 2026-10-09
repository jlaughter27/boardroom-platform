import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { z } from 'zod';
import { CreatePersonRequestSchema, UpdatePersonRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as entityService from '../services/entity.service';
import { idempotent } from '../middleware/idempotency';
import { findDuplicatePeople } from '../services/person-duplicates.service';

const DuplicatesQuerySchema = z.object({
  threshold: z.coerce.number().min(0.3).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const router: IRouter = Router();

// POST /people — create (Idempotency-Key aware, Phase 6)
router.post('/', idempotent('people.create'), async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = CreatePersonRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const person = await entityService.createEntity('person', userId, parseResult.data, prisma);
    res.status(201).json(person);
  } catch (err) { next(err); }
});

// GET /people — list
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.listEntities('person', userId, {
      q: req.query.q as string | undefined,
      domain: req.query.domain as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    }, prisma);

    res.json(result);
  } catch (err) { next(err); }
});

// GET /people/duplicates — Phase 6 (A2). Must be mounted before /:id.
// Query: threshold (0.3..1, default 0.6) · limit (≤200, default 100)
// Response: { pairs: Array<{ a: Person, b: Person, similarity }> } — pg_trgm
// similarity(name) >= threshold, name-only (Person has no email), no auto-merge.
router.get('/duplicates', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parsed = DuplicatesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const result = await findDuplicatePeople(userId, parsed.data, prisma);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /people/:id
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const person = await entityService.getEntity('person', userId, req.params.id, prisma);
    if (!person) { res.status(404).json({ error: 'not_found', message: 'Person not found' }); return; }

    res.json(person);
  } catch (err) { next(err); }
});

// PATCH /people/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = UpdatePersonRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const person = await entityService.updateEntity('person', userId, req.params.id, parseResult.data, prisma);
    if (!person) { res.status(404).json({ error: 'not_found', message: 'Person not found' }); return; }

    res.json(person);
  } catch (err) { next(err); }
});

// DELETE /people/:id (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.deleteEntity('person', userId, req.params.id, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Person not found' }); return; }

    res.json(result);
  } catch (err) { next(err); }
});

export const peopleRouter: IRouter = router;
