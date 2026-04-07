import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from './structured-filter';

export async function fulltextSearch(
  userId: string,
  query: string,
  options: { limit?: number },
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  if (!query || query.trim().length === 0) return [];

  // Convert query to tsquery format (simple: AND all words)
  const tsQuery = query
    .trim()
    .split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .join(' & ');
  if (!tsQuery) return [];

  try {
    const results = await prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        content: string;
        tags: string[];
        importance: number;
        last_accessed_at: Date | null;
        rank: number;
      }>
    >`
      SELECT id, title, content, tags, importance, last_accessed_at,
             ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${tsQuery})) as rank
      FROM memory_entries
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
        AND status != 'ARCHIVED'
        AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsQuery})
      ORDER BY rank DESC
      LIMIT ${options.limit ?? 20}
    `;

    return results.map(r => ({
      id: r.id,
      type: 'memory' as const,
      content: r.content,
      title: r.title,
      relevanceScore: Math.min(r.rank, 1.0),
      source: 'fts' as const,
      whyIncluded: `Full-text match for "${query}"`,
      tags: r.tags,
      importance: r.importance,
      lastAccessedAt: r.last_accessed_at,
    }));
  } catch {
    // FTS may fail if extensions aren't enabled yet — degrade gracefully
    return [];
  }
}
