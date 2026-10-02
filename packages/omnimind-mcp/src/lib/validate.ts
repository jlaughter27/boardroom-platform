import { z, ZodError } from 'zod';
import { McpValidationError } from '../types';

/**
 * M-109 — Parse tool input and convert a ZodError into McpValidationError so
 * the VALIDATION_ERROR branch in server.ts is actually reachable. Tools call
 * this instead of `Schema.parse(raw)`.
 */
export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw toValidationError(result.error);
}

export function toValidationError(err: ZodError): McpValidationError {
  const issues = err.issues.map(i => ({
    path: i.path.join('.') || '(root)',
    message: i.message,
  }));
  const message = `Invalid tool input: ${issues.map(i => `${i.path}: ${i.message}`).join('; ')}`;
  return new McpValidationError(message, issues);
}
