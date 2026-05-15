/**
 * F-215 (Bug Audit 2026-05-15): MOVED HERE FROM src/jobs/memory-cleanup-scheduler.ts.
 *
 * This scheduler depends on `lib/redlock` (Redis-backed distributed locking).
 * Per ADR-009 the project deliberately avoids Redis — node-cron + a single
 * Railway instance is the supported topology. The scheduler was already
 * excluded from the TypeScript build (tsconfig.json line 32) and not imported
 * by `index.ts`, so it was effectively dead code.
 *
 * Disabled until ADR-009 is revisited (trigger: 500+ users or jobs > 30s).
 *
 * The associated `memory-cleanup.job.ts` is already isolated under
 * `routes/_disabled/memory-maintenance.routes.ts` — this file aligns with that.
 *
 * The original `src/jobs/memory-cleanup-scheduler.ts` is preserved as an empty
 * stub (delete is not available in the current build environment).
 */

import { scheduleCleanupForAllUsers } from '../../jobs/memory-cleanup.job';
import { prisma } from '../../lib/db';
import { logger } from '../../lib/logger';
import { withDistributedLock, getLockStatus } from '../../lib/redlock';

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Get cleanup configuration from environment variables
 * Called dynamically to support testing
 */
function getCleanupConfig() {
  return {
    intervalMs: parseInt(process.env.MEMORY_CLEANUP_INTERVAL_MS || '86400000'), // 24 hours
    archiveThresholdDays: parseInt(process.env.MEMORY_ARCHIVE_THRESHOLD_DAYS || '90'),
    batchSize: parseInt(process.env.MEMORY_CLEANUP_BATCH_SIZE || '50'),
  };
}

/**
 * Validate cleanup configuration
 */
function validateCleanupConfig(): void {
  const config = getCleanupConfig();

  if (config.intervalMs < 3600000) { // Minimum 1 hour
    throw new Error('Cleanup interval must be at least 1 hour (3600000ms)');
  }
  if (config.archiveThresholdDays < 30) {
    throw new Error('Archive threshold must be at least 30 days');
  }
  if (config.batchSize > 500) {
    throw new Error('Batch size must not exceed 500');
  }

  logger.info('Memory cleanup config validated', config);
}

/**
 * Start the memory cleanup scheduler
 * Runs cleanup for all active users daily
 */
export function startMemoryCleanupScheduler(): void {
  if (cleanupInterval) {
    logger.warn('Memory cleanup scheduler already running');
    return;
  }

  // Validate configuration before starting
  validateCleanupConfig();

  const config = getCleanupConfig();

  logger.info('Starting memory cleanup scheduler', {
    intervalHours: config.intervalMs / (60 * 60 * 1000),
  });

  // Run immediately on start
  void runScheduledCleanup();

  // Schedule periodic runs
  cleanupInterval = setInterval(() => {
    void runScheduledCleanup();
  }, getCleanupConfig().intervalMs);
}

/**
 * Stop the memory cleanup scheduler
 */
export function stopMemoryCleanupScheduler(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('Memory cleanup scheduler stopped');
  }
}

/**
 * Execute scheduled cleanup with distributed locking
 * Ensures only one instance runs cleanup across the cluster
 */
async function runScheduledCleanup(): Promise<void> {
  const startTime = Date.now();
  const lockKey = 'memory-cleanup';

  // Try to acquire distributed lock (10 minute TTL, auto-extend)
  const result = await withDistributedLock(
    {
      lockKey,
      ttlMs: 10 * 60 * 1000, // 10 minutes
      retryAttempts: 3,
      extendIntervalMs: 2 * 60 * 1000, // Extend every 2 minutes
    },
    async () => {
      logger.info('Starting scheduled memory cleanup (lock acquired)');

      const cleanupResult = await scheduleCleanupForAllUsers(prisma, (userId, userResult) => {
      // Log progress for each user
      if (userResult.archived > 0 || userResult.deleted > 0) {
        logger.info('User cleanup complete', {
          userId: userId.substring(0, 10),
          archived: userResult.archived,
          deleted: userResult.deleted,
          errors: userResult.errors.length,
        });
      }
    });

      const duration = Date.now() - startTime;

      logger.info('Scheduled cleanup complete', {
        durationMs: duration,
        usersProcessed: cleanupResult.usersProcessed,
        totalArchived: cleanupResult.totalArchived,
        totalDeleted: cleanupResult.totalDeleted,
      });

      return cleanupResult;
    }
  );

  if (result === null) {
    // Lock not acquired, another instance is running
    logger.info('Memory cleanup skipped - another instance has the lock', {
      lockKey,
    });
    return;
  }
}

/**
 * Get lock status for monitoring
 */
export async function getMemoryCleanupLockStatus(): Promise<{
  isLocked: boolean;
  owner?: string;
  expiresAt?: Date;
}> {
  const status = await getLockStatus('memory-cleanup');
  return {
    isLocked: status.isLocked,
    owner: status.owner,
    expiresAt: status.expiresAt,
  };
}

/**
 * Get scheduler status
 */
export function getCleanupSchedulerStatus(): {
  running: boolean;
  intervalHours: number;
  nextRun?: Date;
} {
  return {
    running: cleanupInterval !== null,
    intervalHours: getCleanupConfig().intervalMs / (60 * 60 * 1000),
    nextRun: cleanupInterval
      ? new Date(Date.now() + getCleanupConfig().intervalMs)
      : undefined,
  };
}
