/**
 * Phase 6 (A2) — link writers: ProjectPersonLink, DecisionProjectLink,
 * TaskDependency. Ownership + soft-delete scoping, idempotency on the unique
 * pair, self-dependency / direct-cycle rejection, 204 unlink.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  goal: { findFirst: vi.fn() },
  project: { findFirst: vi.fn() },
  task: { findFirst: vi.fn() },
  person: { findFirst: vi.fn() },
  decision: { findFirst: vi.fn() },
  projectPersonLink: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  decisionProjectLink: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  taskDependency: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  idempotencyKey: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
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

beforeAll(() => { process.env.OMNIMIND_API_KEY = API_KEY; __resetApiKeyForTest(); });
beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.project.findFirst.mockResolvedValue({ id: 'p1' });
  mockPrisma.person.findFirst.mockResolvedValue({ id: 'u1' });
  mockPrisma.decision.findFirst.mockResolvedValue({ id: 'd1' });
  mockPrisma.task.findFirst.mockResolvedValue({ id: 't1' });
  mockPrisma.taskDependency.findUnique.mockResolvedValue(null);
  mockPrisma.idempotencyKey.deleteMany.mockResolvedValue({ count: 0 });
});

describe('POST /projects/:projectId/people/:personId', () => {
  it('201 {id, projectId, personId, role} when created; ownership checks are user + soft-delete scoped', async () => {
    mockPrisma.projectPersonLink.findUnique.mockResolvedValue(null);
    mockPrisma.projectPersonLink.upsert.mockResolvedValue({ id: 'l1', projectId: 'p1', personId: 'u1', role: 'advisor' });
    const res = await request(app).post('/projects/p1/people/u1').set(H).send({ role: 'advisor' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'l1', projectId: 'p1', personId: 'u1', role: 'advisor' });
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', userId: USER, deletedAt: null }, select: { id: true } });
    expect(mockPrisma.person.findFirst).toHaveBeenCalledWith({ where: { id: 'u1', userId: USER, deletedAt: null }, select: { id: true } });
    expect(mockPrisma.projectPersonLink.upsert).toHaveBeenCalledWith({
      where: { projectId_personId: { projectId: 'p1', personId: 'u1' } },
      create: { projectId: 'p1', personId: 'u1', role: 'advisor' },
      update: {},
    });
  });

  it('201 with empty role when no body is sent', async () => {
    mockPrisma.projectPersonLink.findUnique.mockResolvedValue(null);
    mockPrisma.projectPersonLink.upsert.mockResolvedValue({ id: 'l1', projectId: 'p1', personId: 'u1', role: '' });
    const res = await request(app).post('/projects/p1/people/u1').set(H);
    expect(res.status).toBe(201);
    expect(mockPrisma.projectPersonLink.upsert.mock.calls[0][0].create).toEqual({ projectId: 'p1', personId: 'u1', role: '' });
  });

  it('200 when the link already exists (idempotent, same role → no write)', async () => {
    mockPrisma.projectPersonLink.findUnique.mockResolvedValue({ id: 'l1', projectId: 'p1', personId: 'u1', role: 'advisor' });
    const res = await request(app).post('/projects/p1/people/u1').set(H).send({ role: 'advisor' });
    expect(res.status).toBe(200);
    expect(mockPrisma.projectPersonLink.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.projectPersonLink.update).not.toHaveBeenCalled();
  });

  it('200 and updates the role when the link exists with a different role', async () => {
    mockPrisma.projectPersonLink.findUnique.mockResolvedValue({ id: 'l1', projectId: 'p1', personId: 'u1', role: '' });
    mockPrisma.projectPersonLink.update.mockResolvedValue({ id: 'l1', projectId: 'p1', personId: 'u1', role: 'lead' });
    const res = await request(app).post('/projects/p1/people/u1').set(H).send({ role: 'lead' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('lead');
    expect(mockPrisma.projectPersonLink.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { role: 'lead' } });
  });

  it('404 when the person is foreign / soft-deleted', async () => {
    mockPrisma.person.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/projects/p1/people/u-foreign').set(H).send({});
    expect(res.status).toBe(404);
    expect(mockPrisma.projectPersonLink.upsert).not.toHaveBeenCalled();
  });

  it('422 on an unknown body field', async () => {
    const res = await request(app).post('/projects/p1/people/u1').set(H).send({ rol: 'x' });
    expect(res.status).toBe(422);
  });

  it('400 without x-user-id', async () => {
    const res = await request(app).post('/projects/p1/people/u1').set('x-api-key', API_KEY);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /projects/:projectId/people/:personId', () => {
  it('204 when unlinked', async () => {
    mockPrisma.projectPersonLink.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(app).delete('/projects/p1/people/u1').set(H);
    expect(res.status).toBe(204);
    expect(mockPrisma.projectPersonLink.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1', personId: 'u1' } });
  });
  it('404 when no such link', async () => {
    mockPrisma.projectPersonLink.deleteMany.mockResolvedValue({ count: 0 });
    const res = await request(app).delete('/projects/p1/people/u1').set(H);
    expect(res.status).toBe(404);
  });
  it('404 when the project is not the user\'s (no delete attempted)', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    const res = await request(app).delete('/projects/p-foreign/people/u1').set(H);
    expect(res.status).toBe(404);
    expect(mockPrisma.projectPersonLink.deleteMany).not.toHaveBeenCalled();
  });
});

describe('POST/DELETE /projects/:projectId/decisions/:decisionId', () => {
  it('201 {id, decisionId, projectId} when created', async () => {
    mockPrisma.decisionProjectLink.findUnique.mockResolvedValue(null);
    mockPrisma.decisionProjectLink.upsert.mockResolvedValue({ id: 'l2', decisionId: 'd1', projectId: 'p1' });
    const res = await request(app).post('/projects/p1/decisions/d1').set(H);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'l2', decisionId: 'd1', projectId: 'p1' });
    expect(mockPrisma.decision.findFirst).toHaveBeenCalledWith({ where: { id: 'd1', userId: USER, deletedAt: null }, select: { id: true } });
  });
  it('200 when it already existed', async () => {
    mockPrisma.decisionProjectLink.findUnique.mockResolvedValue({ id: 'l2', decisionId: 'd1', projectId: 'p1' });
    const res = await request(app).post('/projects/p1/decisions/d1').set(H);
    expect(res.status).toBe(200);
    expect(mockPrisma.decisionProjectLink.upsert).not.toHaveBeenCalled();
  });
  it('404 when the decision is foreign', async () => {
    mockPrisma.decision.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/projects/p1/decisions/d-foreign').set(H);
    expect(res.status).toBe(404);
  });
  it('DELETE → 204 / 404', async () => {
    mockPrisma.decisionProjectLink.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await request(app).delete('/projects/p1/decisions/d1').set(H)).status).toBe(204);
    expect((await request(app).delete('/projects/p1/decisions/d1').set(H)).status).toBe(404);
  });
});

describe('POST /tasks/:taskId/depends-on/:otherTaskId', () => {
  it('201 {id, taskId, dependsOnTaskId} when created; checks the reverse edge first', async () => {
    mockPrisma.taskDependency.upsert.mockResolvedValue({ id: 'dep1', taskId: 't1', dependsOnTaskId: 't2' });
    const res = await request(app).post('/tasks/t1/depends-on/t2').set(H);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'dep1', taskId: 't1', dependsOnTaskId: 't2' });
    expect(mockPrisma.task.findFirst).toHaveBeenCalledTimes(2);
    expect(mockPrisma.taskDependency.findUnique).toHaveBeenCalledWith({
      where: { taskId_dependsOnTaskId: { taskId: 't2', dependsOnTaskId: 't1' } },
    });
  });

  it('200 when the dependency already exists', async () => {
    mockPrisma.taskDependency.findUnique.mockResolvedValueOnce({ id: 'dep1', taskId: 't1', dependsOnTaskId: 't2' });
    const res = await request(app).post('/tasks/t1/depends-on/t2').set(H);
    expect(res.status).toBe(200);
    expect(mockPrisma.taskDependency.upsert).not.toHaveBeenCalled();
  });

  it('422 on a self-dependency (no DB access)', async () => {
    const res = await request(app).post('/tasks/t1/depends-on/t1').set(H);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('validation_failed');
    expect(mockPrisma.task.findFirst).not.toHaveBeenCalled();
  });

  it('409 dependency_cycle when the reverse edge exists', async () => {
    mockPrisma.taskDependency.findUnique
      .mockResolvedValueOnce(null) // forward edge
      .mockResolvedValueOnce({ id: 'rev', taskId: 't2', dependsOnTaskId: 't1' }); // reverse edge
    const res = await request(app).post('/tasks/t1/depends-on/t2').set(H);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('dependency_cycle');
    expect(mockPrisma.taskDependency.upsert).not.toHaveBeenCalled();
  });

  it('404 when either task is foreign / soft-deleted', async () => {
    mockPrisma.task.findFirst.mockResolvedValueOnce({ id: 't1' }).mockResolvedValueOnce(null);
    const res = await request(app).post('/tasks/t1/depends-on/t-foreign').set(H);
    expect(res.status).toBe(404);
  });

  it('DELETE → 204 / 404', async () => {
    mockPrisma.taskDependency.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await request(app).delete('/tasks/t1/depends-on/t2').set(H)).status).toBe(204);
    expect((await request(app).delete('/tasks/t1/depends-on/t2').set(H)).status).toBe(404);
  });
});
