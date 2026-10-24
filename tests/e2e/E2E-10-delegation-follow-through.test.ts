/**
 * E2E-10 — RD-12 delegation follow-through, end to end on a real OmniMind +
 * Postgres + MCP stdio server. Invented names only.
 *
 *   person "Sam Rivera" → POST /commitments owedBy=STAKEHOLDER (deadline =
 *   end of tomorrow's UTC day, links.taskId) → PATCH the deadline to the end
 *   of yesterday → GET /commitments/nudges lists it as overdue with owedBy +
 *   stakeholderName → MCP status_get puts it in delegations.overdue (not in
 *   commitmentsDueSoon) → GET /commitments?owedBy=USER does not list it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { endOfUtcDay } from '../../packages/shared/src/utils/date';
import {
  setupHarness,
  teardownHarness,
  resetDatabase,
  startMcpClient,
  seedTestAgents,
  getAgent,
  TEST_USER_ID,
  type Harness,
} from './harness';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

describe('E2E-10: delegation follow-through (RD-12)', () => {
  let harness: Harness;

  const api = async <T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${harness.config.apiBaseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': harness.config.apiKey, 'x-user-id': TEST_USER_ID, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as T };
  };

  beforeAll(async () => {
    harness = await setupHarness();
  }, 60_000);

  afterAll(async () => {
    await teardownHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness);
    await seedTestAgents(harness.prisma);
    // people / tasks / commitments have no FK to users, so TRUNCATE … CASCADE leaves them: clear this user's rows.
    await harness.prisma.commitmentLink.deleteMany({ where: { commitment: { userId: TEST_USER_ID } } });
    await harness.prisma.commitment.deleteMany({ where: { userId: TEST_USER_ID } });
    await harness.prisma.task.deleteMany({ where: { userId: TEST_USER_ID } });
    await harness.prisma.person.deleteMany({ where: { userId: TEST_USER_ID } });
  });

  it('records, nudges, and surfaces a delegation only as "waiting on" everywhere', async () => {
    const person = await api<{ id: string }>('POST', '/people', { name: 'Sam Rivera' });
    expect(person.status).toBe(201);
    const task = await api<{ id: string }>('POST', '/tasks', { title: 'Send the volunteer rota' });
    expect(task.status).toBe(201);

    // A delegation must name who owes it.
    const missing = await api('POST', '/commitments', { description: 'x', owedBy: 'STAKEHOLDER' });
    expect(missing.status).toBe(422);

    const created = await api<{ id: string; owedBy: string; status: string }>('POST', '/commitments', {
      description: 'Send the volunteer rota',
      stakeholderId: person.body.id,
      deadline: endOfUtcDay(ymd(1)).toISOString(),
      owedBy: 'STAKEHOLDER',
      links: { taskId: task.body.id },
    }, { 'Idempotency-Key': `e2e-10-${Date.now()}` });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ owedBy: 'STAKEHOLDER', status: 'OPEN' });

    const links = await harness.prisma.commitmentLink.findMany({ where: { commitmentId: created.body.id } });
    expect(links.map((l) => [l.entityType, l.entityId])).toEqual([['task', task.body.id]]);

    // A plain user-owed commitment, for contrast.
    const mine = await api<{ id: string; owedBy: string }>('POST', '/commitments', { description: 'Book the hall', deadline: endOfUtcDay(ymd(1)).toISOString() });
    expect(mine.body.owedBy).toBe('USER');

    // Slip the delegation into the past.
    const patched = await api('PATCH', `/commitments/${created.body.id}`, { deadline: endOfUtcDay(ymd(-1)).toISOString() });
    expect(patched.status).toBe(200);

    const nudges = await api<{ overdue: any[]; dueSoon: any[] }>('GET', '/commitments/nudges');
    expect(nudges.status).toBe(200);
    const row = nudges.body.overdue.find((c) => c.id === created.body.id);
    expect(row).toMatchObject({ owedBy: 'STAKEHOLDER', stakeholderName: 'Sam Rivera' });
    expect(row).not.toHaveProperty('stakeholder');

    const mcp = await startMcpClient({ agent: getAgent('test-code'), apiBaseUrl: harness.config.apiBaseUrl });
    try {
      const status = await mcp.callTool<any>('status_get', { userId: TEST_USER_ID });
      expect(status.delegations.overdue[0]).toMatchObject({ id: created.body.id, personName: 'Sam Rivera', personId: person.body.id });
      expect(status.delegations.overdue[0].daysOverdue).toBeGreaterThanOrEqual(0);
      expect(status.commitmentsDueSoon.overdue.map((c: { id: string }) => c.id)).not.toContain(created.body.id);
      expect(status.commitmentsDueSoon.dueSoon.map((c: { id: string }) => c.id)).toContain(mine.body.id);
    } finally {
      await mcp.close();
    }

    const own = await api<{ items: Array<{ id: string }> }>('GET', '/commitments?owedBy=USER');
    expect(own.body.items.map((c) => c.id)).toContain(mine.body.id);
    expect(own.body.items.map((c) => c.id)).not.toContain(created.body.id);
    const theirs = await api<{ items: Array<{ id: string }> }>('GET', '/commitments?owedBy=STAKEHOLDER');
    expect(theirs.body.items.map((c) => c.id)).toEqual([created.body.id]);
  });

  it('refuses a person the caller does not own (404 entity person)', async () => {
    const foreign = await harness.prisma.person.create({ data: { userId: 'someone-else-e2e', name: 'Not Yours' } });
    try {
      const res = await api<{ entity: string }>('POST', '/commitments', { description: 'x', stakeholderId: foreign.id, owedBy: 'STAKEHOLDER' });
      expect(res.status).toBe(404);
      expect(res.body.entity).toBe('person');
    } finally {
      await harness.prisma.person.delete({ where: { id: foreign.id } });
    }
  });
});
