import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

// Cleanup thresholds
const CLEANUP_CONFIG = {
  staleDays: 90,              // Memories unaccessed for 90 days
  lowConfidenceThreshold: 0.4, // Below 40% confidence
  maxArchivesPerRun: 50,      // Limit processing per batch
  orphanCheckInterval: 7,     // Check for orphans every 7 days
};

export interface CleanupResult {
  archived: number;
  deleted: number;
  errors: string[];
  checked: number;
}

/**
 * Archive stale memories
 * Memories not accessed in X days with low importance
 */
async function archiveStaleMemories(
  userId: string,
  prisma: PrismaClient
): Promise<{ archived: number; errors: string[] }> {
  const errors: string[] = [];
  const staleDate = new Date(Date.now() - CLEANUP_CONFIG.staleDays * 24 * 60 * 60 * 1000);

  const staleMemories = await prisma.memoryEntry.findMany({
    where: {
      userId,
      deletedAt: null,
      status: 'CONFIRMED',
      updatedAt: { lt: staleDate },
      importance: { lt: 0.6 },
      memoryClass: { not: 'SEMANTIC' }, // Don't auto-archive semantic memories
    },
    take: CLEANUP_CONFIG.maxArchivesPerRun,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      importance: true,
    },
  });

  let archived = 0;
  for (const memory of staleMemories) {
    try {
      await prisma.memoryEntry.update({
        where: { id: memory.id },
        data: {
          status: 'ARCHIVED',
          metadata: {
            archiveReason: 'stale_auto_cleanup',
            daysSinceUpdate: Math.floor(
              (Date.now() - memory.updatedAt.getTime()) / (24 * 60 * 60 * 1000)
            ),
          },
        },
      });
      archived++;
    } catch (err) {
      errors.push(`Failed to archive ${memory.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return { archived, errors };
}

/**
 * Archive very low confidence memories
 */
async function archiveLowConfidence(
  userId: string,
  prisma: PrismaClient
): Promise<{ archived: number; errors: string[] }> {
  const errors: string[] = [];

  const lowConfidence = await prisma.memoryEntry.findMany({
    where: {
      userId,
      deletedAt: null,
      status: 'CONFIRMED',
      confidence: { in: ['LOW', 'SPECULATIVE'] },
      createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // At least 30 days old
    },
    take: CLEANUP_CONFIG.maxArchivesPerRun,
    select: { id: true, title: true, confidence: true },
  });

  let archived = 0;
  for (const memory of lowConfidence) {
    try {
      await prisma.memoryEntry.update({
        where: { id: memory.id },
        data: {
          status: 'ARCHIVED',
          metadata: {
            archiveReason: 'low_confidence_cleanup',
            confidence: memory.confidence,
          },
        },
      });
      archived++;
    } catch (err) {
      errors.push(`Failed to archive ${memory.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return { archived, errors };
}

/**
 * Clean up orphan entity links
 * Links pointing to deleted entities
 */
async function cleanupOrphanLinks(
  userId: string,
  prisma: PrismaClient
): Promise<{ deleted: number; errors: string[] }> {
  const errors: string[] = [];

  // Find all entity links for this user's memories
  const links = await prisma.memoryEntityLink.findMany({
    where: {
      memory: { userId },
    },
    select: {
      id: true,
      entityType: true,
      entityId: true,
    },
  });

  let deleted = 0;
  for (const link of links) {
    try {
      let exists = false;

      // Check if entity still exists
      switch (link.entityType) {
        case 'person':
          exists = !!(await prisma.person.findFirst({
            where: { id: link.entityId, userId, deletedAt: null },
          }));
          break;
        case 'project':
          exists = !!(await prisma.project.findFirst({
            where: { id: link.entityId, userId, deletedAt: null },
          }));
          break;
        case 'goal':
          exists = !!(await prisma.goal.findFirst({
            where: { id: link.entityId, userId, deletedAt: null },
          }));
          break;
        case 'decision':
          exists = !!(await prisma.decision.findFirst({
            where: { id: link.entityId, userId, deletedAt: null },
          }));
          break;
      }

      if (!exists) {
        await prisma.memoryEntityLink.delete({ where: { id: link.id } });
        deleted++;
      }
    } catch (err) {
      errors.push(`Failed to cleanup link ${link.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  }

  return { deleted, errors };
}

/**
 * Run full memory cleanup for a user
 */
export async function runMemoryCleanup(
  userId: string,
  prisma: PrismaClient
): Promise<CleanupResult> {
  logger.info('Starting memory cleanup job', { userId: userId.substring(0, 10) });

  const startTime = Date.now();
  const result: CleanupResult = {
    archived: 0,
    deleted: 0,
    errors: [],
    checked: 0,
  };

  try {
    // Count total checked
    const totalMemories = await prisma.memoryEntry.count({
      where: { userId, deletedAt: null },
    });
    result.checked = totalMemories;

    // Run cleanup tasks
    const [staleResult, confidenceResult, orphanResult] = await Promise.all([
      archiveStaleMemories(userId, prisma),
      archiveLowConfidence(userId, prisma),
      cleanupOrphanLinks(userId, prisma),
    ]);

    result.archived = staleResult.archived + confidenceResult.archived;
    result.deleted = orphanResult.deleted;
    result.errors = [
      ...staleResult.errors,
      ...confidenceResult.errors,
      ...orphanResult.errors,
    ];

    const duration = Date.now() - startTime;

    logger.info('Memory cleanup complete', {
      userId: userId.substring(0, 10),
      durationMs: duration,
      archived: result.archived,
      deleted: result.deleted,
      errors: result.errors.length,
    });

    return result;
  } catch (err) {
    logger.error('Memory cleanup failed', {
      userId: userId.substring(0, 10),
      error: err instanceof Error ? err.message : 'Unknown',
    });
    result.errors.push(`Job failed: ${err instanceof Error ? err.message : 'Unknown'}`);
    return result;
  }
}

/**
 * Schedule cleanup for all active users
 * Run this periodically (e.g., daily)
 */
export async function scheduleCleanupForAllUsers(
  prisma: PrismaClient,
  onProgress?: (userId: string, result: CleanupResult) => void
): Promise<{ usersProcessed: number; totalArchived: number; totalDeleted: number }> {
  const users = await prisma.user.findMany({
    select: { id: true },
  });

  let usersProcessed = 0;
  let totalArchived = 0;
  let totalDeleted = 0;

  for (const user of users) {
    const result = await runMemoryCleanup(user.id, prisma);
    usersProcessed++;
    totalArchived += result.archived;
    totalDeleted += result.deleted;

    if (onProgress) {
      onProgress(user.id, result);
    }
  }

  logger.info('Batch cleanup complete', {
    usersProcessed,
    totalArchived,
    totalDeleted,
  });

  return { usersProcessed, totalArchived, totalDeleted };
}
