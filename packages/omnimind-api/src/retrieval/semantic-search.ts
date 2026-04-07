import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from './structured-filter';

export async function semanticSearch(
  userId: string,
  queryEmbedding: number[],
  options: { limit?: number },
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  if (!queryEmbedding || queryEmbedding.length === 0) return [];

  const limit = options.limit ?? 10;

  try {
    const results = await prisma.$queryRaw<Array<{
      id: string; title: string; content: string; tags: string[];
      importance: number; last_accessed_at: Date | null; similarity: number;
    }>>`
      SELECT id, title, content, tags, importance, last_accessed_at,
             1 - (embedding <=> ${queryEmbedding}::vector) as similarity
      FROM "memory_entries"
      WHERE "user_id" = ${userId}
        AND embedding IS NOT NULL
        AND "deleted_at" IS NULL
        AND status != 'ARCHIVED'
      ORDER BY embedding <=> ${queryEmbedding}::vector
      LIMIT ${limit}
    `;

    return results.map(r => ({
      id: r.id,
      type: 'memory' as const,
      title: r.title,
      content: r.content,
      relevanceScore: Math.max(0, Math.min(1, r.similarity)),
      source: 'semantic' as const,
      whyIncluded: `Semantic similarity: ${(r.similarity * 100).toFixed(1)}%`,
      tags: r.tags,
      importance: r.importance,
      lastAccessedAt: r.last_accessed_at,
    }));
  } catch (err) {
    // pgvector may not be enabled or no embeddings exist
    return [];
  }
}
