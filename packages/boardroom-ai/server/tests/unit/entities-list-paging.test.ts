/**
 * Entity lists are paged by OmniMind (default 20, max 100). The BoardRoom
 * proxy used to drop the query string, so the browser could never ask for
 * more than the first 20 people / projects / tasks / decisions / commitments.
 * The proxy now forwards validated `limit` / `offset` (and `include=links` on
 * /projects). Invented data only.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    listGoals: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 })),
    listProjects: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 })),
    listTasks: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 })),
    listPeople: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 })),
    listDecisions: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 })),
    listCommitments: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 })),
  },
}));

import { omnimindClient } from '../../src/services/omnimind-client';
import { entitiesRouter } from '../../src/routes/entities.routes';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).auth = { userId: 'u-paging', email: 'p@b.co', teamId: 't1' }; next(); });
  app.use('/', entitiesRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(() => vi.clearAllMocks());

const cases = [
  ['/goals', 'listGoals'],
  ['/projects', 'listProjects'],
  ['/tasks', 'listTasks'],
  ['/people', 'listPeople'],
  ['/decisions', 'listDecisions'],
  ['/commitments', 'listCommitments'],
] as const;

describe('GET entity lists forward paging to OmniMind', () => {
  it.each(cases)('%s?limit=100&offset=200 → limit/offset forwarded', async (path, method) => {
    const res = await fetch(`${base}${path}?limit=100&offset=200`);
    expect(res.status).toBe(200);
    expect(omnimindClient[method]).toHaveBeenCalledWith('u-paging', { limit: '100', offset: '200' });
  });

  it.each(cases)('%s without a query → no paging params (OmniMind default)', async (path, method) => {
    await fetch(`${base}${path}`);
    expect(omnimindClient[method]).toHaveBeenCalledWith('u-paging', {});
  });

  it('drops malformed values and clamps limit to OmniMind\'s max of 100', async () => {
    await fetch(`${base}/people?limit=abc&offset=-5`);
    expect(omnimindClient.listPeople).toHaveBeenCalledWith('u-paging', {});
    await fetch(`${base}/people?limit=5000&offset=40`);
    expect(omnimindClient.listPeople).toHaveBeenLastCalledWith('u-paging', { limit: '100', offset: '40' });
  });

  it('/projects forwards include=links and nothing else on include', async () => {
    await fetch(`${base}/projects?include=links&limit=100`);
    expect(omnimindClient.listProjects).toHaveBeenCalledWith('u-paging', { limit: '100', include: 'links' });
    await fetch(`${base}/projects?include=tasks`);
    expect(omnimindClient.listProjects).toHaveBeenLastCalledWith('u-paging', {});
  });
});
