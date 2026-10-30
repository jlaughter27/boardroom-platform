/**
 * GET /projects?include=links — each listed project carries `goalIds` and
 * `taskIds` (GoalProjectLink / ProjectTaskLink, soft-deleted ends excluded) so
 * the Goals & Projects tree can group by real links instead of by domain.
 * Invented data only.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { ProjectWithLinksSchema } from '@boardroom/shared';

const mockPrisma = vi.hoisted(() => ({
  project: { findMany: vi.fn(), count: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
  $disconnect: vi.fn(),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const H = { 'x-api-key': API_KEY, 'x-user-id': USER };

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, userId: USER, title: `Project ${id}`, status: 'active', deadline: null, successMetrics: [], domain: 'business',
  version: 1, deletedAt: null, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'), ...extra,
});

beforeAll(() => { process.env.OMNIMIND_API_KEY = API_KEY; __resetApiKeyForTest(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.project.count.mockResolvedValue(2);
});

describe('GET /projects?include=links', () => {
  it('returns goalIds / taskIds per project, matching ProjectWithLinksSchema', async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      row('p1', { goalLinks: [{ goalId: 'g1' }], taskLinks: [{ taskId: 't1' }, { taskId: 't2' }] }),
      row('p2', { goalLinks: [], taskLinks: [] }),
    ]);
    const res = await request(app).get('/projects?include=links&limit=100').set(H);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((p: any) => [p.id, p.goalIds, p.taskIds])).toEqual([['p1', ['g1'], ['t1', 't2']], ['p2', [], []]]);
    expect(res.body.items[0]).not.toHaveProperty('goalLinks');
    expect(res.body.items[0]).not.toHaveProperty('taskLinks');
    for (const item of res.body.items) expect(ProjectWithLinksSchema.safeParse(item).success).toBe(true);

    const args = mockPrisma.project.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: USER, deletedAt: null });
    expect(args.take).toBe(100);
    expect(args.include).toEqual({
      goalLinks: { where: { goal: { deletedAt: null } }, select: { goalId: true } },
      taskLinks: { where: { task: { deletedAt: null } }, select: { taskId: true } },
    });
  });

  it('without include=links the list is unchanged (no joins, no id arrays)', async () => {
    mockPrisma.project.findMany.mockResolvedValue([row('p1')]);
    const res = await request(app).get('/projects?include=tasks').set(H);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).not.toHaveProperty('goalIds');
    expect(mockPrisma.project.findMany.mock.calls[0][0]).not.toHaveProperty('include');
  });
});
