import type { PrismaClient } from '@prisma/client';
import { DOMAIN_MEMORY_BUDGETS } from '@boardroom/shared';

export interface BudgetResult {
  valid: boolean;
  errors: { field: string; message: string }[];
  currentCount: number;
  limit: number;
}

export async function enforceBudget(
  userId: string,
  domain: string,
  prisma: PrismaClient
): Promise<BudgetResult> {
  const limit = DOMAIN_MEMORY_BUDGETS[domain] ?? DOMAIN_MEMORY_BUDGETS.default;

  const currentCount = await prisma.memoryEntry.count({
    where: {
      userId,
      domain,
      deletedAt: null,
      status: { not: 'ARCHIVED' },
    },
  });

  if (currentCount >= limit) {
    return {
      valid: false,
      errors: [{ field: 'domain', message: `Domain budget exceeded (${currentCount}/${limit})` }],
      currentCount,
      limit,
    };
  }

  return { valid: true, errors: [], currentCount, limit };
}
