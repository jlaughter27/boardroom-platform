import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { KnowledgeGraphQuerySchema } from '@boardroom/shared';
import { prisma } from '../lib/db';
import { getKnowledgeGraph } from '../services/knowledge-graph.service';

const router: IRouter = Router();

/**
 * GET /graph — knowledge-graph projection for the Obsidian-style graph view.
 *
 * Query: types=goal,project,… · domain=business · memoryLimit=150 · includeArchived=false
 * Response: KnowledgeGraph (nodes, edges, stats, generatedAt) — see shared/types/graph.types.ts
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] });
      return;
    }

    const parsed = KnowledgeGraphQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(422).json({
        error: 'validation_failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const graph = await getKnowledgeGraph(
      userId,
      { ...parsed.data, tenantId: req.agentContext?.tenantId },
      prisma,
    );
    res.json(graph);
  } catch (err) { next(err); }
});

export const knowledgeGraphRouter = router;
