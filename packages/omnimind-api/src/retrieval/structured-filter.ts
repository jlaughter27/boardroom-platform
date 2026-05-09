import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from '@boardroom/shared';

export type { ScoredResult };

export async function structuredFilter(
  userId: string,
  query: string,
  options: { domain?: string; tags?: string[]; limit?: number },
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  const includeArchived = (options as { includeArchived?: boolean }).includeArchived ?? false;
  const archiveCutoffMs = 90 * 24 * 60 * 60 * 1000;
  const archiveCutoff = new Date(Date.now() - archiveCutoffMs);

  const where: Record<string, unknown> = {
    userId,
    deletedAt: null,
    status: { not: 'ARCHIVED' },
  };

  // Forgetting curve: exclude low-importance memories not accessed in 90 days
  // unless caller explicitly opts in with includeArchived
  if (!includeArchived) {
    where.OR = [
      { importance: { gte: 0.4 } },
      { lastAccessedAt: { gte: archiveCutoff } },
    ];
  }

  if (options.domain) where.domain = options.domain;
  if (options.tags && options.tags.length > 0) {
    where.tags = { hasSome: options.tags };
  }
  // Simple contains match for structured filter
  if (query) {
    const contentFilter = [
      { title: { contains: query, mode: 'insensitive' } },
      { content: { contains: query, mode: 'insensitive' } },
    ];
    // Merge with existing OR clause if present (forgetting curve)
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: contentFilter }];
      delete where.OR;
    } else {
      where.OR = contentFilter;
    }
  }

  const results = await prisma.memoryEntry.findMany({
    where: where as any,
    take: options.limit ?? 20,
    orderBy: { importance: 'desc' },
    select: {
      id: true, content: true, title: true, tags: true,
      importance: true, lastAccessedAt: true, sourceWeight: true,
    },
  });

  return results.map(r => ({
    id: r.id,
    type: 'memory' as const,
    content: r.content,
    title: r.title,
    relevanceScore: 1.0, // Exact structured match
    source: 'structured' as const,
    whyIncluded: `Structured match${options.domain ? ` in domain "${options.domain}"` : ''}`,
    tags: r.tags,
    importance: r.importance,
    lastAccessedAt: r.lastAccessedAt,
    sourceWeight: r.sourceWeight,
  }));
}
