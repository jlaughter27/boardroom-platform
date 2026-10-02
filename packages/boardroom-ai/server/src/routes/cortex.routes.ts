// Proxy routes for OmniMind Cortex intelligence layer
// BoardRoom client calls these; they forward to OmniMind with x-user-id

import { Router } from 'express';
import type { IRouter } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { llmRateLimiter } from '../middleware/llm-rate-limiter';
import { omnimindClient } from '../services/omnimind-client';

const router: IRouter = Router();

// B-113 — BoardRoom's simulate call sends { chosenPath, sessionQuestion }
// (OmniMind fills in simulationType). Shared SimulationRequestSchema is the
// OmniMind-side full shape, so a small local schema is used here.
const SimulateBodySchema = z.object({
  chosenPath: z.string().min(1).max(5000),
  sessionQuestion: z.string().min(1).max(5000),
  sessionId: z.string().max(200).optional(),
  simulationType: z.enum(['resource', 'timeline', 'stakeholder', 'full']).optional(),
});

const UpdateContradictionBodySchema = z.object({
  status: z.string().min(1).max(50).optional(),
  resolution: z.string().max(5000).optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
  dismissed: z.boolean().optional(),
}).passthrough();

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

router.post('/patterns/scan', llmRateLimiter, async (req: AuthRequest, res, next) => {
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

router.post('/memo/generate', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.triggerMemoGeneration(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Contradictions
// ---------------------------------------------------------------------------

router.get('/contradictions', async (req: AuthRequest, res, next) => {
  try {
    const qs = new URL(req.url, 'http://localhost').search.slice(1);
    const filters = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
    const data = await omnimindClient.getContradictions(req.auth!.userId, filters);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/contradictions/scan', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.scanContradictions(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

router.patch('/contradictions/:id', validateBody(UpdateContradictionBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.updateContradiction(req.auth!.userId, req.params.id, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

router.post('/simulate', llmRateLimiter, validateBody(SimulateBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.runSimulation(req.auth!.userId, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

export const cortexRouter: IRouter = router;
