import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from './structured-filter';
import { archiveCutoffDate, type LayerErrorHook } from './forgetting-curve';
import { decryptRows } from './row-decrypt';
import { logger } from '../lib/logger';
import { temporalValiditySql, memoryClassSql } from './temporal-validity';

export interface SemanticSearchOptions {
  limit?: number;
  includeArchived?: boolean;
  /** Tenant scope. Required unless `includeAllTenants` is true. */
  tenantId?: string;
  /** Admin escape hatch — skip tenant filter entirely. Defaults to false. */
  includeAllTenants?: boolean;
  /** Phase 6: temporal validity — "what was believed at this instant". */
  asOf?: Date;
  /** Phase 6: restrict to one MemoryClass (WORKING|EPISODIC|SEMANTIC|DECISION). */
  memoryClass?: string;
  /** F-204: invoked when the layer fails and degrades to []. */
  onLayerError?: LayerErrorHook;
}

interface SemanticRow {
  id: string; title: string; content: string; tags: string[];
  importance: number; last_accessed_at: Date | null;
  source_weight: number; similarity: number;
  domain: string | null; encrypted_content: Uint8Array | null;
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
  const validity = temporalValiditySql(options.asOf);
  const classFilter = memoryClassSql(options.memoryClass);

  try {
    // O-103: forgetting curve falls back to created_at when the memory has
    // never been recalled (last_accessed_at IS NULL).
    const results = tenantId
      ? await prisma.$queryRaw<SemanticRow[]>`
          SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
                 domain, encrypted_content,
                 1 - (embedding <=> ${queryEmbedding}::vector) as similarity
          FROM "memory_entries"
          WHERE "user_id" = ${userId}
            AND tenant_id = ${tenantId}
            AND embedding IS NOT NULL
            AND "deleted_at" IS NULL
            AND status != 'ARCHIVED'
            AND ${validity}
            AND ${classFilter}
            AND (${includeArchived} OR importance >= 0.4 OR COALESCE(last_accessed_at, created_at) >= ${cutoff})
          ORDER BY embedding <=> ${queryEmbedding}::vector
          LIMIT ${limit}
        `
      : await prisma.$queryRaw<SemanticRow[]>`
          SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
                 domain, encrypted_content,
                 1 - (embedding <=> ${queryEmbedding}::vector) as similarity
          FROM "memory_entries"
          WHERE "user_id" = ${userId}
            AND embedding IS NOT NULL
            AND "deleted_at" IS NULL
            AND status != 'ARCHIVED'
            AND ${validity}
            AND ${classFilter}
            AND (${includeArchived} OR importance >= 0.4 OR COALESCE(last_accessed_at, created_at) >= ${cutoff})
          ORDER BY embedding <=> ${queryEmbedding}::vector
          LIMIT ${limit}
        `;

    return decryptRows(results).map(r => ({
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
    // F-204: tolerate the layer failing (pgvector missing, bad embedding dims,
    // schema drift) but never silently. Log + report so the package is marked
    // degraded instead of looking like "no semantic matches".
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('[semantic] retrieval layer failed — degrading to []', { error: error.message });
    options.onLayerError?.('semantic', error);
    return [];
  }
}
