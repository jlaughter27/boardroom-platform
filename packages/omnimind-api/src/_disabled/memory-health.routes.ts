import { Router } from 'express';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { calculateMemoryHealth, getMemoryTrends } from '../services/memory-health.service';

const router = Router();

/**
 * GET /api/memory-health
 * Get comprehensive memory health metrics for the authenticated user
 */
router.get('/', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;

  if (!userId) {
    res.status(401).json({ error: 'unauthorized', message: 'User ID required' });
    return;
  }

  try {
    const health = await calculateMemoryHealth(userId, prisma);
    res.json({
      success: true,
      data: health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to calculate memory health', {
      userId: userId.substring(0, 10),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to calculate memory health',
    });
  }
});

/**
 * GET /api/memory-health/trends
 * Get memory creation trends over time
 */
router.get('/trends', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  const days = Math.min(90, parseInt(req.query.days as string) || 30);

  if (!userId) {
    res.status(401).json({ error: 'unauthorized', message: 'User ID required' });
    return;
  }

  try {
    const trends = await getMemoryTrends(userId, days, prisma);
    res.json({
      success: true,
      data: {
        period: `${days} days`,
        trends,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get memory trends', {
      userId: userId.substring(0, 10),
      days,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to get memory trends',
    });
  }
});

/**
 * GET /api/memory-health/quick
 * Quick health check endpoint for dashboards
 */
router.get('/quick', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;

  if (!userId) {
    res.status(401).json({ error: 'unauthorized', message: 'User ID required' });
    return;
  }

  try {
    const [total, active, last7Days, confidenceResult] = await Promise.all([
      prisma.memoryEntry.count({ where: { userId } }),
      prisma.memoryEntry.count({ where: { userId, status: 'CONFIRMED', deletedAt: null } }),
      prisma.memoryEntry.count({
        where: {
          userId,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.memoryEntry.groupBy({
        where: { userId, deletedAt: null },
        by: ['confidence'],
        _count: { id: true },
      }),
    ]);

    // Quick health score calculation (simplified)
    let score = 100;
    const lowConfidenceRatio = await prisma.memoryEntry.count({
      where: { userId, deletedAt: null, confidence: { in: ['LOW', 'SPECULATIVE'] } },
    }) / (total || 1);

    score -= Math.min(30, Math.round(lowConfidenceRatio * 100));
    if (last7Days === 0) score -= 10;
    if (total === 0) score = 0;

    res.json({
      success: true,
      data: {
        healthScore: Math.max(0, score),
        totalMemories: total,
        activeMemories: active,
        memoriesLast7Days: last7Days,
        avgConfidence: Math.round(
          ((confidenceResult.find((g: { confidence: string; _count: { id: number } }) => g.confidence === 'HIGH')?._count.id ?? 0) * 1.0 +
            (confidenceResult.find((g: { confidence: string; _count: { id: number } }) => g.confidence === 'MEDIUM')?._count.id ?? 0) * 0.67 +
            (confidenceResult.find((g: { confidence: string; _count: { id: number } }) => g.confidence === 'LOW')?._count.id ?? 0) * 0.33 +
            (confidenceResult.find((g: { confidence: string; _count: { id: number } }) => g.confidence === 'SPECULATIVE')?._count.id ?? 0) * 0.1) /
            Math.max(confidenceResult.reduce((sum: number, g: { _count: { id: number } }) => sum + g._count.id, 0), 1) *
            100
        ) / 100,
      },
    });
  } catch (error) {
    logger.error('Quick health check failed', {
      userId: userId.substring(0, 10),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'internal_error',
      message: 'Health check failed',
    });
  }
});

const memoryHealthRouter: import('express').Router = router;
export { memoryHealthRouter };
