// Lane G item 3 — map body-parser (express.json / express.raw) failures to
// client errors with stable codes, mirroring OmniMind's mapClientError
// (packages/omnimind-api/src/middleware/error-handler.ts). Before this, the
// app error handler labelled them `internal_error` and logged them as
// unhandled server errors.

export interface MappedClientError {
  status: number;
  error: string;
  message: string;
}

/** express.json()'s default limit — app.ts does not override it. */
export const JSON_BODY_LIMIT_LABEL = '100 kB';

export function mapBodyParserError(err: unknown): MappedClientError | null {
  const e = err as { type?: unknown; status?: unknown; expose?: unknown; message?: unknown } | null;
  if (!e || typeof e.type !== 'string' || typeof e.status !== 'number') return null;
  if (e.type === 'entity.too.large') {
    return { status: 413, error: 'payload_too_large', message: `Request body exceeds the ${JSON_BODY_LIMIT_LABEL} limit` };
  }
  if (e.type === 'entity.parse.failed') {
    return { status: 400, error: 'invalid_json', message: 'Request body must be valid JSON' };
  }
  // Other body-parser rejections (unsupported charset / encoding, aborted or
  // truncated body) are 4xx http-errors marked safe to expose.
  if (e.expose === true && e.status >= 400 && e.status < 500) {
    return { status: e.status, error: 'bad_request', message: typeof e.message === 'string' ? e.message : 'Bad request' };
  }
  return null;
}
