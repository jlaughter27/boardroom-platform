import type { PrismaClient } from '@prisma/client';
import type { ScoredResult } from '@boardroom/shared';
import { archiveCutoffDate } from './forgetting-curve';
import { tryDecryptMemory } from '../lib/memory-crypto';
import { temporalValidityWhere } from './temporal-validity';

export type { ScoredResult };

export interface StructuredFilterOptions {
  domain?: string;
  tags?: string[];
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
}

export async function structuredFilter(
  userId: string,
  query: string,
  options: StructuredFilterOptions,
  prisma: PrismaClient
): Promise<ScoredResult[]> {
  const includeArchived = options.includeArchived ?? false;
  const archiveCutoff = archiveCutoffDate();

  // Safer default: no tenant + no explicit cross-tenant flag => return 0 results.
  if (!options.tenantId && !options.includeAllTenants) return [];

  const where: Record<string, unknown> = {
    userId,
    deletedAt: null,
    status: { not: 'ARCHIVED' },
  };
  if (options.tenantId) {
    where.tenantId = options.tenantId;
  }

  // Forgetting curve: exclude low-importance memories not touched in 90 days
  // unless caller explicitly opts in with includeArchived.
  // O-103: "touched" = COALESCE(lastAccessedAt, createdAt) — a never-recalled
  // memory counts from its creation date instead of being invisible.
  if (!includeArchived) {
    where.OR = [
      { importance: { gte: 0.4 } },
      { lastAccessedAt: { gte: archiveCutoff } },
      { lastAccessedAt: null, createdAt: { gte: archiveCutoff } },
    ];
  }

  if (options.domain) where.domain = options.domain;
  if (options.memoryClass) where.memoryClass = options.memoryClass;
  if (options.tags && options.tags.length > 0) {
    where.tags = { hasSome: options.tags };
  }
  // Simple contains match for structured filter
  if (query) {
    const contentFilter = [
      { title: { contains: query, mode: 'insensitive' } },
      { content: { contains: query, mode: 'insensitive' } },
    ];
    // Merge with existing OR clause if present (forgetting curve)
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: contentFilter }];
      delete where.OR;
    } else {
      where.OR = contentFilter;
    }
  }


  // Phase 6: temporal validity. Pushed into AND so it never collides with the
  // forgetting-curve / content OR clauses built above.
  const validity = temporalValidityWhere(options.asOf);
  where.AND = [...((where.AND as unknown[] | undefined) ?? []), validity];

  const results = await prisma.memoryEntry.findMany({
    where: where as any,
    take: options.limit ?? 20,
    orderBy: { importance: 'desc' },
    select: {
      id: true, content: true, title: true, tags: true,
      importance: true, lastAccessedAt: true, sourceWeight: true,
      domain: true, encryptedContent: true,
    },
  });

  const out: ScoredResult[] = [];
  for (const r of results) {
    // O-111: decrypt ministry rows; drop (already logged) rows that fail.
    const dec = tryDecryptMemory(r);
    if (!dec) continue;
    out.push({
      id: dec.id,
      type: 'memory' as const,
      content: dec.content,
      title: dec.title,
      relevanceScore: 1.0, // Exact structured match
      source: 'structured' as const,
      whyIncluded: `Structured match${options.domain ? ` in domain "${options.domain}"` : ''}`,
      tags: dec.tags,
      importance: dec.importance,
      lastAccessedAt: dec.lastAccessedAt,
      sourceWeight: dec.sourceWeight,
    });
  }
  return out;
}
