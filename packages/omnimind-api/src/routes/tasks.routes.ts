import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreateTaskRequestSchema, UpdateTaskRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as entityService from '../services/entity.service';

const router: IRouter = Router();

// POST /tasks — create
router.post('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = CreateTaskRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const task = await entityService.createEntity('task', userId, parseResult.data, prisma);
    res.status(201).json(task);
  } catch (err) { next(err); }
});

// GET /tasks — list
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.listEntities('task', userId, {
      status: req.query.status as string | undefined,
      priority: req.query.priority as string | undefined,
      owner: req.query.owner as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    }, prisma);

    res.json(result);
  } catch (err) { next(err); }
});

// GET /tasks/:id
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const task = await entityService.getEntity('task', userId, req.params.id, prisma);
    if (!task) { res.status(404).json({ error: 'not_found', message: 'Task not found' }); return; }

    res.json(task);
  } catch (err) { next(err); }
});

// PATCH /tasks/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = UpdateTaskRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const task = await entityService.updateEntity('task', userId, req.params.id, parseResult.data, prisma);
    if (!task) { res.status(404).json({ error: 'not_found', message: 'Task not found' }); return; }

    res.json(task);
  } catch (err) { next(err); }
});

// DELETE /tasks/:id (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.deleteEntity('task', userId, req.params.id, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Task not found' }); return; }

    res.json(result);
  } catch (err) { next(err); }
});

export const tasksRouter: IRouter = router;
