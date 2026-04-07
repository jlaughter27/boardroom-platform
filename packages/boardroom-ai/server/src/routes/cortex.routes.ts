// Proxy routes for OmniMind Cortex intelligence layer
// BoardRoom client calls these; they forward to OmniMind with x-user-id

import { Router } from 'express';
import type { IRouter } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { omnimindClient } from '../services/omnimind-client';

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

router.get('/patterns', async (req: AuthRequest, res, next) => {
  try {
    const qs = new URL(req.url, 'http://localhost').search.slice(1);
    const filters = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
    const data = await omnimindClient.getPatterns(req.auth!.userId, filters);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/patterns/scan', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.triggerPatternScan(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Memos
// ---------------------------------------------------------------------------

router.get('/memo/latest', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.getLatestMemo(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/memo/history', async (req: AuthRequest, res, next) => {
  try {
    const qs = new URL(req.url, 'http://localhost').search.slice(1);
    const filters = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
    const data = await omnimindClient.getMemoHistory(req.auth!.userId, filters);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/memo/generate', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.triggerMemoGeneration(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

export const cortexRouter: IRouter = router;
