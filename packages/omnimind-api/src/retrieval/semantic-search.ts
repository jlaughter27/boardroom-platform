import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from './structured-filter';

/**
 * Semantic search using pgvector embeddings.
 * STUB: Returns empty array in Phase 0. Will use cosine similarity in Phase 1.
 *
 * TODO (Phase 1): Implementation will look like:
 * SELECT id, title, content, 1 - (embedding <=> $queryEmbedding) as similarity
 * FROM memory_entries
 * WHERE user_id = $userId AND deleted_at IS NULL
 * ORDER BY embedding <=> $queryEmbedding
 * LIMIT $limit
 */
export async function semanticSearch(
  _userId: string,
  _queryEmbedding: number[],
  _options: { limit?: number },
  _prisma: PrismaClient
): Promise<ScoredResult[]> {
  return [];
}
