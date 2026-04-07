import { Router } from 'express';
import type { IRouter } from 'express';
import { prisma } from '../lib/db';
import * as reviewService from '../services/outcome-review.service';

const router: IRouter = Router();

// GET /outcome-reviews — list
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({
        error: 'validation_failed',
        details: [{ field: 'x-user-id', message: 'Missing' }],
      });
      return;
    }
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await reviewService.listNudges(userId, status, limit, offset, prisma);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /outcome-reviews/pending
router.get('/pending', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({
        error: 'validation_failed',
        details: [{ field: 'x-user-id', message: 'Missing' }],
      });
      return;
    }
    const nudges = await reviewService.getPendingNudges(userId, prisma);
    res.json(nudges);
  } catch (err) {
    next(err);
  }
});

// POST /outcome-reviews/:id/complete
router.post('/:id/complete', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] });
      return;
    }
    const { outcome, outcomeRating, wouldDecideSame } = req.body;
    if (!outcome || outcomeRating === undefined) {
      res.status(422).json({
        error: 'validation_failed',
        details: [{ field: 'body', message: 'outcome and outcomeRating required' }],
      });
      return;
    }
    const nudge = await reviewService.completeReview(
      req.params.id,
      userId,
      outcome,
      outcomeRating,
      wouldDecideSame ?? true,
      prisma,
    );
    res.json(nudge);
  } catch (err: any) {
    if (err.status === 404) { res.status(404).json({ error: 'not_found', message: err.message }); return; }
    next(err);
  }
});

// POST /outcome-reviews/:id/skip
router.post('/:id/skip', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] });
      return;
    }
    const nudge = await reviewService.skipReview(req.params.id, userId, prisma);
    res.json(nudge);
  } catch (err: any) {
    if (err.status === 404) { res.status(404).json({ error: 'not_found', message: err.message }); return; }
    next(err);
  }
});

export const outcomeReviewRouter: IRouter = router;
