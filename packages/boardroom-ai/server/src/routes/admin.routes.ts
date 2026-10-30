import { Router } from 'express';
import type { IRouter, Response } from 'express';
import { omnimindClient, type AdminCallOptions } from '../services/omnimind-client';
import type { AuthRequest } from '../middleware/auth';

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

// Lane F (2026-10-30) — the admin panel is an operator view across every
// tenant. BoardRoom calls OmniMind without agent context, and OmniMind's
// /admin/* refuses that with 400 `tenant_scope_required` unless the caller opts
// in to `includeAllTenants=true` (F-104; the contract's "cross-tenant views
// require x-admin-key + ?includeAllTenants=true"). The opt-in is added here,
// server-side, on every tenant-scoped admin call: the browser never knows
// about tenancy and cannot narrow (or widen) it. Ministry content is excluded
// by OmniMind on the cross-user lists (/admin/memories, /admin/duplicates).
const ALL_TENANTS: Readonly<Record<string, string>> = { includeAllTenants: 'true' };

/** Copy the named string query params (non-empty) into `params`. */
function pick(req: { query: Record<string, unknown> }, keys: readonly string[], params: Record<string, string>): Record<string, string> {
  for (const k of keys) {
    const v = req.query[k];
    if (typeof v === 'string' && v !== '') params[k] = v;
  }
  return params;
}

/** The signed-in admin (requireAdmin runs before this router). */
function callerUserId(req: unknown): string | undefined {
  return (req as AuthRequest).auth?.userId;
}

router.get('/stats', async (req, res, next) => {
  try {
    const data = await omnimindClient.getAdminStats({ ...ALL_TENANTS }, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/agents', async (_req, res, next) => {
  try {
    const data = await omnimindClient.getAdminAgents({ ...ALL_TENANTS }, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/audit', async (req, res, next) => {
  try {
    const params = pick(req, ['agentId', 'tenantId', 'toolName', 'limit', 'offset'], { ...ALL_TENANTS });
    const data = await omnimindClient.getAdminAudit(params, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/memories', async (req, res, next) => {
  try {
    const params = pick(req, ['agentId', 'tenantId', 'domain', 'sourceType', 'q', 'limit', 'offset'], { ...ALL_TENANTS });
    const data = await omnimindClient.getAdminMemories(params, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/contradictions', async (req, res, next) => {
  try {
    // ContradictionAlert is keyed by user (F-210): OmniMind answers 400
    // `user_scope_required` without one. Scope to the signed-in admin; a
    // browser-supplied ?userId= is ignored.
    const userId = callerUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
      return;
    }
    const params = pick(req, ['limit', 'offset'], { userId });
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
    const params = pick(req, ['threshold'], { ...ALL_TENANTS });
    const data = await omnimindClient.getAdminDuplicates(params, adminOpts(res));
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/duplicates/merge', async (req, res, next) => {
  try {
    // The duplicates list spans all tenants, so the merge must too (else 400
    // `tenant_scope_required`); it is attributed to the signed-in admin, never
    // to a browser-supplied userId (OmniMind only archives that user's row).
    const userId = callerUserId(req);
    const body = { ...(req.body as Record<string, unknown>), ...(userId && { userId }) };
    const data = await omnimindClient.mergeAdminDuplicates(body, { ...ALL_TENANTS }, adminOpts(res));
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
