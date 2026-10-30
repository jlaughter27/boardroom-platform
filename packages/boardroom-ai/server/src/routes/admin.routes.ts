import { Router } from 'express';
import type { IRouter, Response } from 'express';
import { omnimindClient, type AdminCallOptions } from '../services/omnimind-client';

const router: IRouter = Router();

// M6 (2026-10-30) — OmniMind guards /admin/* with `x-admin-key`. BoardRoom
// forwards its own OMNIMIND_ADMIN_KEY (same pattern as usage.routes.ts); when it
// is not configured every panel call answers a clear 503 here instead of an
// opaque upstream 401 → 502. Read per request so env changes take effect.
// app.ts mounts this router behind `requireAdmin`, so non-admins still get 403 first.
router.use((_req, res, next) => {
  const adminKey = process.env.OMNIMIND_ADMIN_KEY;
  if (!adminKey) {
    res.status(503).json({
      error: 'admin_key_not_configured',
      message: 'OMNIMIND_ADMIN_KEY is not configured on BoardRoom, so the admin panel cannot reach OmniMind /admin/*.',
    });
    return;
  }
  res.locals.adminKey = adminKey;
  next();
});

function adminOpts(res: Response): AdminCallOptions {
  return { adminKey: res.locals.adminKey as string };
}

// B-101 — forward `includeAllTenants=true` to OmniMind ONLY when the client
// explicitly asked for it; otherwise OmniMind applies its default scoping.
function tenantScope(req: { query: Record<string, unknown> }): Record<string, string> {
  const v = req.query.includeAllTenants;
  return typeof v === 'string' && v.toLowerCase() === 'true' ? { includeAllTenants: 'true' } : {};
}

router.get('/stats', async (req, res, next) => {
  try {
    const data = await omnimindClient.getAdminStats(tenantScope(req as { query: Record<string, unknown> }), adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/agents', async (_req, res, next) => {
  try {
    const data = await omnimindClient.getAdminAgents(adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/audit', async (req, res, next) => {
  try {
    const params: Record<string, string> = tenantScope(req as { query: Record<string, unknown> });
    const { agentId, tenantId, toolName, limit, offset } = req.query as Record<string, string>;
    if (agentId) params.agentId = agentId;
    if (tenantId) params.tenantId = tenantId;
    if (toolName) params.toolName = toolName;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const data = await omnimindClient.getAdminAudit(params, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/memories', async (req, res, next) => {
  try {
    const params: Record<string, string> = tenantScope(req as { query: Record<string, unknown> });
    const { agentId, tenantId, domain, sourceType, q, limit, offset } = req.query as Record<string, string>;
    if (agentId) params.agentId = agentId;
    if (tenantId) params.tenantId = tenantId;
    if (domain) params.domain = domain;
    if (sourceType) params.sourceType = sourceType;
    if (q) params.q = q;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const data = await omnimindClient.getAdminMemories(params, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/contradictions', async (req, res, next) => {
  try {
    const params: Record<string, string> = tenantScope(req as { query: Record<string, unknown> });
    const { limit, offset } = req.query as Record<string, string>;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const data = await omnimindClient.getAdminContradictions(params, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/summarize', async (_req, res, next) => {
  try {
    const data = await omnimindClient.triggerAdminSummarize(adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/duplicates', async (req, res, next) => {
  try {
    const { threshold } = req.query as Record<string, string>;
    const params: Record<string, string> = tenantScope(req as { query: Record<string, unknown> });
    if (threshold) params.threshold = threshold;
    const data = await omnimindClient.getAdminDuplicates(params, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/duplicates/merge', async (req, res, next) => {
  try {
    const data = await omnimindClient.mergeAdminDuplicates(req.body, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/decay/run', async (_req, res, next) => {
  try {
    const data = await omnimindClient.triggerAdminDecay(adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

export const adminRouter: IRouter = router;
