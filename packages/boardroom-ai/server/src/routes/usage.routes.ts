// Phase 6 — LLM cost summary (admin-only; app.ts mounts this behind requireAdmin).
import { Router } from 'express';
import type { IRouter } from 'express';
import { omnimindClient } from '../services/omnimind-client';

const router: IRouter = Router();

// GET /usage/llm/summary?days=7
router.get('/llm/summary', async (req, res, next) => {
  try {
    const params: Record<string, string> = {};
    const days = Number(req.query.days);
    if (Number.isFinite(days) && days > 0) params.days = String(Math.min(365, Math.floor(days)));
    const data = await omnimindClient.getLlmUsageSummary(params);
    res.json(data);
  } catch (err) { next(err); }
});

export const usageRouter: IRouter = router;
