import { CreateMemoryRequestSchema } from '@boardroom/shared';
import type { ValidationResult } from '@boardroom/shared';

export function validateMemorySchema(input: unknown): ValidationResult {
  const result = CreateMemoryRequestSchema.safeParse(input);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
