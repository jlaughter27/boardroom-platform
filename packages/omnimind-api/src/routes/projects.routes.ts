import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { z } from 'zod';
import { CreateProjectRequestSchema, UpdateProjectRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as entityService from '../services/entity.service';
import { idempotent } from '../middleware/idempotency';

const router: IRouter = Router();

// POST /projects — create (Idempotency-Key aware, Phase 6)
router.post('/', idempotent('projects.create'), async (req, res, next) => {
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

// GET /projects/:id — supports ?include=tasks. Always returns `goalIds` and
// `taskIds` (C-111: GoalProjectLink / ProjectTaskLink — two cheap joins).
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const include: Record<string, unknown> = {
      goalLinks: { select: { goalId: true } },
      taskLinks: req.query.include === 'tasks'
        ? { include: { task: true } }
        : { select: { taskId: true } },
    };
    const project = await entityService.getEntity('project', userId, req.params.id, prisma, include);
    if (!project) { res.status(404).json({ error: 'not_found', message: 'Project not found' }); return; }

    const goalLinks = (project.goalLinks ?? []) as Array<{ goalId: string }>;
    const taskLinks = (project.taskLinks ?? []) as Array<{ taskId: string }>;
    res.json({
      ...project,
      goalIds: goalLinks.map(l => l.goalId),
      taskIds: taskLinks.map(l => l.taskId),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// C-111 — Project ↔ Task links (ProjectTaskLink). No body; ids in the path.
// 201 when created, 200 when it already existed, 404 when either entity is
// missing / soft-deleted / not owned by x-user-id.
// ---------------------------------------------------------------------------

// POST /projects/:projectId/tasks/:taskId — link
router.post('/:projectId/tasks/:taskId', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.linkProjectTask(userId, req.params.projectId, req.params.taskId, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Project or task not found' }); return; }

    const { id, projectId, taskId } = result.link;
    res.status(result.created ? 201 : 200).json({ id, projectId, taskId });
  } catch (err) { next(err); }
});

// DELETE /projects/:projectId/tasks/:taskId — unlink
router.delete('/:projectId/tasks/:taskId', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.unlinkProjectTask(userId, req.params.projectId, req.params.taskId, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Link not found' }); return; }

    res.json(result);
  } catch (err) { next(err); }
});


// ---------------------------------------------------------------------------
// Phase 6 (A2) — Project ↔ Person (ProjectPersonLink, body `{ role? }`) and
// Project ↔ Decision (DecisionProjectLink). 201 created / 200 existed /
// 204 unlinked / 404 when either entity is missing, soft-deleted or foreign.
// ---------------------------------------------------------------------------

const ProjectPersonLinkBodySchema = z.object({ role: z.string().max(120).optional() }).strict();

// POST /projects/:projectId/people/:personId — link (body { role? })
router.post('/:projectId/people/:personId', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parsed = ProjectPersonLinkBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const result = await entityService.linkProjectPerson(userId, req.params.projectId, req.params.personId, parsed.data.role, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Project or person not found' }); return; }

    const { id, projectId, personId, role } = result.link;
    res.status(result.created ? 201 : 200).json({ id, projectId, personId, role });
  } catch (err) { next(err); }
});

// DELETE /projects/:projectId/people/:personId — unlink
router.delete('/:projectId/people/:personId', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.unlinkProjectPerson(userId, req.params.projectId, req.params.personId, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Link not found' }); return; }

    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /projects/:projectId/decisions/:decisionId — link
router.post('/:projectId/decisions/:decisionId', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.linkDecisionProject(userId, req.params.projectId, req.params.decisionId, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Project or decision not found' }); return; }

    const { id, decisionId, projectId } = result.link;
    res.status(result.created ? 201 : 200).json({ id, decisionId, projectId });
  } catch (err) { next(err); }
});

// DELETE /projects/:projectId/decisions/:decisionId — unlink
router.delete('/:projectId/decisions/:decisionId', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await entityService.unlinkDecisionProject(userId, req.params.projectId, req.params.decisionId, prisma);
    if (!result) { res.status(404).json({ error: 'not_found', message: 'Link not found' }); return; }

    res.status(204).end();
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
