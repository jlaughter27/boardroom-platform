import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreatePersonRequestSchema, UpdatePersonRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as entityService from '../services/entity.service';

const router: IRouter = Router();

// POST /people — create
router.post('/', async (req, res, next) => {
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
