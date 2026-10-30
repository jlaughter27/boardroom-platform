import type { Request, Response, NextFunction } from 'express';
import { OMNIMIND_REFUSAL_HEADER } from '@boardroom/shared';
import { logger } from '../lib/logger';

export interface HttpErrorOptions {
  /**
   * Lane F — a DELIBERATE application-level refusal (e.g. 503 `MINISTRY_DEFERRED`):
   * the response carries `x-omnimind-refusal: 1` so callers neither retry it nor
   * count it toward a circuit breaker. Never set it on an infra failure (DB down,
   * dependency unreachable) — those must still trip the caller's breaker.
   */
  refusal?: boolean;
}

export class HttpError extends Error {
  public readonly refusal: boolean;

  constructor(
    public readonly statusCode: number,
    // Extra fields (e.g. `existingId` on a 409) are spread into the response as-is.
    public readonly body: { code: string; message: string; [extra: string]: unknown },
    options: HttpErrorOptions = {},
  ) {
    super(body.message);
    this.name = 'HttpError';
    this.refusal = options.refusal === true;
  }
}

/** Marks a response as a deliberate refusal (see `HttpErrorOptions.refusal`). */
export function markRefusal(res: Response): void {
  res.setHeader(OMNIMIND_REFUSAL_HEADER, '1');
}

interface MappedClientError {
  status: number;
  error: string;
  message: string;
}

/**
 * Lane F — Postgres SQLSTATE 54000 (`program_limit_exceeded`), e.g. "string is
 * too long for tsvector" when a near-1 MB note's lexemes exceed the 1 MB
 * tsvector limit (the GIN index on `to_tsvector(content)`, or a raw FTS query).
 * Prisma surfaces it as `PrismaClientUnknownRequestError` (model queries: the
 * connector message carries `code: "54000"`) or as `PrismaClientKnownRequestError`
 * P2010 with `meta.code === '54000'` (raw queries). The input is too big, not
 * the server broken.
 */
function isProgramLimitExceeded(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown; meta?: { code?: unknown } | null; message?: unknown };
  if (typeof e?.name !== 'string') return false;
  if (e.name.startsWith('PrismaClientKnownRequestError')) {
    return e.code === 'P2010' && e.meta?.code === '54000';
  }
  if (e.name.startsWith('PrismaClientUnknownRequestError') && typeof e.message === 'string') {
    return /code: "54000"/.test(e.message) || /string is too long for tsvector/.test(e.message);
  }
  return false;
}

/**
 * Errors that describe a bad request rather than a server fault:
 *  - body-parser (`express.json`): `entity.too.large` → 413 `payload_too_large`,
 *    `entity.parse.failed` (malformed JSON, or a bare `null` body in strict
 *    mode) → 400 `invalid_json`, any other exposed 4xx → that status.
 *  - Prisma P2002 (unique constraint) → 409 `conflict`;
 *    P2003 (foreign key, e.g. an unknown `sourceSessionId`) → 422 `invalid_reference`.
 *  - Postgres 54000 (content too large to index, see `isProgramLimitExceeded`)
 *    → 413 `payload_too_large`.
 * Duck-typed so it holds across Prisma client instances and test doubles.
 */
export function mapClientError(err: unknown): MappedClientError | null {
  const e = err as { type?: unknown; status?: unknown; expose?: unknown; code?: unknown; name?: unknown };
  if (typeof e?.type === 'string' && typeof e.status === 'number') {
    if (e.type === 'entity.too.large') {
      return { status: 413, error: 'payload_too_large', message: 'Request body exceeds the 1 MB limit' };
    }
    if (e.type === 'entity.parse.failed') {
      return { status: 400, error: 'invalid_json', message: 'Request body must be a JSON object or array' };
    }
    if (e.expose === true && e.status >= 400 && e.status < 500) {
      return { status: e.status, error: 'bad_request', message: (err as Error).message };
    }
  }
  if (isProgramLimitExceeded(err)) {
    return {
      status: 413,
      error: 'payload_too_large',
      message:
        'Content is too large to index for full-text search (Postgres limits a document to about 1 MB of indexed words); split it into smaller memories',
    };
  }
  if (typeof e?.code === 'string' && typeof e.name === 'string' && e.name.startsWith('PrismaClientKnownRequestError')) {
    if (e.code === 'P2002') {
      return { status: 409, error: 'conflict', message: 'A record with these unique fields already exists' };
    }
    if (e.code === 'P2003') {
      return { status: 422, error: 'invalid_reference', message: 'A referenced record does not exist' };
    }
  }
  return null;
}

export const errorHandler =(err: Error, req: Request, res: Response, _next: NextFunction): void => {
  const requestId = req.headers['x-request-id'] as string | undefined;

  if (err instanceof HttpError) {
    if (err.refusal) markRefusal(res);
    res.status(err.statusCode).json({
      ...err.body,
      ...(requestId && { requestId }),
    });
    return;
  }

  // Robustness fixes 2026-10-30 — malformed input is the caller's error, not a 500.
  const mapped = mapClientError(err);
  if (mapped) {
    res.status(mapped.status).json({
      error: mapped.error,
      message: mapped.message,
      ...(requestId && { requestId }),
    });
    return;
  }

  logger.error('Unhandled error', {
    message: err.message,
    path: req.path,
    method: req.method,
    requestId,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });

  res.status(500).json({
    error: 'internal_error',
    message: process.env.NODE_ENV === 'production' ? 'An internal error occurred' : err.message,
    ...(requestId && { requestId }),
  });
};
