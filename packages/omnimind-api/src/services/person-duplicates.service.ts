import type { PrismaClient, Person } from '@prisma/client';

/**
 * Phase 6 (A2) — probable duplicate people.
 *
 * `pg_trgm similarity(a.name, b.name) >= threshold` over the user's live
 * (not soft-deleted) people, each unordered pair once (`a.id < b.id`).
 * Person has no email column, so the match is name-only. No auto-merge —
 * the UI shows a banner and the user decides.
 *
 * Person rows are user-scoped (no tenant column), so the query is user-scoped
 * like the rest of the /people surface.
 */

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;
const MAX_PAIRS = 200;
const DEFAULT_PAIRS = 100;

export interface DuplicatePair {
  a: Person;
  b: Person;
  similarity: number;
}

export interface DuplicatePeopleOptions {
  /** 0.3..1 — defaults to 0.6 (contract). */
  threshold?: number;
  /** Max pairs returned, ≤200 (default 100). */
  limit?: number;
}

interface PairRow { a_id: string; b_id: string; similarity: number }

export async function findDuplicatePeople(
  userId: string,
  opts: DuplicatePeopleOptions,
  prisma: PrismaClient,
): Promise<{ pairs: DuplicatePair[] }> {
  const threshold = clamp(opts.threshold ?? DUPLICATE_SIMILARITY_THRESHOLD, 0.3, 1);
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? DEFAULT_PAIRS), 1), MAX_PAIRS);

  const rows = await prisma.$queryRaw<PairRow[]>`
    SELECT a.id AS a_id, b.id AS b_id, similarity(a.name, b.name)::float8 AS similarity
    FROM people a
    JOIN people b
      ON b.user_id = a.user_id
     AND a.id < b.id
     AND b.deleted_at IS NULL
    WHERE a.user_id = ${userId}
      AND a.deleted_at IS NULL
      AND similarity(a.name, b.name) >= ${threshold}
    ORDER BY similarity DESC, a.id, b.id
    LIMIT ${limit}
  `;
  if (rows.length === 0) return { pairs: [] };

  const ids = Array.from(new Set(rows.flatMap(r => [r.a_id, r.b_id])));
  const people = await prisma.person.findMany({ where: { id: { in: ids }, userId, deletedAt: null } });
  const byId = new Map(people.map(p => [p.id, p]));

  const pairs: DuplicatePair[] = [];
  for (const r of rows) {
    const a = byId.get(r.a_id);
    const b = byId.get(r.b_id);
    if (!a || !b) continue; // raced with a delete
    pairs.push({ a, b, similarity: Number(r.similarity) });
  }
  return { pairs };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}
