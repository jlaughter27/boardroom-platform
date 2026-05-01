import { Router } from 'express';
import type { Router as IRouter } from 'express';
import { getQueueStats, getEmbeddingHealth } from '../services/embedding-queue';
import { backfillEmbeddings } from '../services/embedding.service';
import { prisma } from '../lib/db';

const router: IRouter = Router();

// GET /embedding/queue-stats — admin monitoring
router.get('/queue-stats', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { 
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); 
      return; 
    }

    // TODO: Add admin authorization check
    const stats = await getQueueStats();
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /embedding/health — system health check
router.get('/health', async (req, res, next) => {
  try {
    const health = await getEmbeddingHealth();
    res.json(health);
  } catch (err) { next(err); }
});

// POST /embedding/backfill — admin endpoint for manual backfill
router.post('/backfill', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { 
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); 
      return; 
    }

    const limit = req.body.limit ? parseInt(req.body.limit as string, 10) : 100;
    const result = await backfillEmbeddings(userId, limit);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /embedding/metrics — Prometheus metrics endpoint
router.get('/metrics', async (req, res, next) => {
  try {
    const stats = await getQueueStats();
    const health = await getEmbeddingHealth();

    // Format as Prometheus metrics
    const metrics = [
      '# HELP embedding_queue_total Total jobs in embedding queue',
      '# TYPE embedding_queue_total gauge',
      `embedding_queue_total ${stats.total}`,
      '',
      '# HELP embedding_queue_pending Pending jobs in embedding queue',
      '# TYPE embedding_queue_pending gauge',
      `embedding_queue_pending ${stats.pending}`,
      '',
      '# HELP embedding_queue_processing Processing jobs in embedding queue',
      '# TYPE embedding_queue_processing gauge',
      `embedding_queue_processing ${stats.processing}`,
      '',
      '# HELP embedding_queue_failed Failed jobs in embedding queue',
      '# TYPE embedding_queue_failed gauge',
      `embedding_queue_failed ${stats.failed}`,
      '',
      '# HELP embedding_queue_oldest_job_age_ms Age of oldest job in milliseconds',
      '# TYPE embedding_queue_oldest_job_age_ms gauge',
      `embedding_queue_oldest_job_age_ms ${stats.oldestJobAgeMs}`,
      '',
      '# HELP embedding_worker_running Whether embedding worker is running',
      '# TYPE embedding_worker_running gauge',
      `embedding_worker_running ${health.workerRunning ? 1 : 0}`,
    ].join('\n');

    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics);
  } catch (err) { next(err); }
});

// GET /embedding/semantic-search-guard — check if semantic search is available
router.get('/semantic-search-guard', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) { 
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] }); 
      return; 
    }

    // Check if user has any embeddings using raw SQL (embedding field is Unsupported type)
    const countResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM "memory_entries"
      WHERE user_id = ${userId} 
        AND deleted_at IS NULL 
        AND status != 'ARCHIVED'
        AND embedding IS NOT NULL
    `;
    const count = Number(countResult[0]?.count || 0);
    
    const hasEmbeddings = count > 0;
    const percentage = await prisma.$queryRaw<Array<{ percentage: number }>>`
      SELECT 
        COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) * 100.0 / COUNT(*) as percentage
      FROM "memory_entries"
      WHERE user_id = ${userId} 
        AND deleted_at IS NULL 
        AND status != 'ARCHIVED'
    `;

    const embeddingPercentage = percentage[0]?.percentage || 0;

    res.json({
      semanticSearchAvailable: hasEmbeddings,
      totalMemories: count,
      embeddingPercentage,
      recommendation: embeddingPercentage < 30 
        ? 'Consider running backfill to improve semantic search quality' 
        : 'Semantic search ready',
    });
  } catch (err) { next(err); }
});

export const embeddingMonitoringRouter: IRouter = router;