import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { CreateDecisionRequestSchema, UpdateDecisionRequestSchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as decisionService from '../services/decision.service';
import { scheduleReviews } from '../services/outcome-review.service';

const router: IRouter = Router();

// POST /decisions — create
router.post('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = CreateDecisionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const decision = await decisionService.createDecision(userId, parseResult.data, prisma);
    res.status(201).json(decision);
  } catch (err) { next(err); }
});

// GET /decisions — list
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const result = await decisionService.listDecisions(userId, {
      status: req.query.status as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    }, prisma);

    res.json(result);
  } catch (err) { next(err); }
});

// GET /decisions/:id
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const decision = await decisionService.getDecision(userId, req.params.id, prisma);
    if (!decision) { res.status(404).json({ error: 'not_found', message: 'Decision not found' }); return; }

    res.json(decision);
  } catch (err) { next(err); }
});

// PATCH /decisions/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); return; }

    const parseResult = UpdateDecisionRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parseResult.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const decision = await decisionService.updateDecision(userId, req.params.id, parseResult.data, prisma);
    if (!decision) { res.status(404).json({ error: 'not_found', message: 'Decision not found' }); return; }

    // When a decision moves to DECIDED, schedule 30-day and 90-day review nudges
    if (decision.status === 'DECIDED') {
      await scheduleReviews(userId, decision.id, decision.title, prisma);
    }

    res.json(decision);
  } catch (err) { next(err); }
});

export const decisionsRouter: IRouter = router;
