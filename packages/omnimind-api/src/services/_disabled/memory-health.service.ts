import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

export interface MemoryHealthMetrics {
  // Overview stats
  totalMemories: number;
  activeMemories: number;
  archivedMemories: number;
  memoriesLast7Days: number;
  memoriesLast30Days: number;

  // Quality indicators
  avgConfidence: number;
  lowConfidenceCount: number;  // Below 0.6
  highImportanceCount: number; // Above 0.8

  // Coverage metrics
  domainDistribution: Record<string, number>;
  sourceTypeDistribution: Record<string, number>;

  // Health score (0-100)
  healthScore: number;

  // Issues detected
  issues: HealthIssue[];
}

export interface HealthIssue {
  type: 'warning' | 'critical' | 'info';
  category: 'quality' | 'coverage' | 'freshness' | 'duplicates';
  message: string;
  count?: number;
  recommendation: string;
}

/**
 * Calculate memory health metrics for a user
 */
export async function calculateMemoryHealth(
  userId: string,
  prisma: PrismaClient
): Promise<MemoryHealthMetrics> {
  const issues: HealthIssue[] = [];

  // Get basic counts
  const [
    totalResult,
    activeResult,
    archivedResult,
    last7DaysResult,
    last30DaysResult,
    confidenceResult,
  ] = await Promise.all([
    prisma.memoryEntry.count({ where: { userId } }),
    prisma.memoryEntry.count({ where: { userId, status: 'CONFIRMED', deletedAt: null } }),
    prisma.memoryEntry.count({ where: { userId, status: 'ARCHIVED' } }),
    prisma.memoryEntry.count({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.memoryEntry.count({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.memoryEntry.groupBy({
      where: { userId, deletedAt: null },
      by: ['confidence'],
      _count: { id: true },
    }),
  ]);

  // Get low confidence count (LOW and SPECULATIVE are considered low confidence)
  const lowConfidenceCount = await prisma.memoryEntry.count({
    where: { userId, deletedAt: null, confidence: { in: ['LOW', 'SPECULATIVE'] } },
  });

  // Get high importance count
  const highImportanceCount = await prisma.memoryEntry.count({
    where: { userId, deletedAt: null, importance: { gt: 0.8 } },
  });

  // Domain distribution
  const domainGroups = await prisma.memoryEntry.groupBy({
    by: ['domain'],
    where: { userId, deletedAt: null },
    _count: { id: true },
  });
  const domainDistribution: Record<string, number> = {};
  for (const g of domainGroups) {
    domainDistribution[g.domain] = g._count.id;
  }

  // Source type distribution
  const sourceGroups = await prisma.memoryEntry.groupBy({
    by: ['sourceType'],
    where: { userId, deletedAt: null },
    _count: { id: true },
  });
  const sourceTypeDistribution: Record<string, number> = {};
  for (const g of sourceGroups) {
    sourceTypeDistribution[g.sourceType] = g._count.id;
  }

  // Detect issues

  // Issue: Low confidence memories
  if (lowConfidenceCount > 10) {
    issues.push({
      type: 'warning',
      category: 'quality',
      message: `${lowConfidenceCount} memories have low confidence (< 60%)`,
      count: lowConfidenceCount,
      recommendation: 'Review and verify these memories, consider removing or re-confirming',
    });
  }

  // Issue: No recent memories
  if (last30DaysResult === 0 && activeResult > 0) {
    issues.push({
      type: 'warning',
      category: 'freshness',
      message: 'No new memories in the last 30 days',
      recommendation: 'Consider running a new BoardRoom session to capture recent thinking',
    });
  }

  // Issue: Domain imbalance
  const domainCounts = Object.values(domainDistribution);
  if (domainCounts.length > 1) {
    const max = Math.max(...domainCounts);
    const min = Math.min(...domainCounts);
    if (max > min * 5) {
      issues.push({
        type: 'info',
        category: 'coverage',
        message: 'Significant domain imbalance detected',
        recommendation: 'Consider capturing more memories in underrepresented domains',
      });
    }
  }

  // Issue: Too many archived
  const archiveRatio = archivedResult / (totalResult || 1);
  if (archiveRatio > 0.5) {
    issues.push({
      type: 'info',
      category: 'quality',
      message: `${Math.round(archiveRatio * 100)}% of memories are archived`,
      recommendation: 'Review archived memories - some may be deletable',
    });
  }

  // Calculate health score (0-100)
  let healthScore = 100;

  // Deduct for low confidence memories (up to -20)
  healthScore -= Math.min(20, lowConfidenceCount * 0.5);

  // Deduct for stale memories (up to -15)
  if (last30DaysResult === 0) healthScore -= 15;
  else if (last7DaysResult === 0) healthScore -= 5;

  // Deduct for domain imbalance (up to -10)
  if (issues.some(i => i.category === 'coverage' && i.message.includes('imbalance'))) {
    healthScore -= 10;
  }

  // Deduct for high archive ratio (up to -10)
  if (archiveRatio > 0.5) healthScore -= 10;

  healthScore = Math.max(0, Math.round(healthScore));

  // Critical health warning
  if (healthScore < 50) {
    issues.unshift({
      type: 'critical',
      category: 'quality',
      message: `Memory health score is critically low (${healthScore}/100)`,
      recommendation: 'Immediate review recommended - run health audit and clean up low-quality memories',
    });
  }

  logger.info('Memory health calculated', {
    userId: userId.substring(0, 10),
    healthScore,
    totalMemories: totalResult,
    issueCount: issues.length,
  });

  return {
    totalMemories: totalResult,
    activeMemories: activeResult,
    archivedMemories: archivedResult,
    memoriesLast7Days: last7DaysResult,
    memoriesLast30Days: last30DaysResult,
    // Calculate weighted average from groupBy results
    avgConfidence: Math.round(
      ((confidenceResult.find((g: { confidence: string; _count: { id: number } }) => g.confidence === 'HIGH')?._count.id ?? 0) * 1.0 +
        (confidenceResult.find((g: { confidence: string; _count: { id: number } }) => g.confidence === 'MEDIUM')?._count.id ?? 0) * 0.67 +
        (confidenceResult.find((g: { confidence: string; _count: { id: number } }) => g.confidence === 'LOW')?._count.id ?? 0) * 0.33 +
        (confidenceResult.find((g: { confidence: string; _count: { id: number } }) => g.confidence === 'SPECULATIVE')?._count.id ?? 0) * 0.1) /
        Math.max(confidenceResult.reduce((sum: number, g: { _count: { id: number } }) => sum + g._count.id, 0), 1) *
        100
    ) / 100,
    lowConfidenceCount,
    highImportanceCount,
    domainDistribution,
    sourceTypeDistribution,
    healthScore,
    issues,
  };
}

/**
 * Get trending metrics over time
 */
export async function getMemoryTrends(
  userId: string,
  days: number,
  prisma: PrismaClient
) {
  const trends = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);

    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const count = await prisma.memoryEntry.count({
      where: {
        userId,
        createdAt: {
          gte: date,
          lt: nextDate,
        },
      },
    });

    trends.push({
      date: date.toISOString().split('T')[0],
      count,
    });
  }

  return trends;
}
