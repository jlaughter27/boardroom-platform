/**
 * Track C — Wave 2 critical-path test (Express error-handler middleware).
 *
 * Audit reference: 05-test-coverage.md §5 row 9.
 *
 * `packages/boardroom-ai/server/src/middleware/error-handler.ts` does
 * not yet exist as a dedicated module. The intended contract:
 *
 *   - HttpError instances (or `err.statusCode`) -> use that status code
 *     and the err.message in the JSON body.
 *   - Unknown / non-HttpError thrown values     -> 500 with a generic
 *     "Internal server error" message and NO stack trace in the
 *     response body, even in production.
 *   - Correlation id (x-request-id) is preserved on the response when
 *     present on the request.
 *
 * Tests are `.skip`-ed until the module is added by Track A.
 */
import { describe, it, expect, vi } from 'vitest';

describe.skip('error-handler middleware (depends on Track A)', () => {
  it('returns the HttpError status + message for 4xx errors', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    // const { errorHandler } = await import('../../src/middleware/error-handler');
    // const { HttpError } = await import('../../src/lib/errors');

    const app = express();
    app.get('/boom', (_req, _res, next) => {
      // next(new HttpError(404, 'not found'));
      const e: any = new Error('not found');
      e.statusCode = 404;
      next(e);
    });
    // app.use(errorHandler);

    const res = await request(app).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('not found');
  });

  it('returns 500 + generic message for unknown errors and does not leak stack traces', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    // const { errorHandler } = await import('../../src/middleware/error-handler');

    const app = express();
    app.get('/explode', (_req, _res, next) => {
      next(new Error('detailed internal error with secrets'));
    });
    // app.use(errorHandler);

    const res = await request(app).get('/explode');
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/internal server error/i);
    expect(res.body.stack).toBeUndefined();
    // Specifically, the raw error message must not leak.
    expect(JSON.stringify(res.body)).not.toContain('secrets');
  });

  it('preserves x-request-id correlation header on error responses', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    // const { errorHandler } = await import('../../src/middleware/error-handler');

    const app = express();
    app.use((req, res, next) => {
      const id = req.headers['x-request-id'];
      if (id) res.setHeader('x-request-id', id);
      next();
    });
    app.get('/explode', (_req, _res, next) => next(new Error('boom')));
    // app.use(errorHandler);

    const res = await request(app).get('/explode').set('x-request-id', 'corr-123');
    expect(res.headers['x-request-id']).toBe('corr-123');
  });
});
