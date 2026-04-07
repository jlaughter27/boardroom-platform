import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreateCommitmentRequestSchema, UpdateCommitmentRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as commitmentService from '../services/commitment.service';

const router: IRouter = Router();

// POST /commitments — create
router.post('/', async (req, res, next) => {
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

    const commitment = await commitmentService.createCommitment(userId, parseResult.data, prisma);
    res.status(201).json(commitment);
  } catch (err) { next(err); }
});

// GET /commitments — list
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await commitmentService.listCommitments(userId, {
      status: req.query.status as string | undefined,
      overdue: req.query.overdue === 'true',
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    }, prisma);

    res.json(result);
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
    res.json({ id: req.params.id, status: 'deleted' });
  } catch (err) { next(err); }
});

export const commitmentsRouter: IRouter = router;
