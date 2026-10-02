import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from './structured-filter';
import { archiveCutoffDate, type LayerErrorHook } from './forgetting-curve';
import { decryptRows } from './row-decrypt';
import { logger } from '../lib/logger';

export interface TrigramSearchOptions {
  limit?: number;
  threshold?: number;
  includeArchived?: boolean;
  /** Tenant scope. Required unless `includeAllTenants` is true. */
  tenantId?: string;
  /** Admin escape hatch — skip tenant filter entirely. Defaults to false. */
  includeAllTenants?: boolean;
  /** F-204: invoked when the layer fails and degrades to []. */
  onLayerError?: LayerErrorHook;
}

interface TrigramRow {
  id: string;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  last_accessed_at: Date | null;
  source_weight: number;
  sim: number;
  domain: string | null;
  encrypted_content: Uint8Array | null;
}

export async function trigramSearch(
  userId: string,
  query: string,
  options: TrigramSearchOptions,
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  if (!query || query.trim().length === 0) return [];

  const threshold = options.threshold ?? 0.3;
  const includeArchived = options.includeArchived ?? false;
  const cutoff = archiveCutoffDate();

  // Safer default: no tenant + no explicit cross-tenant flag => return 0 results.
  if (!options.tenantId && !options.includeAllTenants) return [];
  const tenantId = options.tenantId ?? null;

  try {
    // O-103: forgetting curve falls back to created_at when never recalled.
    const results = tenantId
      ? await prisma.$queryRaw<TrigramRow[]>`
          SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
                 domain, encrypted_content,
                 similarity(content, ${query}) as sim
          FROM memory_entries
          WHERE user_id = ${userId}
            AND tenant_id = ${tenantId}
            AND deleted_at IS NULL
            AND status != 'ARCHIVED'
            AND (${includeArchived} OR importance >= 0.4 OR COALESCE(last_accessed_at, created_at) >= ${cutoff})
            AND similarity(content, ${query}) > ${threshold}
          ORDER BY sim DESC
          LIMIT ${options.limit ?? 20}
        `
      : await prisma.$queryRaw<TrigramRow[]>`
          SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
                 domain, encrypted_content,
                 similarity(content, ${query}) as sim
          FROM memory_entries
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
            AND status != 'ARCHIVED'
            AND (${includeArchived} OR importance >= 0.4 OR COALESCE(last_accessed_at, created_at) >= ${cutoff})
            AND similarity(content, ${query}) > ${threshold}
          ORDER BY sim DESC
          LIMIT ${options.limit ?? 20}
        `;

    return decryptRows(results).map(r => ({
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
      sourceWeight: r.source_weight,
    }));
  } catch (err) {
    // F-204: pg_trgm may not be enabled yet — degrade, but loudly.
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('[trigram] retrieval layer failed — degrading to []', { error: error.message });
    options.onLayerError?.('trigram', error);
    return [];
  }
}
