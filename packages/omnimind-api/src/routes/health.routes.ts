import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { prisma } from '../lib/db';

// M0-A2 — liveness vs readiness.
//
// GET /health is LIVENESS: it always answers HTTP 200 (railway.toml
// healthcheckPath="/health" gates every deploy on it, so a 503 here would couple
// deploys to database blips). It reports `dbConnected` and the deployed commit
// as `version` so a deploy can be identified by SHA.
//
// GET /ready is READINESS: 503 when the database check fails. It is what uptime
// checks and post-deploy verification probe. Both are public (no x-api-key):
// /health is exempted inside the middlewares, /ready is mounted ahead of them in
// index.ts.

/** How long the readiness DB probe may take before it counts as failed. */
export const READY_DB_TIMEOUT_MS = 3000;

/** The deployed git commit (Railway injects RAILWAY_GIT_COMMIT_SHA); 'dev' locally. */
export function serviceVersion(env: NodeJS.ProcessEnv = process.env): string {
  return env.RAILWAY_GIT_COMMIT_SHA?.trim() || 'dev';
}

async function checkDb(timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('db check timed out')), timeoutMs);
    });
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const router: IRouter = Router();

router.get('/', async (_req, res) => {
  let dbConnected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch {
    // DB not connected
  }

  res.json({
    status: dbConnected ? 'ok' : 'degraded',
    service: 'omnimind-api',
    version: serviceVersion(),
    timestamp: new Date().toISOString(),
    dbConnected,
  });
});

export const healthRouter: IRouter = router;

const ready: IRouter = Router();

ready.get('/', async (_req, res) => {
  const dbOk = await checkDb(READY_DB_TIMEOUT_MS);
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ready' : 'not_ready',
    service: 'omnimind-api',
    version: serviceVersion(),
    timestamp: new Date().toISOString(),
    checks: { db: dbOk ? 'ok' : 'fail' },
  });
});

export const readyRouter: IRouter = ready;
