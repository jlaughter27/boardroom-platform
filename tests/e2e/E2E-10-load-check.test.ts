/**
 * E2E-10 — RD-11 load check: `GET /context/core` ends with a deterministic
 * `## Current load` section for BoardRoom (no agent headers), omits it for
 * tenant-scoped agent callers, keeps the same hash for unchanged data, and a
 * `POST /tasks` invalidates the cache so the next block counts the new task.
 *
 * Real Postgres, real API. The fixture user and every title are invented:
 * 4 business projects, 6 open commitments (2 overdue), 9 open tasks
 * (3 overdue), 2 ministry projects, 1 decision past its review date →
 * business 44, ministry 8, total 53, OVER, flags too_many_overdue (5) and
 * domain_sprawl (business). Ministry titles never appear in the section.
 * Rows are seeded through Prisma (32 entity writes would exceed the 20/min
 * per-user write budget); the one write under test goes through the API.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupHarness, teardownHarness, resetDatabase, type Harness } from './harness';

const USER = 'e2e-rd11-load-user';
const DAY = 86_400_000;
const BUSINESS = ['Podcast relaunch', 'Newsletter rebuild', 'Partner portal', 'Pricing page test'];
const MINISTRY = ['Choir retreat', 'Youth night'];

interface CoreResponse { block: string; hash: string; tokensEstimate: number }

describe('E2E-10: GET /context/core load section (RD-11)', () => {
  let harness: Harness;

  const call = async <T>(method: string, path: string, opts: { body?: unknown; agent?: boolean } = {}): Promise<{ status: number; body: T }> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-api-key': harness.config.apiKey, 'x-user-id': USER };
    if (opts.agent) Object.assign(headers, { 'x-agent-id': 'e2e-rd11-agent', 'x-tenant-id': 'tenant-fixture', 'x-source-weight': '1' });
    const res = await fetch(`${harness.config.apiBaseUrl}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    return { status: res.status, body: (await res.json()) as T };
  };
  const core = async (agent = false): Promise<CoreResponse> => {
    const r = await call<CoreResponse>('GET', '/context/core', { agent });
    expect(r.status).toBe(200);
    return r.body;
  };
  const loadSection = (block: string): string => block.slice(block.indexOf('## Current load'));

  const cleanup = async (): Promise<void> => {
    const p = harness.prisma;
    await p.projectTaskLink.deleteMany({ where: { task: { userId: USER } } });
    await p.commitment.deleteMany({ where: { userId: USER } });
    await p.task.deleteMany({ where: { userId: USER } });
    await p.project.deleteMany({ where: { userId: USER } });
    await p.decision.deleteMany({ where: { userId: USER } });
  };

  beforeAll(async () => {
    harness = await setupHarness();
    await resetDatabase(harness);
    await cleanup();
    const p = harness.prisma;
    const now = Date.now();

    const biz = [];
    for (const title of BUSINESS) biz.push(await p.project.create({ data: { userId: USER, title, domain: 'business', status: 'active' } }));
    for (const title of MINISTRY) await p.project.create({ data: { userId: USER, title, domain: 'ministry', status: 'active' } });
    // closed / deleted rows that must NOT count
    await p.project.create({ data: { userId: USER, title: 'Old archive project', domain: 'business', status: 'Archived' } });
    await p.project.create({ data: { userId: USER, title: 'Deleted project', domain: 'business', status: 'active', deletedAt: new Date() } });

    // Commitments and tasks go to the 2nd-4th business projects; "Podcast relaunch" stays empty.
    for (let i = 0; i < 6; i++) {
      await p.commitment.create({
        data: { userId: USER, description: `Fixture promise ${i + 1}`, linkedProjectId: biz[1 + (i % 3)].id, deadline: new Date(i < 2 ? now - DAY : now + 30 * DAY), status: 'OPEN' },
      });
    }
    await p.commitment.create({ data: { userId: USER, description: 'Kept promise', status: 'COMPLETED' } });
    for (let i = 0; i < 9; i++) {
      await p.task.create({
        data: {
          userId: USER, title: `Fixture task ${i + 1}`, status: i % 2 === 0 ? 'pending' : 'in_progress',
          deadline: new Date(i < 3 ? now - 2 * DAY : now + 20 * DAY),
          projectLinks: { create: [{ projectId: biz[1 + (i % 3)].id }] },
        },
      });
    }
    await p.task.create({ data: { userId: USER, title: 'Finished task', status: 'Done' } });
    await p.decision.create({ data: { userId: USER, title: 'Fixture pilot decision', question: 'Run the pilot?', reviewAt: new Date(now - DAY) } });
    await p.decision.create({ data: { userId: USER, title: 'Reviewed decision', question: 'Done?', reviewAt: new Date(now - DAY), outcomeRating: 4 } });
  }, 120_000);

  afterAll(async () => {
    if (harness) await cleanup();
    await teardownHarness();
  });

  it('BoardRoom (no agent headers) gets the hand-computed load section; ministry titles never appear in it', async () => {
    const { block } = await core();
    expect(block.indexOf('## Current load')).toBeGreaterThan(block.indexOf('## Standing constraints'));
    const section = loadSection(block);
    expect(section).toContain('- level: OVER — 53 points (capacity 40)');
    expect(section).toContain('  - business: 4 / 6, 2 / 9, 3 / 44');
    expect(section).toContain('  - ministry: 2 / 0, 0 / 0, 0 / 8');
    expect(section).toContain('- decisions past their review date: 1');
    expect(section).toContain('- flags: too_many_overdue (5), domain_sprawl (business: 4 active projects)');
    expect(section).toContain('- not counted: tasks and commitments logged through MCP tools');
    expect(section).toContain('  - Podcast relaunch (business; 0 open tasks, 0 open commitments)');
    for (const t of MINISTRY) expect(section).not.toContain(t);
    expect(section).not.toContain('Old archive project');
    expect(section).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('a tenant-scoped agent caller gets no load section', async () => {
    const { block } = await core(true);
    expect(block).toContain('# Core context');
    expect(block).not.toContain('## Current load');
  });

  it('unchanged data → same hash; POST /tasks invalidates the cache and the next block counts the new task', async () => {
    const a = await core();
    const b = await core();
    expect(b.hash).toBe(a.hash);
    expect(loadSection(a.block)).not.toContain('unassigned');

    const created = await call<{ id: string }>('POST', '/tasks', { body: { title: 'New fixture task', status: 'pending' } });
    expect([200, 201]).toContain(created.status);

    const c = await core();
    expect(c.hash).not.toBe(a.hash);
    const section = loadSection(c.block);
    expect(section).toContain('  - unassigned: 0 / 0, 0 / 1, 0 / 1'); // openTasks + 1 (no project link)
    expect(section).toContain('- level: OVER — 54 points (capacity 40)');
  });
});
