import { Router } from 'express';
import type { IRouter } from 'express';
import { omnimindClient } from '../services/omnimind-client';

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
    timestamp: new Date().toISOString(),
    omnimindConnected,
  });
});

export const healthRouter: IRouter = router;
