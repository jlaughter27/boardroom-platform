import type { PrismaClient } from '@prisma/client';
import { CORTEX_CONFIG } from '@boardroom/shared';

export async function scheduleReviews(
  userId: string,
  decisionId: string,
  decisionTitle: string,
  prisma: PrismaClient,
): Promise<void> {
  const now = new Date();
  for (const days of CORTEX_CONFIG.outcomeReviewDays) {
    const scheduledFor = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    await prisma.outcomeReviewNudge.create({
      data: {
        userId,
        decisionId,
        decisionTitle,
        nudgeType: `${days}_day`,
        scheduledFor,
        status: 'pending',
      },
    });
  }
}

export async function getPendingNudges(userId: string, prisma: PrismaClient) {
  return prisma.outcomeReviewNudge.findMany({
    where: {
      userId,
      status: 'pending',
      scheduledFor: { lte: new Date() },
    },
    orderBy: { scheduledFor: 'asc' },
    take: 5,
  });
}

export async function completeReview(
  nudgeId: string,
  outcome: string,
  rating: number,
  wouldRepeat: boolean,
  prisma: PrismaClient,
) {
  const nudge = await prisma.outcomeReviewNudge.update({
    where: { id: nudgeId },
    data: { status: 'completed', completedAt: new Date() },
  });

  // Also update the linked Decision record
  await prisma.decision.update({
    where: { id: nudge.decisionId },
    data: {
      outcome,
      outcomeRating: rating,
      status: 'REVIEWED',
    },
  });

  return nudge;
}

export async function skipReview(nudgeId: string, prisma: PrismaClient) {
  return prisma.outcomeReviewNudge.update({
    where: { id: nudgeId },
    data: { status: 'skipped' },
  });
}

export async function listNudges(
  userId: string,
  status: string | undefined,
  limit: number,
  offset: number,
  prisma: PrismaClient,
) {
  const where: Record<string, unknown> = { userId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.outcomeReviewNudge.findMany({
      where: where as any,
      take: limit,
      skip: offset,
      orderBy: { scheduledFor: 'desc' },
    }),
    prisma.outcomeReviewNudge.count({ where: where as any }),
  ]);

  return { items, total, offset, limit };
}
