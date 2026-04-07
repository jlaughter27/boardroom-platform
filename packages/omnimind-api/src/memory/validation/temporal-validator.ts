import type { PrismaClient } from '@prisma/client';

export interface TemporalValidationResult {
  valid: boolean;
  errors: { field: string; message: string }[];
}

export async function validateTemporalConsistency(
  input: {
    validAt?: Date;
    invalidAt?: Date | null;
    supersededBy?: string | null;
  },
  prisma: PrismaClient
): Promise<TemporalValidationResult> {
  const errors: { field: string; message: string }[] = [];

  // validAt must be set (Prisma defaults to now(), but validate if provided)
  if (input.validAt && input.invalidAt) {
    if (input.invalidAt <= input.validAt) {
      errors.push({ field: 'invalidAt', message: 'invalidAt must be after validAt' });
    }
  }

  // If supersededBy is set, the target memory must exist
  if (input.supersededBy) {
    const target = await prisma.memoryEntry.findUnique({
      where: { id: input.supersededBy },
      select: { id: true },
    });
    if (!target) {
      errors.push({ field: 'supersededBy', message: `Superseding memory ${input.supersededBy} not found` });
    }
  }

  return { valid: errors.length === 0, errors };
}
