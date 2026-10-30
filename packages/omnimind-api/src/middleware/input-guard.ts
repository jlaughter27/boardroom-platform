import type { Request, Response, NextFunction } from 'express';

/**
 * Robustness fixes 2026-10-30 — one guard for every route, mounted after
 * `express.json()`:
 *
 *  - NUL (U+0000) anywhere in the request — a body string or key, a query
 *    value or key, or the path (`%00` in an id). Postgres `text` / `jsonb`
 *    cannot store U+0000, so it used to reach the INSERT / WHERE and come back
 *    as a 500. The schema-level title/content refinements stay as they are.
 *  - JSON bodies nested deeper than {@link MAX_BODY_DEPTH} (e.g. 3000-level
 *    `metadata`), which also surfaced as a 500.
 *
 * Both answer the standard 422 `validation_failed` shape. The walk is
 * iterative, so a hostile body cannot overflow the stack here either.
 */
export const MAX_BODY_DEPTH = 32;

const NUL = '\u0000';
const NUL_MESSAGE = 'must not contain NUL (U+0000) characters';
const MAX_FIELD_LENGTH = 200;

interface Issue {
  field: string;
  message: string;
}

function fieldName(prefix: string | null, path: Array<string | number>): string {
  const joined = [...(prefix ? [prefix] : []), ...path].join('.');
  return joined.length > MAX_FIELD_LENGTH ? `${joined.slice(0, MAX_FIELD_LENGTH)}…` : joined;
}

/** First NUL or over-deep node in `root`, or null. `root` is depth 0. */
export function findInputIssue(root: unknown, prefix: string | null, maxDepth = MAX_BODY_DEPTH): Issue | null {
  const stack: Array<{ value: unknown; path: Array<string | number> }> = [{ value: root, path: [] }];
  while (stack.length > 0) {
    const { value, path } = stack.pop()!;
    if (typeof value === 'string') {
      if (value.includes(NUL)) return { field: fieldName(prefix, path), message: NUL_MESSAGE };
      continue;
    }
    if (value === null || typeof value !== 'object') continue;
    if (path.length >= maxDepth) {
      return { field: fieldName(prefix, path), message: `nesting deeper than ${maxDepth} levels is not allowed` };
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) stack.push({ value: value[i], path: [...path, i] });
    } else {
      for (const [key, child] of Object.entries(value)) {
        if (key.includes(NUL)) return { field: fieldName(prefix, [...path, key.replaceAll(NUL, '\\0')]), message: `key ${NUL_MESSAGE}` };
        stack.push({ value: child, path: [...path, key] });
      }
    }
  }
  return null;
}

export function inputGuard(req: Request, res: Response, next: NextFunction): void {
  // req.path is the raw (still percent-encoded) path, so `%00` in any segment
  // is the only way a path parameter can carry U+0000.
  const issue: Issue | null = /%00/i.test(req.path)
    ? { field: 'path', message: NUL_MESSAGE }
    : findInputIssue(req.query, 'query') ?? findInputIssue(req.body, null);
  if (issue) {
    res.status(422).json({ error: 'validation_failed', details: [issue] });
    return;
  }
  next();
}
