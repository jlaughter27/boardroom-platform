/**
 * RD-13 — person-brief.service: deterministic resolution, per-section
 * building, totality and user scoping. Prisma is mocked; a few models get a
 * tiny where-clause emulation so "excluded" assertions check both the query
 * and the outcome. Every name is synthetic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersonBriefsResponseSchema } from '@boardroom/shared';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const createMessage = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/anthropic', () => ({ createMessage, extractText: vi.fn(), parseJsonFromText: vi.fn() }));
const decryptState = vi.hoisted(() => ({ failIds: new Set<string>() }));
vi.mock('../../../src/lib/memory-crypto', async (orig) => {
  const real = await orig<typeof import('../../../src/lib/memory-crypto')>();
  return {
    ...real,
    tryDecryptMemory: vi.fn((m: { id: string }) => (decryptState.failIds.has(m.id) ? null : m)),
  };
});

import {
  buildPersonBriefs,
  buildHeadline,
  unicodeMentionRegex,
  emptyPersonBriefs,
} from '../../../src/services/person-brief.service';
import { logger } from '../../../src/lib/logger';
import { tryDecryptMemory } from '../../../src/lib/memory-crypto';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);
const ahead = (d: number) => new Date(NOW.getTime() + d * DAY);
const U = 'user-1';

interface Data {
  people?: Array<Record<string, unknown>>;
  links?: Array<{ memoryId: string; entityId: string }>;
  memories?: Array<Record<string, unknown>>;
  commitments?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  personProjects?: Array<{ personId: string; projectId: string }>;
  projectDecisions?: Array<Record<string, unknown>>;
  recentDecisions?: Array<Record<string, unknown>>;
  capsules?: Array<Record<string, unknown>>;
}

const person = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, role: null, relationshipToUser: null, importance: 0.5, lastContactAt: null, ...extra,
});

function makePrisma(d: Data) {
  return {
    person: { findMany: vi.fn(async () => d.people ?? []) },
    memoryEntityLink: { findMany: vi.fn(async () => d.links ?? []) },
    memoryEntry: {
      findMany: vi.fn(async ({ where }: any) => (d.memories ?? []).filter((m: any) =>
        where.id.in.includes(m.id)
        && m.deletedAt == null
        && m.status !== 'ARCHIVED'
        && (m.invalidAt == null || m.invalidAt > NOW)
        && String(m.domain).toLowerCase() !== 'ministry')), // DB `equals ministry, insensitive` (no trim)
    },
    commitment: {
      findMany: vi.fn(async ({ where }: any) => (d.commitments ?? []).filter((c: any) =>
        c.status === where.status && c.deletedAt == null && where.stakeholderId.in.includes(c.stakeholderId))),
    },
    task: { findMany: vi.fn(async () => d.tasks ?? []) },
    projectPersonLink: { findMany: vi.fn(async () => d.personProjects ?? []) },
    decision: {
      findMany: vi.fn(async ({ where }: any) => (where.projectLinks ? d.projectDecisions ?? [] : d.recentDecisions ?? [])),
    },
    contextCapsule: { findMany: vi.fn(async () => d.capsules ?? []) },
  } as any;
}

const att = (key: string, name: string) => ({ key, name });
const body = (attendees: Array<{ key: string; name: string }>, events: Array<{ key: string; titleTokens: string[]; smallMeeting: boolean }> = []) => ({ attendees, events });

beforeEach(() => {
  vi.clearAllMocks();
  decryptState.failIds.clear();
});

describe('resolution (deterministic tiers only)', () => {
  it('exact match ignores case and diacritics; the people query is user-scoped and live-only', async () => {
    const prisma = makePrisma({ people: [person('p1', 'José Núñez')] });
    const r = await buildPersonBriefs(U, body([att('0:0', 'jose NUNEZ')]), prisma, NOW);
    expect(r.attendeeMatches).toEqual([{ key: '0:0', personId: 'p1', ambiguous: false, method: 'exact' }]);
    expect(prisma.person.findMany.mock.calls[0][0].where).toEqual({ userId: U, deletedAt: null });
    expect(Object.keys(r.briefs)).toEqual(['p1']);
  });

  it('two people with the same normalized name → ambiguous, personId null', async () => {
    const prisma = makePrisma({ people: [person('p1', 'Sarah Jones'), person('p2', 'sarah  jones')] });
    const r = await buildPersonBriefs(U, body([att('0:0', 'Sarah Jones')]), prisma, NOW);
    expect(r.attendeeMatches[0]).toEqual({ key: '0:0', personId: null, ambiguous: true, method: null });
    expect(r.briefs).toEqual({});
  });

  it("'Sarah Ann Jones' → Person 'Sarah Jones' via name_tokens; a non-unique first+last is ambiguous", async () => {
    const one = await buildPersonBriefs(U, body([att('0:0', 'Sarah Ann Jones')]), makePrisma({ people: [person('p1', 'Sarah Jones')] }), NOW);
    expect(one.attendeeMatches[0]).toMatchObject({ personId: 'p1', method: 'name_tokens' });
    const two = await buildPersonBriefs(U, body([att('0:0', 'Sarah Ann Jones')]), makePrisma({ people: [person('p1', 'Sarah Jones'), person('p2', 'Sarah Beth Jones')] }), NOW);
    expect(two.attendeeMatches[0]).toEqual({ key: '0:0', personId: null, ambiguous: true, method: null });
  });

  it('no fuzzy tier: a near-miss stays unmatched', async () => {
    const r = await buildPersonBriefs(U, body([att('0:0', 'Sarah Jonez')]), makePrisma({ people: [person('p1', 'Sarah Jones')] }), NOW);
    expect(r.attendeeMatches[0]).toEqual({ key: '0:0', personId: null, ambiguous: false, method: null });
  });
});

describe('title matching', () => {
  const sarah = person('p1', 'Sarah Quill');
  it('unique first name on a small meeting → title_first_name', async () => {
    const r = await buildPersonBriefs(U, body([], [{ key: 'e0', titleTokens: ['lunch', 'w', 'sarah'], smallMeeting: true }]), makePrisma({ people: [sarah] }), NOW);
    expect(r.titleMatches).toEqual([{ key: 'e0', personId: 'p1', method: 'title_first_name' }]);
  });
  it('the same title on a larger meeting → no match', async () => {
    const r = await buildPersonBriefs(U, body([], [{ key: 'e0', titleTokens: ['lunch', 'w', 'sarah'], smallMeeting: false }]), makePrisma({ people: [sarah] }), NOW);
    expect(r.titleMatches).toEqual([]);
  });
  it('two people with first token sarah → no match', async () => {
    const r = await buildPersonBriefs(U, body([], [{ key: 'e0', titleTokens: ['lunch', 'sarah'], smallMeeting: true }]), makePrisma({ people: [sarah, person('p2', 'Sarah Moss')] }), NOW);
    expect(r.titleMatches).toEqual([]);
  });
  it('full name as contiguous tokens → title_full, even on a big meeting', async () => {
    const r = await buildPersonBriefs(U, body([], [{ key: 'e0', titleTokens: ['sync', 'avery', 'testperson', 'q4'], smallMeeting: false }]), makePrisma({ people: [person('p9', 'Avery Testperson')] }), NOW);
    expect(r.titleMatches).toEqual([{ key: 'e0', personId: 'p9', method: 'title_full' }]);
  });
  it('a full-name title match is not repeated as a first-name match; first-name tokens under 3 chars are ignored', async () => {
    const r = await buildPersonBriefs(U, body([], [
      { key: 'e0', titleTokens: ['avery', 'testperson'], smallMeeting: true },
      { key: 'e1', titleTokens: ['bo', 'catchup'], smallMeeting: true },
    ]), makePrisma({ people: [person('p9', 'Avery Testperson'), person('p8', 'Bo Lindqvist')] }), NOW);
    expect(r.titleMatches).toEqual([{ key: 'e0', personId: 'p9', method: 'title_full' }]);
  });
});

describe('youOwe', () => {
  const p = person('p1', 'Sarah Quill');
  const c = (id: string, extra: Record<string, unknown>) => ({ id, description: `Item ${id}`, deadline: null, createdAt: ago(30), stakeholderId: 'p1', status: 'OPEN', deletedAt: null, ...extra });

  it('only OPEN, live, matching-stakeholder commitments; overdue first, then deadline asc (nulls last); counts are pre-cap', async () => {
    const prisma = makePrisma({
      people: [p],
      commitments: [
        c('a', { deadline: ahead(5) }),
        c('b', { deadline: null, createdAt: ago(1) }),
        c('c', { deadline: ago(2) }),
        c('d', { deadline: ahead(1) }),
        c('e', { deadline: null, createdAt: ago(3) }),
        c('done', { status: 'COMPLETED', deadline: ago(9) }),
        c('gone', { deletedAt: ago(1), deadline: ago(9) }),
        c('other', { stakeholderId: 'zz', deadline: ago(9) }),
      ],
    });
    const r = await buildPersonBriefs(U, body([att('0:0', 'Sarah Quill')]), prisma, NOW);
    const b = r.briefs.p1;
    expect(b.youOwe.map(x => x.id)).toEqual(['c', 'd', 'a']);
    expect(b.youOwe[0].overdue).toBe(true);
    expect(b.counts).toMatchObject({ youOwe: 5, youOweOverdue: 1 });
    const where = prisma.commitment.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ userId: U, deletedAt: null, status: 'OPEN', stakeholderId: { in: ['p1'] } });
    // MCP `commitment:pending` memories are not a source: no tag query on memoryEntry.
    for (const call of prisma.memoryEntry.findMany.mock.calls) expect(JSON.stringify(call[0])).not.toContain('commitment:pending');
  });
});

describe('theyOwe', () => {
  const t = (id: string, owner: string, extra: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, owner, status: 'pending', deadline: null, priority: 0, ...extra });

  it('full-name owners match; a first-name owner matches only when that first token is unique; closed statuses are excluded', async () => {
    const prisma = makePrisma({
      people: [person('p1', 'Mike Arden'), person('p2', 'Dana Holt'), person('p3', 'Dana Price')],
      tasks: [
        t('t1', 'Mike Arden', { deadline: ahead(3) }),
        t('t2', 'mike', { deadline: ahead(1), priority: 1 }),
        t('t3', 'Dana'),
        t('t4', 'Dana Holt', { status: 'Done' }),
        t('t5', 'Dana Holt', { status: 'cancelled ' }),
        t('t6', 'Dana Holt', { status: 'COMPLETED' }),
        t('t7', 'Dana Holt', { priority: 5 }),
        t('t8', 'Dana Holt', { priority: 9 }),
        t('t9', 'Mike Arden', { deadline: ahead(1), priority: 3 }),
      ],
    });
    const r = await buildPersonBriefs(U, body([att('0:0', 'Mike Arden'), att('0:1', 'Dana Holt')]), prisma, NOW);
    expect(r.briefs.p1.theyOwe.map(x => x.id)).toEqual(['t9', 't2', 't1']);
    expect(r.briefs.p2.theyOwe.map(x => x.id)).toEqual(['t8', 't7']);
    expect(r.briefs.p2.counts.theyOwe).toBe(2);
    const q = prisma.task.findMany.mock.calls[0][0];
    expect(q.where).toEqual({ userId: U, deletedAt: null, owner: { not: null } });
    expect(q.take).toBe(300);
  });
});

describe('decisions', () => {
  it('project path requires a live project; mention path uses 180 days / take 200 and Unicode boundaries; dedupe prefers project', async () => {
    const prisma = makePrisma({
      people: [person('p1', 'José Ortega')],
      personProjects: [{ personId: 'p1', projectId: 'pr1' }],
      projectDecisions: [
        { id: 'd1', title: 'Pick venue', status: 'DECIDED', createdAt: ago(10), projectLinks: [{ projectId: 'pr1' }] },
      ],
      recentDecisions: [
        { id: 'd1', title: 'Pick venue with José Ortega', question: 'q', chosenPath: null, status: 'DECIDED', createdAt: ago(10) },
        { id: 'd2', title: 'Hire', question: 'Should José Ortega lead?', chosenPath: null, status: 'OPEN', createdAt: ago(2) },
        { id: 'd3', title: 'Joséa Ortegas plan', question: 'q', chosenPath: null, status: 'OPEN', createdAt: ago(1) },
      ],
    });
    const r = await buildPersonBriefs(U, body([att('0:0', 'José Ortega')]), prisma, NOW);
    expect(r.briefs.p1.decisions.map(d => [d.id, d.via])).toEqual([['d2', 'mention'], ['d1', 'project']]);
    expect(prisma.projectPersonLink.findMany.mock.calls[0][0].where).toEqual({ personId: { in: ['p1'] }, project: { userId: U, deletedAt: null } });
    const calls = prisma.decision.findMany.mock.calls.map((c: any) => c[0]);
    const viaProject = calls.find((c: any) => c.where.projectLinks);
    const viaMention = calls.find((c: any) => !c.where.projectLinks);
    expect(viaProject.where).toMatchObject({ userId: U, deletedAt: null });
    expect(viaMention.where).toEqual({ userId: U, deletedAt: null, createdAt: { gte: ago(180) } });
    expect(viaMention.take).toBe(200);
  });

  it('unicodeMentionRegex matches whole labels only', () => {
    expect(unicodeMentionRegex('José Ortega').test('Lunch with josé  ortega.')).toBe(true);
    expect(unicodeMentionRegex('José').test('Joséa called')).toBe(false);
    expect(unicodeMentionRegex('José').test('aJosé')).toBe(false);
    expect(unicodeMentionRegex('A.B (x)').test('see A.B (x) now')).toBe(true);
  });
});

describe('stable caps (ties broken by id)', () => {
  it('youOwe / theyOwe / decisions / memories keep the same capped items whatever order the DB returns tied rows in', async () => {
    const same = ago(4);
    const commitments = ['k4', 'k2', 'k5', 'k1', 'k3'].map(id => ({ id, description: `Item ${id}`, deadline: null, createdAt: same, stakeholderId: 'p1', status: 'OPEN', deletedAt: null }));
    const tasks = ['t4', 't2', 't5', 't1', 't3'].map(id => ({ id, title: `Task ${id}`, owner: 'Sarah Quill', status: 'pending', deadline: null, priority: 0 }));
    const decisions = ['d4', 'd2', 'd5', 'd1', 'd3'].map(id => ({ id, title: `Plan ${id}`, status: 'OPEN', createdAt: same, projectLinks: [{ projectId: 'pr1' }] }));
    const memories = ['m4', 'm2', 'm5', 'm1', 'm3'].map(id => ({ id, title: `Note ${id}`, content: 'x', domain: 'business', encryptedContent: null, validAt: same, createdAt: same, status: 'ACTIVE', deletedAt: null, invalidAt: null }));
    const run = async (reverse: boolean) => {
      const order = <T,>(xs: T[]) => (reverse ? [...xs].reverse() : xs);
      const prisma = makePrisma({
        people: [person('p1', 'Sarah Quill')],
        commitments: order(commitments),
        tasks: order(tasks),
        personProjects: [{ personId: 'p1', projectId: 'pr1' }],
        projectDecisions: order(decisions),
        links: order(memories).map(m => ({ memoryId: m.id, entityId: 'p1' })),
        memories: order(memories),
      });
      const b = (await buildPersonBriefs(U, body([att('0:0', 'Sarah Quill')]), prisma, NOW)).briefs.p1;
      return [b.youOwe.map(x => x.id), b.theyOwe.map(x => x.id), b.decisions.map(x => x.id), b.recentMemories.map(x => x.id)];
    };
    const expected = [['k1', 'k2', 'k3'], ['t1', 't2', 't3'], ['d1', 'd2', 'd3'], ['m1', 'm2', 'm3']];
    expect(await run(false)).toEqual(expected);
    expect(await run(true)).toEqual(expected);
  });
});

describe('recentMemories', () => {
  const m = (id: string, extra: Record<string, unknown> = {}) => ({
    id, title: `Note ${id}`, content: 'x'.repeat(300), domain: 'business', encryptedContent: null,
    validAt: ago(5), createdAt: ago(5), status: 'ACTIVE', deletedAt: null, invalidAt: null, ...extra,
  });

  it('linked memories only, minus archived / past-invalid / any-case ministry / undecryptable; newest first, cap 3, excerpt ≤160', async () => {
    decryptState.failIds.add('m7');
    const prisma = makePrisma({
      people: [person('p1', 'Sarah Quill')],
      links: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'].map(id => ({ memoryId: id, entityId: 'p1' })),
      memories: [
        m('m1', { validAt: ago(1) }),
        m('m2', { validAt: ago(3) }),
        m('m3', { status: 'ARCHIVED' }),
        m('m4', { invalidAt: ago(1) }),
        m('m5', { domain: 'Ministry ' }),
        m('m6', { domain: 'MINISTRY' }),
        m('m7'),
        m('m8', { validAt: ago(2), invalidAt: ahead(3) }),
        m('m9', { validAt: ago(9) }),
        m('unlinked', { validAt: ago(0), content: 'Sarah Quill mentioned here' }),
      ],
    });
    const r = await buildPersonBriefs(U, body([att('0:0', 'Sarah Quill')]), prisma, NOW);
    const b = r.briefs.p1;
    expect(b.recentMemories.map(x => x.id)).toEqual(['m1', 'm8', 'm2']);
    expect(b.counts.memories).toBe(4);
    expect(b.recentMemories[0].excerpt.length).toBe(160);
    expect(tryDecryptMemory).toHaveBeenCalled();
    expect(prisma.memoryEntityLink.findMany.mock.calls[0][0].where).toEqual({
      entityType: { equals: 'person', mode: 'insensitive' }, entityId: { in: ['p1'] }, memory: { userId: U, deletedAt: null },
    });
    const q = prisma.memoryEntry.findMany.mock.calls[0][0];
    expect(q.where).toMatchObject({ userId: U, deletedAt: null, status: { not: 'ARCHIVED' }, NOT: { domain: { equals: 'ministry', mode: 'insensitive' } } });
    expect(q.where.OR).toEqual([{ invalidAt: null }, { invalidAt: { gt: NOW } }]);
    expect(q.take).toBe(200);
  });
});

describe('capsule', () => {
  it('calls getCapsules for person refs, truncates to 280, flags stale, null when absent', async () => {
    const prisma = makePrisma({
      people: [person('p1', 'Sarah Quill'), person('p2', 'Dana Holt')],
      capsules: [{ entityType: 'person', entityId: 'p1', summary: 's'.repeat(400), generatedAt: ago(20), staleAfter: ago(6) }],
    });
    const r = await buildPersonBriefs(U, body([att('0:0', 'Sarah Quill'), att('0:1', 'Dana Holt')]), prisma, NOW);
    expect(r.briefs.p1.capsule).toEqual({ summary: 's'.repeat(280), generatedAt: ago(20).toISOString(), stale: true });
    expect(r.briefs.p2.capsule).toBeNull();
    expect(prisma.contextCapsule.findMany.mock.calls[0][0].where).toEqual({
      userId: U, OR: [{ entityType: 'person', entityId: 'p1' }, { entityType: 'person', entityId: 'p2' }],
    });
  });
});

describe('headline and lastInteractionAt', () => {
  it('fixtures', () => {
    expect(buildHeadline('Sarah Quill', { youOwe: 1, youOweOverdue: 1, theyOwe: 2 }, ago(12.4), NOW)).toBe('You owe Sarah 1 overdue · Sarah owes you 2 · last touch 12d ago');
    expect(buildHeadline('Sarah Quill', { youOwe: 2, youOweOverdue: 0, theyOwe: 0 }, ago(0.2), NOW)).toBe('You owe Sarah 2 · last touch today');
    expect(buildHeadline('Sarah', { youOwe: 0, youOweOverdue: 0, theyOwe: 0 }, null, NOW)).toBe('no recorded interaction');
  });

  it('lastInteractionAt = max(lastContactAt, newest linked memory, newest open commitment createdAt)', async () => {
    const prisma = makePrisma({
      people: [person('p1', 'Sarah Quill', { lastContactAt: ago(20) })],
      links: [{ memoryId: 'm1', entityId: 'p1' }],
      memories: [{ id: 'm1', title: 'n', content: 'c', domain: 'business', encryptedContent: null, validAt: ago(8), createdAt: ago(8), status: 'ACTIVE', deletedAt: null, invalidAt: null }],
      commitments: [{ id: 'c1', description: 'd', deadline: null, createdAt: ago(4), stakeholderId: 'p1', status: 'OPEN', deletedAt: null }],
    });
    const r = await buildPersonBriefs(U, body([att('0:0', 'Sarah Quill')]), prisma, NOW);
    expect(r.briefs.p1.lastInteractionAt).toBe(ago(4).toISOString());
    expect(r.briefs.p1.headline).toBe('You owe Sarah 1 · last touch 4d ago');
  });
});

describe('totality, scoping, no LLM', () => {
  it('a failing section leaves it empty, sets partial and keeps the others', async () => {
    const prisma = makePrisma({
      people: [person('p1', 'Sarah Quill')],
      tasks: [{ id: 't1', title: 'T', owner: 'Sarah Quill', status: 'pending', deadline: null, priority: 0 }],
    });
    prisma.commitment.findMany.mockRejectedValue(new Error('boom'));
    const r = await buildPersonBriefs(U, body([att('0:0', 'Sarah Quill')]), prisma, NOW);
    expect(r.partial).toBe(true);
    expect(r.briefs.p1.youOwe).toEqual([]);
    expect(r.briefs.p1.theyOwe.map(x => x.id)).toEqual(['t1']);
    expect(PersonBriefsResponseSchema.safeParse(r).success).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it('a failing people load still answers (partial, nothing matched)', async () => {
    const prisma = makePrisma({});
    prisma.person.findMany.mockRejectedValue(new Error('db down'));
    const r = await buildPersonBriefs(U, body([att('0:0', 'Sarah Quill')]), prisma, NOW);
    expect(r).toMatchObject({ partial: true, briefs: {}, titleMatches: [] });
    expect(r.attendeeMatches[0].personId).toBeNull();
  });

  it('every user-owned model is queried with userId; link tables are relation-scoped; no LLM call; logs carry no names', async () => {
    const prisma = makePrisma({
      people: [person('p1', 'Sarah Quill')],
      links: [{ memoryId: 'm1', entityId: 'p1' }],
      memories: [{ id: 'm1', title: 'n', content: 'c', domain: 'business', encryptedContent: null, validAt: ago(1), createdAt: ago(1), status: 'ACTIVE', deletedAt: null, invalidAt: null }],
      personProjects: [{ personId: 'p1', projectId: 'pr1' }],
    });
    const r = await buildPersonBriefs(U, body([att('0:0', 'Sarah Quill')], [{ key: 'e0', titleTokens: ['lunch', 'sarah'], smallMeeting: true }]), prisma, NOW);
    expect(PersonBriefsResponseSchema.safeParse(r).success).toBe(true);
    for (const model of ['person', 'commitment', 'task', 'decision', 'memoryEntry', 'contextCapsule']) {
      expect(prisma[model].findMany).toHaveBeenCalled();
      for (const call of prisma[model].findMany.mock.calls) expect(call[0].where.userId).toBe(U);
    }
    expect(prisma.memoryEntityLink.findMany.mock.calls[0][0].where.memory.userId).toBe(U);
    expect(prisma.projectPersonLink.findMany.mock.calls[0][0].where.project.userId).toBe(U);
    expect(createMessage).not.toHaveBeenCalled();
    const logged = JSON.stringify([...(logger.info as any).mock.calls, ...(logger.error as any).mock.calls]);
    expect(logged).not.toMatch(/sarah|quill|lunch/i);
  });

  it('emptyPersonBriefs is a schema-valid partial answer', () => {
    const r = emptyPersonBriefs({ attendees: [att('0:0', 'X Y')] }, NOW);
    expect(PersonBriefsResponseSchema.safeParse(r).success).toBe(true);
    expect(r.attendeeMatches).toEqual([{ key: '0:0', personId: null, ambiguous: false, method: null }]);
  });
});
