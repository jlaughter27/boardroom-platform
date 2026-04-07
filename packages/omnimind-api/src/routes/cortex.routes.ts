import { Router } from 'express';
import type { IRouter } from 'express';
import { CORTEX_CONFIG } from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as memoService from '../services/cortex-memo.service';
import * as patternService from '../services/cortex-patterns.service';
import * as contradictionService from '../services/cortex-contradictions.service';
import * as simulationService from '../services/simulation.service';

const router: IRouter = Router();

// Patterns
router.get('/patterns', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await patternService.getPatterns(userId, limit, offset, prisma);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/patterns/scan', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const patterns = await patternService.detectPatterns(userId, prisma);
    res.json({ patterns, newCount: patterns.length });
  } catch (err) { next(err); }
});

// Memos
router.get('/memo/latest', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const memo = await memoService.getLatestMemo(userId, prisma);
    res.json(memo);
  } catch (err) { next(err); }
});

router.get('/memo/history', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await memoService.getMemoHistory(userId, limit, offset, prisma);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/memo/generate', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const memo = await memoService.generateWeeklyMemo(userId, prisma);
    if (!memo) { res.json({ message: 'Not enough data for memo generation', minRequired: CORTEX_CONFIG.minSessionsForMemo }); return; }
    res.json(memo);
  } catch (err) { next(err); }
});

// Contradictions
router.get('/contradictions', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;
    const result = await contradictionService.getContradictions(userId, status, limit, offset, prisma);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/contradictions/scan', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const contradictions = await contradictionService.scanContradictions(userId, prisma);
    res.json({ contradictions, newCount: contradictions.length });
  } catch (err) { next(err); }
});

router.patch('/contradictions/:id', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const { status, resolution } = req.body as { status: string; resolution?: string };
    if (!status) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'status', message: 'Required' }] }); return; }
    const updated = await contradictionService.updateContradiction(req.params.id, status, resolution, prisma);
    res.json(updated);
  } catch (err) { next(err); }
});

// Simulation
router.post('/simulate', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing' }] }); return; }
    const { chosenPath, sessionQuestion } = req.body;
    if (!chosenPath || !sessionQuestion) {
      res.status(422).json({ error: 'validation_failed', details: [{ field: 'body', message: 'chosenPath and sessionQuestion required' }] });
      return;
    }
    const result = await simulationService.runSimulation(userId, chosenPath, sessionQuestion, prisma);
    res.json(result);
  } catch (err) { next(err); }
});

export const cortexRouter = router;
