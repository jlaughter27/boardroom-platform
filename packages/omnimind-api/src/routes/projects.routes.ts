import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreateProjectRequestSchema, UpdateProjectRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as entityService from '../services/entity.service';

const router: IRouter = Router();

// POST /projects — create
router.post('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = CreateProjectRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const project = await entityService.createEntity('project', userId, parseResult.data, prisma);
    res.status(201).json(project);
  } catch (err) { next(err); }
});

// GET /projects — list
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.listEntities('project', userId, {
      status: req.query.status as string | undefined,
      domain: req.query.domain as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    }, prisma);

    res.json(result);
  } catch (err) { next(err); }
});

// GET /projects/:id — supports ?include=tasks
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const include = req.query.include === 'tasks'
      ? { taskLinks: { include: { task: true } } }
      : undefined;
    const project = await entityService.getEntity('project', userId, req.params.id, prisma, include);
    if (!project) { res.status(404).json({ error: 'not_found', message: 'Project not found' }); return; }

    res.json(project);
  } catch (err) { next(err); }
});

// PATCH /projects/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = UpdateProjectRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const project = await entityService.updateEntity('project', userId, req.params.id, parseResult.data, prisma);
    if (!project) { res.status(404).json({ error: 'not_found', message: 'Project not found' }); return; }

    res.json(project);
  } catch (err) { next(err); }
});

// DELETE /projects/:id (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.deleteEntity('project', userId, req.params.id, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Project not found' }); return; }

    res.json(result);
  } catch (err) { next(err); }
});

export const projectsRouter: IRouter = router;
