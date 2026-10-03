import { Router } from 'express';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { buildMemoryGraph } from '../services/memory-graph.service';

const router = Router();

/**
 * GET /api/memory-graph
 * Get graph visualization data
 */
router.get('/', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const limit = Math.min(200, parseInt(req.query.limit as string) || 100);
    const days = Math.min(365, parseInt(req.query.days as string) || 90);
    const includeContradictions = req.query.contradictions !== 'false';
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const graph = await buildMemoryGraph(userId, prisma, {
      limit,
      since,
      includeContradictions,
    });

    res.json({
      success: true,
      data: graph,
    });
  } catch (error) {
    logger.error('Memory graph generation failed', {
      userId: userId.substring(0, 10),
      error: error instanceof Error ? error.message : 'Unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * GET /api/memory-graph/contradictions
 * Get only contradiction edges for quick view
 */
router.get('/contradictions', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const graph = await buildMemoryGraph(userId, prisma, {
      limit: 100,
      includeContradictions: true,
      minSimilarity: 0.7,
    });

    // Filter to only contradiction edges
    const contradictionEdges = graph.edges.filter(e => e.type === 'contradicts');
    const contradictionNodeIds = new Set(
      contradictionEdges.flatMap(e => [e.source, e.target])
    );

    const contradictionNodes = graph.nodes.filter(n =>
      n.type === 'memory' && (contradictionNodeIds.has(n.id) || n.metadata.hasContradictions)
    );

    res.json({
      success: true,
      data: {
        contradictions: contradictionEdges.length,
        affectedMemories: contradictionNodes.length,
        nodes: contradictionNodes,
        edges: contradictionEdges,
      },
    });
  } catch (error) {
    logger.error('Contradiction graph failed', {
      userId: userId.substring(0, 10),
      error: error instanceof Error ? error.message : 'Unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

const memoryGraphRouter: import('express').Router = router;
export { memoryGraphRouter };
