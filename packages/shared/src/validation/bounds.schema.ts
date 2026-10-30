// Input-bound helpers shared by request and list-query schemas (robustness
// fixes 2026-10-30). Pure Zod — no runtime deps beyond zod.

import { z } from 'zod';

/**
 * Earliest / latest instant accepted for a user-supplied date. `z.coerce.date()`
 * alone accepts anything a JS Date can hold (±275 760 years), and Postgres
 * `timestamp` cannot store most of that range — the INSERT then surfaced as a
 * 500. Years 1900–9999 cover every real deadline / contact date.
 */
export const MIN_INPUT_DATE = new Date(Date.UTC(1900, 0, 1, 0, 0, 0, 0));
export const MAX_INPUT_DATE = new Date(Date.UTC(9999, 11, 31, 23, 59, 59, 999));

const DATE_RANGE_MESSAGE = 'date must be between 1900-01-01 and 9999-12-31';

/** True when `d` is a valid Date inside [MIN_INPUT_DATE, MAX_INPUT_DATE]. */
export function isInputDateInRange(d: Date): boolean {
  const t = d.getTime();
  return Number.isFinite(t) && t >= MIN_INPUT_DATE.getTime() && t <= MAX_INPUT_DATE.getTime();
}

/** `z.coerce.date()` limited to years 1900–9999. Output type stays `Date`. */
export function boundedDate() {
  return z.coerce.date().refine(isInputDateInRange, { message: DATE_RANGE_MESSAGE });
}

// ── List query-string helpers ──
// Express (qs) hands a query value over as a string, a string[] for a repeated
// or `[]` key, or an object for `a[b]=c`. Every helper below accepts exactly
// one string, so repeated / bracketed params are a 422 instead of reaching
// Prisma as an array. An empty value (`?limit=`) means "not given", as before.

const SINGLE_VALUE = { invalid_type_error: 'must be a single value' };
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

/** One optional string query value (`''` → absent). */
export function queryString() {
  return z.preprocess(emptyToUndefined, z.string(SINGLE_VALUE).optional());
}

/** One optional non-negative integer query value (`''` → absent). */
export function queryNonNegativeInt() {
  return z.preprocess(
    emptyToUndefined,
    z
      .string(SINGLE_VALUE)
      .regex(/^\d+$/, { message: 'must be a non-negative integer' })
      .transform(Number)
      .refine(Number.isSafeInteger, { message: 'must be a safe integer' })
      .optional(),
  );
}

/** One optional date query value, kept as a string (`''` → absent), in the 1900–9999 range. */
export function queryDateString() {
  return z.preprocess(
    emptyToUndefined,
    z
      .string(SINGLE_VALUE)
      .refine((s) => isInputDateInRange(new Date(s)), { message: `must be a valid date; ${DATE_RANGE_MESSAGE}` })
      .optional(),
  );
}

/** One optional enum query value (`''` → absent). */
export function queryEnum<U extends string, T extends Readonly<[U, ...U[]]>>(values: T, message?: string) {
  return z.preprocess(
    emptyToUndefined,
    z.enum(values, message ? { errorMap: () => ({ message }) } : undefined).optional(),
  );
}

/** One optional TypeScript-enum query value (`''` → absent); output keeps the enum type. */
export function queryNativeEnum<T extends z.EnumLike>(values: T, message?: string) {
  return z.preprocess(
    emptyToUndefined,
    z.nativeEnum(values, message ? { errorMap: () => ({ message }) } : undefined).optional(),
  );
}

/** `?flag=true` (any case) → true; any other single value or absent → false. */
export function queryFlag() {
  return z
    .string(SINGLE_VALUE)
    .optional()
    .transform((s) => typeof s === 'string' && s.toLowerCase() === 'true');
}
