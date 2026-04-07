import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreateGoalRequestSchema, UpdateGoalRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as entityService from '../services/entity.service';

const router: IRouter = Router();

// POST /goals — create
router.post('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = CreateGoalRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const goal = await entityService.createEntity('goal', userId, parseResult.data, prisma);
    res.status(201).json(goal);
  } catch (err) { next(err); }
});

// GET /goals — list
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.listEntities('goal', userId, {
      level: req.query.level as string | undefined,
      status: req.query.status as string | undefined,
      domain: req.query.domain as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    }, prisma);

    res.json(result);
  } catch (err) { next(err); }
});

// GET /goals/:id — supports ?include=children
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const include = req.query.include === 'children' ? { childGoals: true } : undefined;
    const goal = await entityService.getEntity('goal', userId, req.params.id, prisma, include);
    if (!goal) { res.status(404).json({ error: 'not_found', message: 'Goal not found' }); return; }

    res.json(goal);
  } catch (err) { next(err); }
});

// PATCH /goals/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = UpdateGoalRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const goal = await entityService.updateEntity('goal', userId, req.params.id, parseResult.data, prisma);
    if (!goal) { res.status(404).json({ error: 'not_found', message: 'Goal not found' }); return; }

    res.json(goal);
  } catch (err) { next(err); }
});

// DELETE /goals/:id (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.deleteEntity('goal', userId, req.params.id, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Goal not found' }); return; }

    res.json(result);
  } catch (err) { next(err); }
});

export const goalsRouter: IRouter = router;
