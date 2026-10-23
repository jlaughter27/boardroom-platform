import type { PrismaClient } from '@prisma/client';
import { DOMAIN_MEMORY_BUDGETS, type MemoryBudgetStatus } from '@boardroom/shared';
import { logger } from '../../lib/logger';

export interface BudgetResult {
  /** Always true since RD-4: budgets are soft and never block a write. */
  valid: boolean;
  errors: { field: string; message: string }[];
  /** Live memories in the domain BEFORE this write. */
  currentCount: number;
  limit: number;
  /** The write about to happen puts the domain past its limit (currentCount >= limit). */
  overAfterWrite: boolean;
}

/** The soft limit for a domain (`default` for domains without their own entry). */
export function budgetLimitFor(domain: string): number {
  return DOMAIN_MEMORY_BUDGETS[domain] ?? DOMAIN_MEMORY_BUDGETS.default;
}

/** `{ domain, count, limit, over }` for a known count; `over` = count > limit. */
export function budgetStatus(domain: string, count: number): MemoryBudgetStatus {
  const limit = budgetLimitFor(domain);
  return { domain, count, limit, over: count > limit };
}

/**
 * Domain budget check — SOFT (RD-4, 2026-10-23 real-data run).
 *
 * `DOMAIN_MEMORY_BUDGETS` has always been documented as soft ("exceeded
 * triggers curator eviction proposals"), but this step used to return
 * `valid: false`, which the pipeline turned into a hard 422. As an imported
 * vault grew, every write in that domain — MCP `memory_write` included —
 * started failing. Now the write always proceeds; the caller gets the
 * standing back so the API can attach a `budget` warning to the response.
 *
 * There is no curator / eviction-proposal mechanism in the codebase to hand
 * the overage to. Until there is, the overage is recorded as a structured
 * `memory_budget_exceeded` warning log line (one per over-budget write) and
 * is always derivable live from `GET /memories/budget`.
 */
export async function enforceBudget(
  userId: string,
  domain: string,
  prisma: PrismaClient
): Promise<BudgetResult> {
  const limit = budgetLimitFor(domain);

  const currentCount = await prisma.memoryEntry.count({
    where: {
      userId,
      domain,
      deletedAt: null,
      status: { not: 'ARCHIVED' },
    },
  });

  const overAfterWrite = currentCount >= limit;
  if (overAfterWrite) {
    logger.warn('memory_budget_exceeded — write allowed (soft budget)', {
      event: 'memory_budget_exceeded',
      userId,
      domain,
      countBeforeWrite: currentCount,
      limit,
    });
  }

  return { valid: true, errors: [], currentCount, limit, overAfterWrite };
}
