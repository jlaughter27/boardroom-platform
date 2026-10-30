/**
 * RD-17 — DecisionSessionStore: write-through (coalesced + serialized),
 * load-after-restart with a FRESH store instance, OmniMind-down fallback,
 * owner scoping, list merge, idle sweep. OmniMind is an in-memory fake that
 * speaks the `/decision-sessions` wire shape (JSON round-trip, ISO dates).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PersonaResponse, Rebuttal, SynthesisReport, CreateDecisionSessionRequest, UpdateDecisionSessionRequest } from '@boardroom/shared';

vi.mock('../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { logger } from '../../src/lib/logger';
import { DecisionSessionStore, SessionCapacityError, type SessionStoreClient } from '../../src/services/session-store';
import type { DecisionSessionWire } from '../../src/services/omnimind-client';

function httpError(status: number) {
  return Object.assign(new Error(`OmniMind: ${status}`), { status });
}

class FakeOmniMind {
  rows = new Map<string, DecisionSessionWire>();
  down = false;
  seq = 0;
  createDecisionSession = vi.fn(async (userId: string, body: CreateDecisionSessionRequest) => {
    if (this.down) throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    const now = new Date().toISOString();
    const id = `cfakesession${String(++this.seq).padStart(13, '0')}`;
    const row: DecisionSessionWire = {
      id, userId, roomId: null, question: body.question, mode: body.mode ?? null, status: body.status ?? ('OPEN' as never),
      personaResponses: body.personaResponses ?? {}, ceoSynthesis: body.ceoSynthesis ?? null, state: body.state ?? null,
      decisionId: null, createdAt: now, updatedAt: now,
    };
    this.rows.set(id, JSON.parse(JSON.stringify(row)));
    return JSON.parse(JSON.stringify(row)) as DecisionSessionWire;
  });
  getDecisionSession = vi.fn(async (userId: string, id: string) => {
    if (this.down) throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) throw httpError(404);
    return JSON.parse(JSON.stringify(row)) as DecisionSessionWire;
  });
  updateDecisionSession = vi.fn(async (userId: string, id: string, body: UpdateDecisionSessionRequest) => {
    if (this.down) throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    const row = this.rows.get(id);
    if (!row || row.userId !== userId) throw httpError(404);
    const next = { ...row, ...JSON.parse(JSON.stringify(body)), updatedAt: new Date().toISOString() };
    this.rows.set(id, next);
    return JSON.parse(JSON.stringify(next)) as DecisionSessionWire;
  });
  listDecisionSessions = vi.fn(async (userId: string, q: { limit?: number; offset?: number } = {}) => {
    if (this.down) throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    const mine = Array.from(this.rows.values()).filter((r) => r.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = q.offset ?? 0; const limit = q.limit ?? 20;
    return {
      items: mine.slice(offset, offset + limit).map((r) => ({
        id: r.id, question: r.question, mode: r.mode, status: r.status,
        personaCount: Object.keys(r.personaResponses).length, hasSynthesis: r.ceoSynthesis !== null,
        decisionId: r.decisionId, createdAt: r.createdAt, updatedAt: r.updatedAt,
      })),
      total: mine.length, offset, limit,
    };
  });
}

const pr = (personaId: string, recommendation: string, confidence = 0.7): PersonaResponse => ({
  personaId, situationReading: 'r', keyAssumptions: ['a1'], analysis: 'a', recommendation, uncertainties: [], sourceMemoryIds: ['m1'], confidence, dissentFlag: false,
});

const synthesis: SynthesisReport = {
  disagreementMap: 'timing', decisiveTradeoff: 'growth vs cash', recommendation: 'Open the stall in March',
  nextActions: ['Book the pitch'], topRisks: ['Rain'], sourceMemoryIds: ['m1'],
  assumptionsToMonitor: [{ assumption: 'Saturday footfall holds', reviewAt: new Date('2026-12-01T00:00:00.000Z'), confidence: 'MEDIUM' }],
  ledgerResolutions: [{ claim: 'timing', resolution: 'March' }], droppedConsiderations: [],
};

let omni: FakeOmniMind;
const store = (opts: ConstructorParameters<typeof DecisionSessionStore>[1] = {}) =>
  new DecisionSessionStore(omni as unknown as SessionStoreClient, { debounceMs: 20, ...opts });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  omni = new FakeOmniMind();
  vi.mocked(logger.warn).mockClear();
});

describe('create', () => {
  it('persists in OmniMind and uses its id', async () => {
    const s = await store().create('u1', { question: 'Open a second stall?', mode: 'decide', asOf: '2026-09-01T00:00:00.000Z' });
    expect(s.id).toMatch(/^cfakesession/);
    expect(s.persisted).toBe(true);
    expect(omni.createDecisionSession).toHaveBeenCalledWith('u1', expect.objectContaining({ question: 'Open a second stall?', mode: 'decide', status: 'OPEN' }));
    expect(omni.rows.get(s.id)!.state).toMatchObject({ v: 1, asOf: '2026-09-01T00:00:00.000Z' });
  });

  it('OmniMind down → local id, memory-only, logged; later transitions never call OmniMind', async () => {
    omni.down = true;
    const st = store();
    const s = await st.create('u1', { question: 'q', mode: 'decide' });
    expect(s.id).toMatch(/^session_\d+_\d+$/);
    expect(s.persisted).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('[SessionStore] persist failed', expect.objectContaining({ op: 'create' }));
    omni.down = false;
    st.schedulePersist(s);
    await st.persistNow(s);
    await sleep(40);
    expect(omni.updateDecisionSession).not.toHaveBeenCalled();
    expect(await st.get(s.id, 'u1')).toBe(s); // still works from memory
  });

  it('capacity limit → SessionCapacityError', async () => {
    const st = store({ maxSessions: 1 });
    await st.create('u1', { question: 'q', mode: 'decide' });
    await expect(st.create('u1', { question: 'q2', mode: 'decide' })).rejects.toBeInstanceOf(SessionCapacityError);
  });
});

describe('write-through', () => {
  it('coalesces a burst into one write carrying the latest state', async () => {
    const st = store();
    const s = await st.create('u1', { question: 'q', mode: 'decide' });
    s.personaResponses.set('optimist', pr('optimist', 'Go'));
    st.schedulePersist(s);
    s.personaResponses.set('critic', pr('critic', 'Wait'));
    st.schedulePersist(s);
    st.schedulePersist(s);
    expect(omni.updateDecisionSession).not.toHaveBeenCalled();
    await sleep(60);
    expect(omni.updateDecisionSession).toHaveBeenCalledTimes(1);
    const body = omni.updateDecisionSession.mock.calls[0][2];
    expect(Object.keys(body.personaResponses!)).toEqual(['optimist', 'critic']);
    expect(body.status).toBe('DISPATCHED');
  });

  it('serializes writes per session: a change during an in-flight write is written after it', async () => {
    const st = store();
    const s = await st.create('u1', { question: 'q', mode: 'decide' });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const real = omni.updateDecisionSession.getMockImplementation()!;
    omni.updateDecisionSession.mockImplementationOnce(async (...args) => { await gate; return real(...args); });

    s.personaResponses.set('optimist', pr('optimist', 'Go'));
    const first = st.persistNow(s);
    await sleep(5);
    s.synthesis = synthesis;
    const second = st.persistNow(s);
    await sleep(5);
    expect(omni.updateDecisionSession).toHaveBeenCalledTimes(1); // second waits for the first
    release();
    await Promise.all([first, second]);
    expect(omni.updateDecisionSession).toHaveBeenCalledTimes(2);
    expect(omni.updateDecisionSession.mock.calls[1][2].status).toBe('SYNTHESIZED');
    expect(omni.rows.get(s.id)!.ceoSynthesis).toBe('Open the stall in March');
  });

  it('a failed write is logged, never thrown; the session keeps working', async () => {
    const st = store();
    const s = await st.create('u1', { question: 'q', mode: 'decide' });
    omni.updateDecisionSession.mockRejectedValueOnce(httpError(413));
    await expect(st.persistNow(s)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('[SessionStore] persist failed', expect.objectContaining({ op: 'update', status: 413 }));
    omni.down = true;
    await expect(st.persistNow(s)).resolves.toBeUndefined();
    expect(await st.get(s.id, 'u1')).toBe(s);
  });
});

describe('load after restart (fresh store instance)', () => {
  it('rebuilds the full session from OmniMind', async () => {
    const before = store();
    const s = await before.create('u1', { question: 'Open a second stall?', mode: 'premortem', asOf: '2026-09-01T00:00:00.000Z' });
    s.personaResponses.set('optimist', pr('optimist', 'Open in March', 0.8));
    s.personaResponses.set('critic', pr('critic', 'Wait', 0.6));
    s.rebuttals = new Map<string, Rebuttal>([['critic', { personaId: 'critic', stance: 'concede', reason: 'r', revisedRecommendation: 'Open in April', revisedConfidence: 0.55 }]]);
    s.ledger = [{ claim: 'timing', heldBy: ['optimist'], opposedBy: ['critic'], citedMemoryIds: ['m1'] }];
    s.synthesis = synthesis;
    s.questionnaireAnswers = [{ question: 'Budget?', answer: '2k' }];
    s.projectIds = ['proj_1'];
    s.lateAdvisors = ['critic'];
    s.coreContext = 'not persisted';
    await before.persistNow(s);

    const after = store(); // the restart: empty cache
    const loaded = await after.get(s.id, 'u1');
    expect(loaded).not.toBeNull();
    expect(loaded).toMatchObject({
      id: s.id, userId: 'u1', question: 'Open a second stall?', mode: 'premortem', asOf: '2026-09-01T00:00:00.000Z',
      persisted: true, projectIds: ['proj_1'], lateAdvisors: ['critic'], questionnaireAnswers: [{ question: 'Budget?', answer: '2k' }],
      ledger: s.ledger,
    });
    expect(Object.fromEntries(loaded!.personaResponses)).toEqual(Object.fromEntries(s.personaResponses));
    expect(loaded!.rebuttals!.get('critic')).toEqual(s.rebuttals.get('critic'));
    expect(loaded!.synthesis).toEqual(synthesis); // reviewAt back to a Date
    expect(loaded!.coreContext).toBeUndefined();
    expect(loaded!.createdAt).toBe(s.createdAt);
  });

  it('another user gets null; concurrent misses share one OmniMind read', async () => {
    const s = await store().create('u1', { question: 'q', mode: 'decide' });
    const after = store();
    expect(await after.get(s.id, 'u2')).toBeNull();
    omni.getDecisionSession.mockClear();
    const [a, b] = await Promise.all([after.get(s.id, 'u1'), after.get(s.id, 'u1')]);
    expect(a).toBe(b);
    expect(omni.getDecisionSession).toHaveBeenCalledTimes(1);
  });

  it('decisionId after restart comes from OmniMind (the live linked decision)', async () => {
    const s = await store().create('u1', { question: 'q', mode: 'decide' });
    omni.rows.get(s.id)!.decisionId = 'cdecision000000000000001';
    expect((await store().get(s.id, 'u1'))!.decisionId).toBe('cdecision000000000000001');
  });

  it('invalid snapshot entries are dropped (and logged), never trusted', async () => {
    const s = await store().create('u1', { question: 'q', mode: 'decide' });
    omni.rows.get(s.id)!.personaResponses = { optimist: pr('optimist', 'Go'), critic: { recommendation: 42 } };
    omni.rows.get(s.id)!.state = { v: 1, synthesis: { recommendation: 'only this' }, rebuttals: {} };
    const loaded = await store().get(s.id, 'u1');
    expect(Array.from(loaded!.personaResponses.keys())).toEqual(['optimist']);
    expect(loaded!.synthesis).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('[SessionStore] dropped invalid snapshot entries on load', expect.objectContaining({ dropped: ['personaResponses.critic', 'synthesis'] }));
  });

  it('pre-RD-17 / local ids never reach OmniMind; OmniMind 404 → null; OmniMind down → throws', async () => {
    const st = store();
    expect(await st.get('session_7_1761830000000', 'u1')).toBeNull();
    expect(omni.getDecisionSession).not.toHaveBeenCalled();
    expect(await st.get('cmissing0000000000000000', 'u1')).toBeNull();
    omni.down = true;
    await expect(st.get('cmissing0000000000000001', 'u1')).rejects.toThrow('fetch failed');
  });
});

describe('list', () => {
  it('OmniMind page + memory-only sessions first on page 1; cache overlays pending changes', async () => {
    const st = store();
    const persisted = await st.create('u1', { question: 'persisted', mode: 'decide' });
    omni.down = true;
    const local = await st.create('u1', { question: 'local', mode: 'decide' });
    omni.down = false;
    persisted.personaResponses.set('optimist', pr('optimist', 'Go')); // not yet written
    const page = await st.list('u1', 20, 0);
    expect(page.items.map((i) => i.id)).toEqual([local.id, persisted.id]);
    expect(page.items[1].personaCount).toBe(1);
    expect(page.total).toBe(2);
    expect((await st.list('u1', 20, 1)).items.map((i) => i.id)).toEqual([]);
  });

  it('OmniMind down → the cached sessions, newest first', async () => {
    const st = store();
    const a = await st.create('u1', { question: 'a', mode: 'decide' });
    await st.create('u2', { question: 'other user', mode: 'decide' });
    omni.down = true;
    const page = await st.list('u1', 20, 0);
    expect(page.items.map((i) => i.id)).toEqual([a.id]);
  });
});

describe('sweep', () => {
  it('evicts idle sessions after flushing pending writes; a persisted one reloads on demand', async () => {
    const onEvict = vi.fn();
    const st = store({ idleTtlMs: 1000, debounceMs: 10_000, onEvict });
    const s = await st.create('u1', { question: 'q', mode: 'decide' });
    s.personaResponses.set('optimist', pr('optimist', 'Go'));
    st.schedulePersist(s); // long debounce: still pending at sweep time
    expect(await st.sweep(Date.now() + 5_000)).toBe(1);
    expect(onEvict).toHaveBeenCalledWith(s.id);
    expect(omni.updateDecisionSession).toHaveBeenCalledTimes(1);
    expect(st.size).toBe(0);
    const reloaded = await st.get(s.id, 'u1');
    expect(reloaded!.personaResponses.size).toBe(1);
  });
});
