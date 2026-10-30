import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreateCommitmentRequestSchema, ListCommitmentsQuerySchema, UpdateCommitmentRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import { idempotent } from '../middleware/idempotency';
import * as commitmentService from '../services/commitment.service';
import { invalidateCoreContext } from '../services/core-context.service';

const router: IRouter = Router();

// POST /commitments — create
// Phase 6: `Idempotency-Key` replay (middleware owned by A2).
router.post('/', idempotent('commitments.create'), async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = CreateCommitmentRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }
    // RD-12: a delegation must name who owes it.
    if (parseResult.data.owedBy === 'STAKEHOLDER' && !parseResult.data.stakeholderId) {
      res.status(422).json({
        error: 'validation_failed',
        details: [{ field: 'stakeholderId', message: 'stakeholderId is required when owedBy is STAKEHOLDER' }],
      });
      return;
    }

    const commitment = await commitmentService.createCommitment(userId, parseResult.data, prisma);
    res.status(201).json(commitment);
  } catch (err) { next(err); }
});

// GET /commitments — list
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    // RD-12 owedBy direction filter + robustness fixes 2026-10-30: status,
    // limit and offset are validated too (they used to reach Prisma raw → 500).
    const parsedQuery = ListCommitmentsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsedQuery.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }
    const query = parsedQuery.data;

    const result = await commitmentService.listCommitments(userId, {
      owedBy: query.owedBy,
      status: query.status,
      overdue: query.overdue,
      limit: query.limit,
      offset: query.offset,
    }, prisma);

    res.json(result);
  } catch (err) { next(err); }
});

// GET /commitments/nudges — Phase 6: { dueSoon, overdue } (SQL only; must precede /:id)
router.get('/nudges', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }
    const nudges = await commitmentService.getCommitmentNudges(userId, prisma);
    res.json(nudges);
  } catch (err) { next(err); }
});

// GET /commitments/:id
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const commitment = await commitmentService.getCommitment(userId, req.params.id, prisma);
    if (!commitment) { res.status(404).json({ error: 'not_found', message: 'Commitment not found' }); return; }

    res.json(commitment);
  } catch (err) { next(err); }
});

// PATCH /commitments/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = UpdateCommitmentRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const commitment = await commitmentService.updateCommitment(userId, req.params.id, parseResult.data, prisma);
    if (!commitment) { res.status(404).json({ error: 'not_found', message: 'Commitment not found' }); return; }

    res.json(commitment);
  } catch (err) { next(err); }
});

// DELETE /commitments/:id — soft delete
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const existing = await prisma.commitment.findFirst({ where: { id: req.params.id, userId, deletedAt: null } });
    if (!existing) { res.status(404).json({ error: 'not_found', message: 'Commitment not found' }); return; }
    await prisma.commitment.update({ where: { id: req.params.id }, data: { deletedAt: new Date() } });
    // Phase 6: open commitments live in the cached core block.
    invalidateCoreContext(userId);
    commitmentService.invalidateNudgeCache(userId);
    res.json({ id: req.params.id, status: 'deleted' });
  } catch (err) { next(err); }
});

export const commitmentsRouter: IRouter = router;
