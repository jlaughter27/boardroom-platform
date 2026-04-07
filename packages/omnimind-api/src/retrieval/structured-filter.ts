import type { PrismaClient } from '@prisma/client';

export interface ScoredResult {
  id: string;
  type: 'memory' | 'person' | 'goal' | 'project' | 'decision';
  content: string;
  title: string;
  relevanceScore: number;
  source: 'structured' | 'fts' | 'trigram' | 'semantic';
  whyIncluded: string;
  tags?: string[];
  importance?: number;
  lastAccessedAt?: Date | null;
}

export async function structuredFilter(
  userId: string,
  query: string,
  options: { domain?: string; tags?: string[]; limit?: number },
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  const where: Record<string, unknown> = {
    userId,
    deletedAt: null,
    status: { not: 'ARCHIVED' },
  };

  if (options.domain) where.domain = options.domain;
  if (options.tags && options.tags.length > 0) {
    where.tags = { hasSome: options.tags };
  }
  // Simple contains match for structured filter
  if (query) {
    where.OR = [
      { title: { contains: query, mode: 'insensitive' } },
      { content: { contains: query, mode: 'insensitive' } },
    ];
  }

  const results = await prisma.memoryEntry.findMany({
    where: where as any,
    take: options.limit ?? 20,
    orderBy: { importance: 'desc' },
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
  }));
}
