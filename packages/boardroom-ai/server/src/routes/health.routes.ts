import { Router } from 'express';
import type { IRouter } from 'express';
import { omnimindClient } from '../services/omnimind-client';

// M0-A2 — liveness vs readiness.
//
// GET /health is LIVENESS: always HTTP 200 (railway.toml healthcheckPath="/health"
// gates every deploy, so OmniMind being down must not fail a BoardRoom deploy).
// It reports `omnimindConnected` and the deployed commit as `version`.
//
// GET /ready is READINESS: 503 when OmniMind is unreachable (or answers but
// reports itself degraded — BoardRoom cannot serve any data then). Both are
// registered in app.ts step 3, above the SPA fallback and the auth wall.

/** Upper bound on the readiness probe (the client may retry GETs with backoff). */
export const READY_TIMEOUT_MS = 5000;

/** The deployed git commit (Railway injects RAILWAY_GIT_COMMIT_SHA); 'dev' locally. */
export function serviceVersion(env: NodeJS.ProcessEnv = process.env): string {
  return env.RAILWAY_GIT_COMMIT_SHA?.trim() || 'dev';
}

const router: IRouter = Router();

router.get('/', async (_req, res) => {
  let omnimindConnected = false;
  try {
    const health = await omnimindClient.health();
    omnimindConnected = health.status === 'ok';
  } catch { /* OmniMind unreachable */ }

  res.json({
    status: omnimindConnected ? 'ok' : 'degraded',
    service: 'boardroom-ai',
    version: serviceVersion(),
    timestamp: new Date().toISOString(),
    omnimindConnected,
  });
});

export const healthRouter: IRouter = router;

type OmniMindCheck = 'ok' | 'degraded' | 'unreachable';

async function checkOmniMind(timeoutMs: number): Promise<OmniMindCheck> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('omnimind readiness check timed out')), timeoutMs);
    });
    const health = await Promise.race([omnimindClient.health(), timeout]);
    return health?.status === 'ok' ? 'ok' : 'degraded';
  } catch {
    return 'unreachable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ready: IRouter = Router();

ready.get('/', async (_req, res) => {
  const omnimind = await checkOmniMind(READY_TIMEOUT_MS);
  const ok = omnimind === 'ok';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ready' : 'not_ready',
    service: 'boardroom-ai',
    version: serviceVersion(),
    timestamp: new Date().toISOString(),
    checks: { omnimind },
  });
});

export const readyRouter: IRouter = ready;
