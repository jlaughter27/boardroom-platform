import type { PrismaClient } from '@prisma/client';
import type { PipelineResult } from '@boardroom/shared';
import { validateMemorySchema } from './schema-validator';
import { validateTemporalConsistency } from './temporal-validator';
import { enforceBudget } from './budget-enforcer';

export async function runValidationPipeline(
  input: unknown,
  userId: string,
  domain: string,
  prisma: PrismaClient
): Promise<PipelineResult> {
  const start = performance.now();

  // Step 1: Schema validation (sync, no DB)
  const schemaResult = validateMemorySchema(input);
  if (!schemaResult.valid) {
    return { valid: false, errors: schemaResult.errors, durationMs: performance.now() - start };
  }

  // Step 2: Temporal consistency (async, may need DB for supersededBy)
  const parsedInput = input as Record<string, unknown>;
  const temporalResult = await validateTemporalConsistency(
    {
      validAt: parsedInput.validAt ? new Date(parsedInput.validAt as string) : undefined,
      invalidAt: parsedInput.invalidAt ? new Date(parsedInput.invalidAt as string) : null,
      supersededBy: parsedInput.supersededBy as string | null | undefined,
    },
    prisma
  );
  if (!temporalResult.valid) {
    return { valid: false, errors: temporalResult.errors, durationMs: performance.now() - start };
  }

  // Step 3: Budget enforcement (async, needs DB)
  const budgetResult = await enforceBudget(userId, domain, prisma);
  if (!budgetResult.valid) {
    return { valid: false, errors: budgetResult.errors, durationMs: performance.now() - start };
  }

  return { valid: true, errors: [], durationMs: performance.now() - start };
}
