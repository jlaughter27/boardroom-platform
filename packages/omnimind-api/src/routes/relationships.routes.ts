import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { prisma } from '../lib/db';
import { getRelationshipGraph } from '../services/relationship.service';

const router: IRouter = Router();

// GET /relationships/graph — returns { nodes, edges }
router.get('/graph', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] });
      return;
    }

    const graph = await getRelationshipGraph(userId, prisma);
    res.json(graph);
  } catch (err) { next(err); }
});

export const relationshipsRouter: IRouter = router;
