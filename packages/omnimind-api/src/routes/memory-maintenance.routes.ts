import { Router } from 'express';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { findDuplicateGroups, checkDuplicate, mergeDuplicates } from '../services/semantic-dedup.service';
import { runMemoryCleanup } from '../jobs/memory-cleanup.job';
import { batchContradictionCheck } from '../services/semantic-contradiction.service';

const router = Router();

/**
 * GET /api/memory-maintenance/duplicates
 * Find duplicate memory groups
 */
router.get('/duplicates', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const days = Math.min(90, parseInt(req.query.days as string) || 30);
    const minSimilarity = Math.min(0.99, parseFloat(req.query.minSimilarity as string) || 0.85);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const groups = await findDuplicateGroups(userId, prisma, { since, minSimilarity });

    res.json({
      success: true,
      data: {
        groups,
        totalDuplicates: groups.reduce((sum, g) => sum + g.duplicates.length, 0),
        scannedDays: days,
        minSimilarity,
      },
    });
  } catch (error) {
    logger.error('Duplicate check failed', {
      userId: userId.substring(0, 10),
      error: error instanceof Error ? error.message : 'Unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * POST /api/memory-maintenance/duplicates/merge
 * Merge duplicate memories
 */
router.post('/duplicates/merge', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const { canonicalId, duplicateIds } = req.body;
  if (!canonicalId || !Array.isArray(duplicateIds) || duplicateIds.length === 0) {
    res.status(400).json({ error: 'invalid_request', message: 'canonicalId and duplicateIds required' });
    return;
  }

  try {
    const result = await mergeDuplicates(userId, canonicalId, duplicateIds, prisma);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Duplicate merge failed', {
      userId: userId.substring(0, 10),
      canonicalId,
      error: error instanceof Error ? error.message : 'Unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * POST /api/memory-maintenance/check-duplicate
 * Check if content would be a duplicate before creating
 */
router.post('/check-duplicate', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const { title, content } = req.body;
  if (!title || !content) {
    res.status(400).json({ error: 'invalid_request', message: 'title and content required' });
    return;
  }

  try {
    const result = await checkDuplicate(userId, title, content, prisma);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Duplicate check failed', {
      userId: userId.substring(0, 10),
      error: error instanceof Error ? error.message : 'Unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * POST /api/memory-maintenance/cleanup
 * Run manual memory cleanup
 */
router.post('/cleanup', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const result = await runMemoryCleanup(userId, prisma);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Manual cleanup failed', {
      userId: userId.substring(0, 10),
      error: error instanceof Error ? error.message : 'Unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * POST /api/memory-maintenance/contradictions/check
 * Run contradiction detection for recent memories
 */
router.post('/contradictions/check', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const limit = Math.min(200, parseInt(req.query.limit as string) || 100);
    const result = await batchContradictionCheck(userId, prisma, limit);
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('Contradiction check failed', {
      userId: userId.substring(0, 10),
      error: error instanceof Error ? error.message : 'Unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * GET /api/memory-maintenance/status
 * Get maintenance status overview
 */
router.get('/status', async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const [total, archived, active, withEmbeddingResult] = await Promise.all([
      prisma.memoryEntry.count({ where: { userId } }),
      prisma.memoryEntry.count({ where: { userId, status: 'ARCHIVED' } }),
      prisma.memoryEntry.count({ where: { userId, status: 'CONFIRMED', deletedAt: null } }),
      prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int as count
        FROM memory_entries
        WHERE "userId" = ${userId}
          AND embedding IS NOT NULL
          AND "deletedAt" IS NULL
      `,
    ]);
    const withEmbedding = withEmbeddingResult[0]?.count ?? 0;

    res.json({
      success: true,
      data: {
        totalMemories: total,
        active,
        archived,
        withEmbedding,
        maintenanceReady: withEmbedding > 0,
        lastCleanup: null, // Would track this in a settings table
      },
    });
  } catch (error) {
    logger.error('Maintenance status failed', {
      userId: userId.substring(0, 10),
      error: error instanceof Error ? error.message : 'Unknown',
    });
    res.status(500).json({ error: 'internal_error' });
  }
});

const memoryMaintenanceRouter: import('express').Router = router;
export { memoryMaintenanceRouter };
