/**
 * C-111 — Goal → Project → Task link routes (GoalProjectLink / ProjectTaskLink).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  goal: { findFirst: vi.fn() },
  project: { findFirst: vi.fn() },
  task: { findFirst: vi.fn() },
  goalProjectLink: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  projectTaskLink: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  $queryRaw: vi.fn().mockResolvedValue([]),
  $disconnect: vi.fn(),
}));
vi.mock('../../../src/lib/db', () => ({ prisma: mockPrisma }));
vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import app from '../../../src/index';
import { __resetApiKeyForTest } from '../../../src/middleware/auth';
import { linkGoalProject, unlinkProjectTask } from '../../../src/services/entity.service';

const API_KEY = 'test-api-key';
const USER = 'cuser00000000000000000001';
const H = { 'x-api-key': API_KEY, 'x-user-id': USER };

beforeAll(() => { process.env.OMNIMIND_API_KEY = API_KEY; __resetApiKeyForTest(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.goal.findFirst.mockResolvedValue({ id: 'g1' });
  mockPrisma.project.findFirst.mockResolvedValue({ id: 'p1' });
  mockPrisma.task.findFirst.mockResolvedValue({ id: 't1' });
});

describe('POST /goals/:goalId/projects/:projectId', () => {
  it('201 {id, goalId, projectId} when the link is created', async () => {
    mockPrisma.goalProjectLink.findUnique.mockResolvedValue(null);
    mockPrisma.goalProjectLink.upsert.mockResolvedValue({ id: 'l1', goalId: 'g1', projectId: 'p1' });
    const res = await request(app).post('/goals/g1/projects/p1').set(H);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'l1', goalId: 'g1', projectId: 'p1' });
    // ownership checks are user + soft-delete scoped
    expect(mockPrisma.goal.findFirst).toHaveBeenCalledWith({ where: { id: 'g1', userId: USER, deletedAt: null }, select: { id: true } });
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', userId: USER, deletedAt: null }, select: { id: true } });
    expect(mockPrisma.goalProjectLink.upsert).toHaveBeenCalledWith({
      where: { goalId_projectId: { goalId: 'g1', projectId: 'p1' } },
      create: { goalId: 'g1', projectId: 'p1' },
      update: {},
    });
  });

  it('200 when the link already exists (idempotent)', async () => {
    mockPrisma.goalProjectLink.findUnique.mockResolvedValue({ id: 'l1', goalId: 'g1', projectId: 'p1' });
    const res = await request(app).post('/goals/g1/projects/p1').set(H);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'l1', goalId: 'g1', projectId: 'p1' });
    expect(mockPrisma.goalProjectLink.upsert).not.toHaveBeenCalled();
  });

  it('404 when the project belongs to another user / is soft-deleted', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/goals/g1/projects/p-foreign').set(H);
    expect(res.status).toBe(404);
    expect(mockPrisma.goalProjectLink.upsert).not.toHaveBeenCalled();
  });

  it('400 without x-user-id', async () => {
    const res = await request(app).post('/goals/g1/projects/p1').set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /goals/:goalId/projects/:projectId', () => {
  it('200 unlinked', async () => {
    mockPrisma.goalProjectLink.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(app).delete('/goals/g1/projects/p1').set(H);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ goalId: 'g1', projectId: 'p1', status: 'unlinked' });
  });
  it('404 when no such link', async () => {
    mockPrisma.goalProjectLink.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(app).delete('/goals/g1/projects/p1').set(H);
    expect(res.status).toBe(404);
  });
});

describe('POST/DELETE /projects/:projectId/tasks/:taskId', () => {
  it('201 {id, projectId, taskId}', async () => {
    mockPrisma.projectTaskLink.findUnique.mockResolvedValue(null);
    mockPrisma.projectTaskLink.upsert.mockResolvedValue({ id: 'l2', projectId: 'p1', taskId: 't1' });
    const res = await request(app).post('/projects/p1/tasks/t1').set(H);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'l2', projectId: 'p1', taskId: 't1' });
  });
  it('404 when the task is not the user\'s', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/projects/p1/tasks/t-foreign').set(H);
    expect(res.status).toBe(404);
  });
  it('DELETE 200 / 404', async () => {
    mockPrisma.projectTaskLink.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await request(app).delete('/projects/p1/tasks/t1').set(H)).status).toBe(200);
    expect((await request(app).delete('/projects/p1/tasks/t1').set(H)).status).toBe(404);
  });
});

describe('service functions', () => {
  it('linkGoalProject returns null when the goal is foreign (no link write)', async () => {
    mockPrisma.goal.findFirst.mockResolvedValue(null);
    expect(await linkGoalProject(USER, 'g-foreign', 'p1', mockPrisma as any)).toBeNull();
    expect(mockPrisma.goalProjectLink.findUnique).not.toHaveBeenCalled();
  });
  it('unlinkProjectTask returns null when nothing was deleted', async () => {
    mockPrisma.projectTaskLink.deleteMany.mockResolvedValue({ count: 0 });
    expect(await unlinkProjectTask(USER, 'p1', 't1', mockPrisma as any)).toBeNull();
  });
});
