import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from './structured-filter';
import { archiveCutoffDate } from './forgetting-curve';
import { logger } from '../lib/logger';

export interface SemanticSearchOptions {
  limit?: number;
  includeArchived?: boolean;
  /** Tenant scope. Required unless `includeAllTenants` is true. */
  tenantId?: string;
  /** Admin escape hatch — skip tenant filter entirely. Defaults to false. */
  includeAllTenants?: boolean;
}

export async function semanticSearch(
  userId: string,
  queryEmbedding: number[],
  options: SemanticSearchOptions,
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  if (!queryEmbedding || queryEmbedding.length === 0) return [];

  const limit = options.limit ?? 10;
  const includeArchived = options.includeArchived ?? false;
  const cutoff = archiveCutoffDate();

  // Safer default: no tenant + no explicit cross-tenant flag => return 0 results.
  // This prevents accidental cross-tenant leakage from callers that haven't
  // been updated to pass tenant context yet.
  if (!options.tenantId && !options.includeAllTenants) return [];
  const tenantId = options.tenantId ?? null;

  try {
    const results = tenantId
      ? await prisma.$queryRaw<Array<{
          id: string; title: string; content: string; tags: string[];
          importance: number; last_accessed_at: Date | null;
          source_weight: number; similarity: number;
        }>>`
          SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
                 1 - (embedding <=> ${queryEmbedding}::vector) as similarity
          FROM "memory_entries"
          WHERE "user_id" = ${userId}
            AND tenant_id = ${tenantId}
            AND embedding IS NOT NULL
            AND "deleted_at" IS NULL
            AND status != 'ARCHIVED'
            AND (${includeArchived} OR importance >= 0.4 OR last_accessed_at >= ${cutoff})
          ORDER BY embedding <=> ${queryEmbedding}::vector
          LIMIT ${limit}
        `
      : await prisma.$queryRaw<Array<{
          id: string; title: string; content: string; tags: string[];
          importance: number; last_accessed_at: Date | null;
          source_weight: number; similarity: number;
        }>>`
          SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
                 1 - (embedding <=> ${queryEmbedding}::vector) as similarity
          FROM "memory_entries"
          WHERE "user_id" = ${userId}
            AND embedding IS NOT NULL
            AND "deleted_at" IS NULL
            AND status != 'ARCHIVED'
            AND (${includeArchived} OR importance >= 0.4 OR last_accessed_at >= ${cutoff})
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
      sourceWeight: r.source_weight,
    }));
  } catch (err) {
    // F-204: log before returning [] so a broken pgvector install, OpenAI 401,
    // or schema-drift error doesn't silently degrade retrieval to zero results.
    logger.error('[semantic] retrieval failed', { error: err });
    // pgvector may not be enabled or no embeddings exist
    return [];
  }
}
