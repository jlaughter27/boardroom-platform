import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from './structured-filter';
import { archiveCutoffDate, type LayerErrorHook } from './forgetting-curve';
import { decryptRows } from './row-decrypt';
import { logger } from '../lib/logger';
import { temporalValiditySql, memoryClassSql } from './temporal-validity';

export interface FulltextSearchOptions {
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
 * values (userId, tenantId, tsquery, the raw query text) are bound parameters.
 * The query branches on tenantId presence and includeArchived to avoid
 * optional WHERE fragments.
 *
 * RD-2 (2026-10-23 real-data run) — ranking: a single-keyword query scored
 * every note that mentioned the word about the same, and the note whose TITLE
 * was the word could fall out of the top 20. Now:
 *   - the rank vector weights the title 'A' and the body 'D' (ts_rank weights
 *     {D 0.1, C 0.2, B 0.4, A 1.0}), so a title hit outranks body mentions;
 *   - `title_exact` (title lexemes == query lexemes, stemming and stop words
 *     applied by the same 'english' config) scores 1.0 and sorts first, so an
 *     exact title can never be cut by the LIMIT;
 *   - `id` is the final ORDER BY key: equal ranks no longer come back in heap
 *     order, which made the LIMIT cut (and so the result set) vary between
 *     identical calls.
 * The match predicate is unchanged (`to_tsvector(title || ' ' || content) @@`),
 * so the set of matching rows is the same as before; only the order moved.
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

  // Convert query to tsquery format (AND all words; an OR pass fills in below).
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
  const validity = temporalValiditySql(options.asOf);
  const classFilter = memoryClassSql(options.memoryClass);

  type FtsRow = {
    id: string;
    title: string;
    content: string;
    tags: string[];
    importance: number;
    last_accessed_at: Date | null;
    source_weight: number;
    rank: number;
    /** RD-2: the title's lexemes equal the query's (case, stop words and stemming ignored). */
    title_exact: boolean;
    domain: string | null;
    encrypted_content: Uint8Array | null;
  };

  const runQuery = async (tsq: string, max: number): Promise<FtsRow[]> => {
    // Four-way branch on (tenant, includeArchived). Each branch is a real
    // tagged-template `$queryRaw` call → every interpolation is parameterized.
    let results: FtsRow[];

    // O-103: the forgetting curve falls back to created_at when the memory
    // has never been recalled (last_accessed_at IS NULL).
    if (tenantId && includeArchived) {
      results = await prisma.$queryRaw`
        SELECT id, title, content, tags, importance, last_accessed_at, source_weight, domain, encrypted_content,
               ts_rank(ARRAY[0.1, 0.2, 0.4, 1.0]::float4[],
                       setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', content), 'D'),
                       to_tsquery('english', ${tsq})) as rank,
               strip(to_tsvector('english', title)) = strip(to_tsvector('english', ${query})) as title_exact
        FROM memory_entries
        WHERE user_id = ${userId}
          AND tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND status != 'ARCHIVED'
          AND ${validity}
          AND ${classFilter}
          AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsq})
        ORDER BY title_exact DESC, rank DESC, id ASC
        LIMIT ${max}
      `;
    } else if (tenantId && !includeArchived) {
      results = await prisma.$queryRaw`
        SELECT id, title, content, tags, importance, last_accessed_at, source_weight, domain, encrypted_content,
               ts_rank(ARRAY[0.1, 0.2, 0.4, 1.0]::float4[],
                       setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', content), 'D'),
                       to_tsquery('english', ${tsq})) as rank,
               strip(to_tsvector('english', title)) = strip(to_tsvector('english', ${query})) as title_exact
        FROM memory_entries
        WHERE user_id = ${userId}
          AND tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND status != 'ARCHIVED'
          AND ${validity}
          AND ${classFilter}
          AND (importance >= 0.4 OR COALESCE(last_accessed_at, created_at) >= ${cutoff})
          AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsq})
        ORDER BY title_exact DESC, rank DESC, id ASC
        LIMIT ${max}
      `;
    } else if (!tenantId && includeArchived) {
      results = await prisma.$queryRaw`
        SELECT id, title, content, tags, importance, last_accessed_at, source_weight, domain, encrypted_content,
               ts_rank(ARRAY[0.1, 0.2, 0.4, 1.0]::float4[],
                       setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', content), 'D'),
                       to_tsquery('english', ${tsq})) as rank,
               strip(to_tsvector('english', title)) = strip(to_tsvector('english', ${query})) as title_exact
        FROM memory_entries
        WHERE user_id = ${userId}
          AND deleted_at IS NULL
          AND status != 'ARCHIVED'
          AND ${validity}
          AND ${classFilter}
          AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsq})
        ORDER BY title_exact DESC, rank DESC, id ASC
        LIMIT ${max}
      `;
    } else {
      results = await prisma.$queryRaw`
        SELECT id, title, content, tags, importance, last_accessed_at, source_weight, domain, encrypted_content,
               ts_rank(ARRAY[0.1, 0.2, 0.4, 1.0]::float4[],
                       setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', content), 'D'),
                       to_tsquery('english', ${tsq})) as rank,
               strip(to_tsvector('english', title)) = strip(to_tsvector('english', ${query})) as title_exact
        FROM memory_entries
        WHERE user_id = ${userId}
          AND deleted_at IS NULL
          AND status != 'ARCHIVED'
          AND ${validity}
          AND ${classFilter}
          AND (importance >= 0.4 OR COALESCE(last_accessed_at, created_at) >= ${cutoff})
          AND to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${tsq})
        ORDER BY title_exact DESC, rank DESC, id ASC
        LIMIT ${max}
      `;
    }

    return results;
  };

  try {
    // Strict pass first: every word must appear (the precise hits). A natural-
    // language question ("which cold email tool handles warmup and domain
    // rotation") rarely has every word in one memory, so the strict pass alone
    // returned nothing and recall depended entirely on embeddings being
    // available. When it returns fewer than `limit`, a ranked any-word pass
    // fills the remaining slots below the strict hits — the strict results are
    // never displaced (2026-10-23 real-data e2e).
    const strict = await runQuery(tsQuery, limit);
    let partial: FtsRow[] = [];
    if (strict.length < limit && tokens.length > 1) {
      const seen = new Set(strict.map(r => r.id));
      partial = (await runQuery(tokens.join(' | '), limit))
        .filter(r => !seen.has(r.id))
        .slice(0, limit - strict.length);
    }

    const toScored = (r: FtsRow, partialMatch: boolean): ScoredResult => ({
      id: r.id,
      type: 'memory' as const,
      content: r.content,
      title: r.title,
      // RD-2: an exact title match is the strongest full-text signal there is
      // (the user typed the note's name). Otherwise the title-weighted rank;
      // partial matches always score below strict ones.
      relevanceScore: r.title_exact === true
        ? 1.0
        : partialMatch ? Math.min(Number(r.rank), 1.0) * 0.5 : Math.min(Number(r.rank), 1.0),
      source: 'fts' as const,
      whyIncluded: r.title_exact === true
        ? `Exact title match for "${query}"`
        : partialMatch ? `Partial full-text match for "${query}"` : `Full-text match for "${query}"`,
      tags: r.tags,
      importance: r.importance,
      lastAccessedAt: r.last_accessed_at,
      sourceWeight: r.source_weight,
    });
    return [
      ...decryptRows(strict).map(r => toScored(r, false)),
      ...decryptRows(partial).map(r => toScored(r, true)),
    ];
  } catch (err) {
    // F-204: FTS may fail if extensions aren't enabled yet — degrade, but
    // log it and report it so the context package is marked degraded.
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('[fts] retrieval layer failed — degrading to []', { error: error.message });
    options.onLayerError?.('fts', error);
    return [];
  }
}

