/**
 * Track C — Wave 2 critical-path test (admin route auth guard).
 *
 * Depends on Track A: ADM-01 (admin role middleware + admin.routes.ts)
 * per docs/_audits/2026-05-15-launch-prep/02-backend-routes.md.
 *
 * The admin router and its `requireAdmin` middleware DO NOT EXIST YET in
 *   packages/boardroom-ai/server/src/routes/
 *   packages/boardroom-ai/server/src/middleware/
 *
 * All cases here are `.skip`-ed until Track A's PR lands. They document
 * the intended contract:
 *
 *   - no auth cookie       -> 401 unauthorized
 *   - valid user, non-admin -> 403 forbidden
 *   - valid admin           -> 200 proxied to OmniMind
 */
import { describe, it, expect, vi } from 'vitest';

describe.skip('admin routes — auth guard (ADM-01, depends on Track A)', () => {
  it('returns 401 when request has no auth cookie', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    // const { adminRouter } = await import('../../src/routes/admin.routes');
    // const { requireAuth } = await import('../../src/middleware/auth');
    const app = express();
    // app.use(requireAuth);
    // app.use('/admin', adminRouter);

    const res = await request(app).get('/admin/users');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated user does not have admin role', async () => {
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    // Stub auth middleware to inject a non-admin AuthRequest
    const app = express();
    app.use((req, _res, next) => {
      (req as any).auth = { userId: 'u-1', email: 'u@u.com', teamId: 't-1', role: 'USER' };
      next();
    });
    // const { adminRouter } = await import('../../src/routes/admin.routes');
    // app.use('/admin', adminRouter);

    const res = await request(app).get('/admin/users');
    expect(res.status).toBe(403);
  });

  it('proxies to OmniMind when the user is admin', async () => {
    vi.mock('../../src/services/omnimind-client', () => ({
      omnimindClient: {
        listUsers: vi.fn().mockResolvedValue({ items: [] }),
      },
    }));
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const app = express();
    app.use((req, _res, next) => {
      (req as any).auth = { userId: 'admin-1', email: 'a@a.com', teamId: 't-1', role: 'ADMIN' };
      next();
    });
    // const { adminRouter } = await import('../../src/routes/admin.routes');
    // app.use('/admin', adminRouter);

    const res = await request(app).get('/admin/users');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
  });
});
