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

/**
 * Full-text search over memory titles + content.
 *
 * WS-6 F-107 — Earlier revision used `prisma.$queryRaw(sql as any)` with all
 * params (userId, tenantId, cutoff, tokens, limit) interpolated as a plain
 * JS string. Prisma's `$queryRaw` accepts only `TemplateStringsArray | Prisma.Sql`
 * and throws on a plain-string call; the throw was silently swallowed by the
 * catch block, so FTS returned [] for every query in production. The `as any`
 * cast looked like a SQL-injection vector — the next maintainer might "fix"
 * the typecheck error by switching to `$queryRawUnsafe(...)`. That would
 * have made the injection real.
 *
 * This version uses the tagged-template form throughout. All user-controlled
 * values (userId, tenantId, tsquery) are bound parameters. The query branches
 * on tenantId presence and includeArchived to avoid optional WHERE fragments.
 */
export async function fulltextSearch(
  userId: string,
  query: string,
  options: FulltextSearchOptions,
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  if (!query || query.trim().length === 0) return [];
  const includeArchived = options.includeArchived ?? false;
  const cutoff = archiveCutoffDate();

  // Safer default: no tenant + no explicit cross-tenant flag => return 0 results.
  if (!options.tenantId && !options.includeAllTenants) return [];
  const tenantId = options.tenantId ?? null;

  // Convert query to tsquery format (AND all words).
  // - hyphens are removed (join words)
  // - other punctuation splits tokens (e.g., with.special@chars -> with, special, chars)
  // - we restrict to [a-zA-Z0-9] so the resulting tsquery has no operator-relevant chars
  //   and is safe to pass as a bound parameter
  const normalized = query.replace(/-/g, '');
  const tokens = normalized
    .split(/[^a-zA-Z0-9]+/)
    .map(t => t.trim())
    .filter(Boolean);
  const tsQuery = tokens.join(' & ');
  if (!tsQuery) return [];

  const limit = options.limit ?? 20;

  try {
    // Four-way branch on (tenant, includeArchived). Each branch is a real
    // tagged-template `$queryRaw` call → every interpolation is parameterized.
    let results: Array<{
      id: string;
      title: string;
      content: string;
      tags: string[];
      importance: number;
      last_accessed_at: Date | null;
      source_weight: number;
      rank: number;
    }>;

    if (tenantId && includeArchived) {
      results = await prisma.$queryRaw`
        SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
               ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${tsQuery})) as rank
        FROM memory_entries
        WHERE user_id = ${userId}
          AND tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND status != 'ARCHIVED'
          AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsQuery})
        ORDER BY rank DESC
        LIMIT ${limit}
      `;
    } else if (tenantId && !includeArchived) {
      results = await prisma.$queryRaw`
        SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
               ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${tsQuery})) as rank
        FROM memory_entries
        WHERE user_id = ${userId}
          AND tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND status != 'ARCHIVED'
          AND (importance >= 0.4 OR last_accessed_at >= ${cutoff})
          AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsQuery})
        ORDER BY rank DESC
        LIMIT ${limit}
      `;
    } else if (!tenantId && includeArchived) {
      results = await prisma.$queryRaw`
        SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
               ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${tsQuery})) as rank
        FROM memory_entries
        WHERE user_id = ${userId}
          AND deleted_at IS NULL
          AND status != 'ARCHIVED'
          AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsQuery})
        ORDER BY rank DESC
        LIMIT ${limit}
      `;
    } else {
      results = await prisma.$queryRaw`
        SELECT id, title, content, tags, importance, last_accessed_at, source_weight,
               ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${tsQuery})) as rank
        FROM memory_entries
        WHERE user_id = ${userId}
          AND deleted_at IS NULL
          AND status != 'ARCHIVED'
          AND (importance >= 0.4 OR last_accessed_at >= ${cutoff})
          AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsQuery})
        ORDER BY rank DESC
        LIMIT ${limit}
      `;
    }

    return results.map(r => ({
      id: r.id,
      type: 'memory' as const,
      content: r.content,
      title: r.title,
      relevanceScore: Math.min(Number(r.rank), 1.0),
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
