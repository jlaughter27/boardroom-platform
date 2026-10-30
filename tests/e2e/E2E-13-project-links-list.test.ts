/**
 * E2E-13 — GET /projects?include=links on a real OmniMind + Postgres: each
 * project carries the goal / task ids it is actually linked to (GoalProjectLink
 * / ProjectTaskLink), soft-deleted ends excluded. The Goals & Projects tree is
 * built from these. Invented data only.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupHarness, teardownHarness, resetDatabase, TEST_USER_ID, type Harness } from './harness';

describe('E2E-13: project link ids on the project list', () => {
  let harness: Harness;

  const api = async <T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${harness.config.apiBaseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': harness.config.apiKey, 'x-user-id': TEST_USER_ID },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as T };
  };

  const clearUserEntities = async () => {
    const p = harness.prisma;
    await p.goalProjectLink.deleteMany({ where: { goal: { userId: TEST_USER_ID } } });
    await p.projectTaskLink.deleteMany({ where: { project: { userId: TEST_USER_ID } } });
    await p.task.deleteMany({ where: { userId: TEST_USER_ID } });
    await p.project.deleteMany({ where: { userId: TEST_USER_ID } });
    await p.goal.deleteMany({ where: { userId: TEST_USER_ID } });
  };

  beforeAll(async () => {
    harness = await setupHarness();
  }, 60_000);

  afterAll(async () => {
    await clearUserEntities();
    await teardownHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness);
    await clearUserEntities();
  });

  it('returns only real links, per project', async () => {
    const goal = (await api<{ id: string }>('POST', '/goals', { title: 'Grow the bakery', domain: 'business' })).body;
    const otherGoal = (await api<{ id: string }>('POST', '/goals', { title: 'Run a half marathon', domain: 'business' })).body;
    const stall = (await api<{ id: string }>('POST', '/projects', { title: 'Saturday market stall', domain: 'business' })).body;
    const loose = (await api<{ id: string }>('POST', '/projects', { title: 'Loose project', domain: 'business' })).body;
    const t1 = (await api<{ id: string }>('POST', '/tasks', { title: 'Book the pitch' })).body;
    const t2 = (await api<{ id: string }>('POST', '/tasks', { title: 'Buy a gazebo' })).body;
    const gone = (await api<{ id: string }>('POST', '/tasks', { title: 'Deleted task' })).body;
    await api<{ id: string }>('POST', '/tasks', { title: 'Unlinked task' });

    expect((await api('POST', `/goals/${goal.id}/projects/${stall.id}`)).status).toBe(201);
    for (const t of [t1, t2, gone]) expect((await api('POST', `/projects/${stall.id}/tasks/${t.id}`)).status).toBe(201);
    expect((await api('DELETE', `/tasks/${gone.id}`)).status).toBe(200);

    const res = await api<{ items: Array<{ id: string; goalIds: string[]; taskIds: string[] }>; total: number }>('GET', '/projects?include=links&limit=100');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const byId = new Map(res.body.items.map((p) => [p.id, p]));
    expect(byId.get(stall.id)!.goalIds).toEqual([goal.id]);
    expect([...byId.get(stall.id)!.taskIds].sort()).toEqual([t1.id, t2.id].sort());
    expect(byId.get(loose.id)).toMatchObject({ goalIds: [], taskIds: [] });
    expect(byId.get(stall.id)!.goalIds).not.toContain(otherGoal.id);

    const plain = await api<{ items: Array<Record<string, unknown>> }>('GET', '/projects');
    expect(plain.body.items[0]).not.toHaveProperty('goalIds');
  });
});
