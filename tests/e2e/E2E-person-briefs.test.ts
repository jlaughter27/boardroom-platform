/**
 * E2E — RD-13: `POST /people/briefs` against a real Postgres + the real
 * OmniMind API. Synthetic names only.
 *
 * 1. Functional: one person with an open commitment, a task they own, a
 *    linked project with a linked decision and a linked memory → every
 *    section renders, the headline starts "You owe Avery 1", agent callers
 *    get 403, and a title-only small meeting matches by first name.
 * 2. Performance: 300 people, 2,000 memories (500 person-linked), 1,000
 *    owned tasks, 200 decisions; 20 sequential calls with 40 attendees + 8
 *    events → p95 < 300 ms, and no LlmUsage rows are created (no LLM call).
 *
 * Rows are seeded straight through Prisma (no write rate limit, no embedding
 * outbox) under user ids owned by this file, and removed afterwards.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// Root-level e2e files cannot resolve the workspace package; import the schema source directly.
import { PersonBriefsResponseSchema } from '../../packages/shared/src/validation/meeting-brief.schema';
import { setupHarness, teardownHarness, type Harness } from './harness';

const USER = 'rd13-e2e-user';
const PERF_USER = 'rd13-e2e-perf-user';
const DAY = 86_400_000;
/** Letters-only tag (names are normalized to letters, so digits would make every perf person identical). */
const tag = (n: number): string => { let s = ''; let x = n; do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26); } while (x > 0); return s; };
const perfName = (i: number): string => `Perf${tag(i)} Surname${tag(i % 37)}`;

async function wipe(h: Harness, userIds: string[]): Promise<void> {
  const p = h.prisma;
  const people = await p.person.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const projects = await p.project.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const memories = await p.memoryEntry.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  await p.memoryEntityLink.deleteMany({ where: { memoryId: { in: memories.map(m => m.id) } } });
  await p.projectPersonLink.deleteMany({ where: { personId: { in: people.map(x => x.id) } } });
  await p.decisionProjectLink.deleteMany({ where: { projectId: { in: projects.map(x => x.id) } } });
  await p.commitment.deleteMany({ where: { userId: { in: userIds } } });
  await p.task.deleteMany({ where: { userId: { in: userIds } } });
  await p.decision.deleteMany({ where: { userId: { in: userIds } } });
  await p.project.deleteMany({ where: { userId: { in: userIds } } });
  await p.memoryEntry.deleteMany({ where: { userId: { in: userIds } } });
  await p.contextCapsule.deleteMany({ where: { userId: { in: userIds } } });
  await p.person.deleteMany({ where: { userId: { in: userIds } } });
}

describe('E2E RD-13: POST /people/briefs', () => {
  let harness: Harness;

  const post = async (userId: string, body: unknown, extraHeaders: Record<string, string> = {}) => {
    const started = performance.now();
    const res = await fetch(`${harness.config.apiBaseUrl}/people/briefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': harness.config.apiKey, 'x-user-id': userId, ...extraHeaders },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as any, ms: performance.now() - started };
  };

  beforeAll(async () => {
    harness = await setupHarness();
    await wipe(harness, [USER, PERF_USER]);
    const p = harness.prisma;
    const now = Date.now();

    const avery = await p.person.create({ data: { userId: USER, name: 'Avery Testperson', role: 'House manager', lastContactAt: new Date(now - 12 * DAY) } });
    await p.person.create({ data: { userId: USER, name: 'Quinn Placeholder' } });
    await p.commitment.create({ data: { userId: USER, description: 'Send Avery the rota draft', stakeholderId: avery.id, status: 'OPEN', deadline: new Date(now + 2 * DAY) } });
    await p.commitment.create({ data: { userId: USER, description: 'Already done thing', stakeholderId: avery.id, status: 'COMPLETED' } });
    await p.task.create({ data: { userId: USER, title: 'Collect volunteer list', owner: 'Avery', status: 'pending' } });
    const project = await p.project.create({ data: { userId: USER, title: 'Spring retreat' } as any });
    await p.projectPersonLink.create({ data: { projectId: project.id, personId: avery.id } });
    const decision = await p.decision.create({ data: { userId: USER, title: 'Move the retreat to April', question: 'Which month?', status: 'DECIDED' } });
    await p.decisionProjectLink.create({ data: { decisionId: decision.id, projectId: project.id } });
    const memory = await p.memoryEntry.create({ data: { userId: USER, title: 'Rota call', content: 'Talked through the weekend rota and the van keys.', domain: 'business', agentId: 'boardroom-ai' } });
    await p.memoryEntityLink.create({ data: { memoryId: memory.id, entityType: 'person', entityId: avery.id } });
    const ministry = await p.memoryEntry.create({ data: { userId: USER, title: 'Pastoral note', content: 'Must never appear.', domain: 'Ministry ', agentId: 'boardroom-ai' } });
    await p.memoryEntityLink.create({ data: { memoryId: ministry.id, entityType: 'person', entityId: avery.id } });

    // ── perf fixture ──
    const people = Array.from({ length: 300 }, (_, i) => ({ id: `rd13perf-p${i}`, userId: PERF_USER, name: perfName(i) }));
    await p.person.createMany({ data: people });
    await p.memoryEntry.createMany({
      data: Array.from({ length: 2000 }, (_, i) => ({
        id: `rd13perf-m${i}`, userId: PERF_USER, title: `Perf memory ${i}`, content: `Synthetic perf memory body ${i} `.repeat(4),
        domain: i % 50 === 0 ? 'ministry' : 'business', agentId: 'boardroom-ai', validAt: new Date(now - (i % 300) * DAY),
      })),
    });
    await p.memoryEntityLink.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ memoryId: `rd13perf-m${i}`, entityType: 'person', entityId: `rd13perf-p${i % 300}` })),
    });
    await p.task.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        userId: PERF_USER, title: `Perf task ${i}`, owner: i % 3 === 0 ? `Perf${tag(i % 300)}` : perfName(i % 300),
        status: i % 5 === 0 ? 'done' : 'pending', deadline: i % 2 ? new Date(now + (i % 30) * DAY) : null, priority: i % 4,
      })),
    });
    await p.decision.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        userId: PERF_USER, title: `Perf decision ${i} with ${perfName(i % 300)}`, question: `Question ${i}?`, createdAt: new Date(now - (i % 200) * DAY),
      })),
    });
    await p.commitment.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({ userId: PERF_USER, description: `Perf commitment ${i}`, stakeholderId: `rd13perf-p${i}`, status: 'OPEN', deadline: new Date(now + ((i % 20) - 10) * DAY) })),
    });
  }, 180_000);

  afterAll(async () => {
    if (harness) await wipe(harness, [USER, PERF_USER]);
    await teardownHarness();
  });

  it('builds every section for an attendee name match', async () => {
    const r = await post(USER, { attendees: [{ key: '0:0', name: 'avery testperson' }] });
    expect(r.status).toBe(200);
    expect(PersonBriefsResponseSchema.safeParse(r.body).success).toBe(true);
    expect(r.body.partial).toBe(false);
    const match = r.body.attendeeMatches[0];
    expect(match).toMatchObject({ method: 'exact', ambiguous: false });
    const b = r.body.briefs[match.personId];
    expect(b.headline.startsWith('You owe Avery 1')).toBe(true);
    expect(b.headline).toContain('Avery owes you 1');
    expect(b.youOwe.map((c: any) => c.description)).toEqual(['Send Avery the rota draft']);
    expect(b.theyOwe.map((t: any) => t.title)).toEqual(['Collect volunteer list']);
    expect(b.decisions).toEqual([expect.objectContaining({ title: 'Move the retreat to April', via: 'project' })]);
    expect(b.recentMemories.map((m: any) => m.title)).toEqual(['Rota call']);
    expect(JSON.stringify(b)).not.toContain('Must never appear');
  });

  it('refuses agent callers with 403 agent_context_unsupported', async () => {
    const r = await post(USER, { attendees: [{ key: '0:0', name: 'Avery Testperson' }] }, {
      'x-agent-id': 'rd13-test-agent', 'x-tenant-id': 'josh-business', 'x-source-weight': '1.0',
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('agent_context_unsupported');
  });

  it('matches a title-only small meeting by unique first name', async () => {
    const r = await post(USER, { events: [{ key: 'e0', titleTokens: ['coffee', 'avery'], smallMeeting: true }] });
    expect(r.status).toBe(200);
    expect(r.body.titleMatches).toEqual([expect.objectContaining({ key: 'e0', method: 'title_first_name' })]);
  });

  it('p95 < 300 ms on the perf fixture (40 attendees + 8 events) and no LlmUsage rows', async () => {
    const before = await harness.prisma.llmUsage.count();
    const body = {
      attendees: Array.from({ length: 40 }, (_, i) => ({ key: `${Math.floor(i / 5)}:${i % 5}`, name: perfName(i * 7) })),
      events: Array.from({ length: 8 }, (_, i) => ({ key: `e${i}`, titleTokens: ['sync', ...perfName(i * 11 + 1).toLowerCase().split(' ')], smallMeeting: i % 2 === 0 })),
    };
    await post(PERF_USER, body); // warm-up (connection pool, query plans)
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await post(PERF_USER, body);
      expect(r.status).toBe(200);
      expect(r.body.partial).toBe(false);
      times.push(r.ms);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
    // eslint-disable-next-line no-console
    console.log(`[RD-13 perf] p50=${sorted[9].toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${sorted[19].toFixed(1)}ms`);
    expect(p95).toBeLessThan(300);
    const last = await post(PERF_USER, body);
    expect(Object.keys(last.body.briefs).length).toBeGreaterThan(30);
    const all = Object.values(last.body.briefs) as any[];
    expect(all.some(b => b.recentMemories.length > 0)).toBe(true);
    expect(all.some(b => b.theyOwe.length > 0)).toBe(true);
    expect(all.some(b => b.decisions.length > 0)).toBe(true);
    expect(all.some(b => b.youOwe.length > 0)).toBe(true);
    expect(last.body.titleMatches.length).toBeGreaterThan(0);
    expect(await harness.prisma.llmUsage.count()).toBe(before);
  });
});
