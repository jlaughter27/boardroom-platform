/**
 * RD-1 — GET /memories/:id/backlinks proxies OmniMind for the signed-in user and
 * validates the response shape at the seam.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../src/services/omnimind-client', () => ({
  omnimindClient: {
    getMemoryBacklinks: vi.fn(),
  },
}));

import { omnimindClient } from '../../src/services/omnimind-client';
import { entitiesRouter } from '../../src/routes/entities.routes';

let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).auth = { userId: 'u-backlinks', email: 'b@b.co', teamId: 't1' }; next(); });
  app.use('/', entitiesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(err.status ?? 500).json({ error: 'internal_error', message: err.message }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(() => vi.mocked(omnimindClient.getMemoryBacklinks).mockReset());

describe('GET /memories/:id/backlinks (RD-1)', () => {
  it('forwards the user id + memory id and returns the validated body', async () => {
    const body = { items: [{ memoryId: 'm2', title: 'Pricing', domain: 'business', status: 'CONFIRMED', linkTypes: ['wikilink'] }], truncated: false };
    vi.mocked(omnimindClient.getMemoryBacklinks).mockResolvedValue(body);
    const res = await fetch(`${base}/memories/m1/backlinks`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    expect(omnimindClient.getMemoryBacklinks).toHaveBeenCalledWith('u-backlinks', 'm1');
  });

  it('502s on a drifted upstream shape instead of passing it through', async () => {
    vi.mocked(omnimindClient.getMemoryBacklinks).mockResolvedValue({ backlinks: [] } as never);
    const res = await fetch(`${base}/memories/m1/backlinks`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'bad_upstream_response' });
  });
});
