// Phase 6 — LLM cost summary (admin-only; app.ts mounts this behind requireAdmin).
import { Router } from 'express';
import type { IRouter } from 'express';
import { omnimindClient } from '../services/omnimind-client';

const router: IRouter = Router();

// GET /usage/llm/summary?days=7
//
// S-2: this is the ADMIN proxy — it always asks OmniMind for the cross-user
// summary (`all=1`), which OmniMind now guards with `x-admin-key`. The key is
// BoardRoom's `OMNIMIND_ADMIN_KEY`; when it is not configured the widget gets a
// clear 503 instead of an opaque upstream 401/403.
router.get('/llm/summary', async (req, res, next) => {
  try {
    const adminKey = process.env.OMNIMIND_ADMIN_KEY;
    if (!adminKey) {
      res.status(503).json({
        error: 'admin_disabled',
        message: 'OMNIMIND_ADMIN_KEY is not configured on BoardRoom, so the cross-user LLM usage summary is unavailable.',
      });
      return;
    }

    const params: Record<string, string> = { all: '1' };
    const days = Number(req.query.days);
    if (Number.isFinite(days) && days > 0) params.days = String(Math.min(365, Math.floor(days)));
    const data = await omnimindClient.getLlmUsageSummary(params, { adminKey });
    res.json(data);
  } catch (err) { next(err); }
});

export const usageRouter: IRouter = router;
