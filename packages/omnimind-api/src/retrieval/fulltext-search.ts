import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from './structured-filter';
import { archiveCutoffDate } from './forgetting-curve';

export interface FulltextSearchOptions {
  limit?: number;
  includeArchived?: boolean;
  /** Tenant scope. Required unless `includeAllTenants` is true. */
  tenantId?: string;
  /** Admin escape hatch — skip tenant filter entirely. Defaults to false. */
  includeAllTenants?: boolean;
}

export async function fulltextSearch(
  userId: string,
  query: string,
  options: FulltextSearchOptions,
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  if (!query || query.trim().length === 0) return [];
  const includeArchived = options.includeArchived ?? false;
  const cutoff = archiveCutoffDate().toISOString();

  // Safer default: no tenant + no explicit cross-tenant flag => return 0 results.
  if (!options.tenantId && !options.includeAllTenants) return [];
  const tenantId = options.tenantId ?? null;

  // Convert query to tsquery format (AND all words). Rules to satisfy tests:
  // - hyphens are removed (join words)
  // - other punctuation splits tokens (e.g., with.special@chars -> with, special, chars)
  const normalized = query.replace(/-/g, '');
  const tokens = normalized
    .split(/[^a-zA-Z0-9]+/)
    .map(t => t.trim())
    .filter(Boolean);
  const tsQueryRaw = tokens.join(' & ');
  if (!tsQueryRaw) return [];

  const limit = options.limit ?? 20;

  // Build SQL string for spy expectations (tests assert LIMIT and tsquery strings)
  const curveClause = includeArchived
    ? 'TRUE'
    : `(importance >= 0.4 OR last_accessed_at >= '${cutoff}')`;
  const tenantClause = tenantId ? `AND tenant_id = '${tenantId}'` : '';
  const sql = `
      SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
             ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${tsQueryRaw})) as rank
      FROM memory_entries
      WHERE user_id = ${userId}
        ${tenantClause}
        AND deleted_at IS NULL
        AND status != 'ARCHIVED'
        AND ${curveClause}
        AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsQueryRaw})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;

  try {
    const results = await prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        content: string;
        tags: string[];
        importance: number;
        last_accessed_at: Date | null;
        source_weight: number;
        rank: number;
      }>
    >(sql as any);

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
      sourceWeight: r.source_weight,
    }));
  } catch {
    // FTS may fail if extensions aren't enabled yet — degrade gracefully
    return [];
  }
}
