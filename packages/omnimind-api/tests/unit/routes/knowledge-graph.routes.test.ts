/**
 * RD-6 — GET /graph `memoryLimit` is a validated request parameter (0–1000,
 * default 200) and the response carries `stats.memoryTotal`. Real Express app,
 * Prisma mocked (no database needed).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => {
  const t = () => ({ findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) });
  return {
    goal: t(), project: t(), task: t(), person: t(), decision: t(), commitment: t(), memoryEntry: t(),
    goalProjectLink: t(), projectTaskLink: t(), projectPersonLink: t(), decisionProjectLink: t(),
    taskDependency: t(), memoryEntityLink: t(), commitmentLink: t(),
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: vi.fn(),
  };
});
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const get = (qs: string) => request(app).get(`/graph${qs}`).set('x-api-key', API_KEY).set('x-user-id', USER);

const memories = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `m${i}`, title: `Memory ${i}`, domain: 'business', importance: 1 - i / 1000, status: 'ACTIVE', memoryClass: 'SEMANTIC', createdAt: new Date('2026-10-01T00:00:00Z'),
}));

beforeAll(() => {
  process.env.OMNIMIND_API_KEY = API_KEY;
  __resetApiKeyForTest();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.memoryEntry.findMany.mockResolvedValue([]);
  mockPrisma.memoryEntry.count.mockResolvedValue(0);
});

describe('GET /graph memoryLimit (RD-6)', () => {
  it('defaults to 200 and reports the pre-cap total', async () => {
    mockPrisma.memoryEntry.findMany.mockResolvedValue(memories(200));
    mockPrisma.memoryEntry.count.mockResolvedValue(640);
    const res = await get('');
    expect(res.status).toBe(200);
    expect(mockPrisma.memoryEntry.findMany.mock.calls[0][0].take).toBe(200);
    expect(res.body.stats).toMatchObject({ memoryTotal: 640, memoryLimitHit: true });
    expect(res.body.stats.nodeCounts.memory).toBe(200);
  });

  it('accepts the maximum (1000) and passes it through', async () => {
    mockPrisma.memoryEntry.findMany.mockResolvedValue(memories(640));
    mockPrisma.memoryEntry.count.mockResolvedValue(640);
    const res = await get('?memoryLimit=1000');
    expect(res.status).toBe(200);
    expect(mockPrisma.memoryEntry.findMany.mock.calls[0][0].take).toBe(1000);
    expect(res.body.stats).toMatchObject({ memoryTotal: 640, memoryLimitHit: false });
  });

  it.each(['1001', '-1', '2.5', 'lots'])('422 for memoryLimit=%s and no database read', async (v) => {
    const res = await get(`?memoryLimit=${encodeURIComponent(v)}`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('validation_failed');
    expect(res.body.details[0].field).toBe('memoryLimit');
    expect(mockPrisma.memoryEntry.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.memoryEntry.count).not.toHaveBeenCalled();
  });
});
