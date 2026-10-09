import { Prisma } from '@prisma/client';

/**
 * Phase 6 — temporal validity filters shared by all four retrieval layers.
 *
 * Research §1: `validAt/invalidAt` answers "was this true at time T";
 * importance decay answers "how salient". Retrieval previously applied only
 * the forgetting curve. Now:
 *   - with `asOf`: `valid_at <= asOf AND (invalid_at IS NULL OR invalid_at > asOf)`
 *   - without:     `(invalid_at IS NULL OR invalid_at > now())`
 *
 * `temporalValiditySql` is a `Prisma.Sql` fragment nested inside the layers'
 * tagged-template `$queryRaw` calls — every value stays a bound parameter.
 * `temporalValidityWhere` is the equivalent Prisma `where` fragment for the
 * ORM-based structured filter.
 */

export function parseAsOf(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function temporalValiditySql(asOf?: Date | null): Prisma.Sql {
  if (asOf) {
    return Prisma.sql`(valid_at <= ${asOf} AND (invalid_at IS NULL OR invalid_at > ${asOf}))`;
  }
  return Prisma.sql`(invalid_at IS NULL OR invalid_at > NOW())`;
}

export function temporalValidityWhere(asOf?: Date | null, now: Date = new Date()): Prisma.MemoryEntryWhereInput {
  if (asOf) {
    return {
      validAt: { lte: asOf },
      OR: [{ invalidAt: null }, { invalidAt: { gt: asOf } }],
    };
  }
  return { OR: [{ invalidAt: null }, { invalidAt: { gt: now } }] };
}

/**
 * Phase 6 (lane B request): optional `memory_class` predicate shared by the
 * raw-SQL layers. Returns `TRUE` when absent so it can always be nested after
 * `AND`. Compared as text so no enum cast is needed.
 */
export function memoryClassSql(memoryClass?: string | null): Prisma.Sql {
  return memoryClass ? Prisma.sql`memory_class::text = ${memoryClass}` : Prisma.sql`TRUE`;
}
