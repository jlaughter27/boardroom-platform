import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { prisma } from '../lib/db';

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
    timestamp: new Date().toISOString(),
    dbConnected,
  });
});

export const healthRouter: IRouter = router;
