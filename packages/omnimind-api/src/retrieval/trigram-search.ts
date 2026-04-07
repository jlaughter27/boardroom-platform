import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from './structured-filter';

export async function trigramSearch(
  userId: string,
  query: string,
  options: { limit?: number; threshold?: number },
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  if (!query || query.trim().length === 0) return [];

  const threshold = options.threshold ?? 0.3;

  try {
    const results = await prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        content: string;
        tags: string[];
        importance: number;
        last_accessed_at: Date | null;
        sim: number;
      }>
    >`
      SELECT id, title, content, tags, importance, last_accessed_at,
             similarity(content, ${query}) as sim
      FROM memory_entries
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
        AND status != 'ARCHIVED'
        AND similarity(content, ${query}) > ${threshold}
      ORDER BY sim DESC
      LIMIT ${options.limit ?? 20}
    `;

    return results.map(r => ({
      id: r.id,
      type: 'memory' as const,
      content: r.content,
      title: r.title,
      relevanceScore: r.sim,
      source: 'trigram' as const,
      whyIncluded: `Fuzzy match (${Math.round(r.sim * 100)}% similarity)`,
      tags: r.tags,
      importance: r.importance,
      lastAccessedAt: r.last_accessed_at,
    }));
  } catch {
    // pg_trgm may not be enabled yet — degrade gracefully
    return [];
  }
}
