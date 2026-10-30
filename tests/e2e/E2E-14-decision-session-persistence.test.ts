/**
 * E2E-14 — RD-17: Decision Lab sessions persisted in OmniMind. Real OmniMind +
 * Postgres; BoardRoom's own session store and committer through the real
 * OmniMindClient. Invented data only.
 *
 * Flow: a store creates a session (OmniMind id) and writes the persona round,
 * rebuttals, ledger and CEO synthesis through → a FRESH store (the restart)
 * loads it on a cache miss → commitDecision links the Decision to the session
 * (`decisions.decision_session_id`) → the session record reports the decision.
 * Plus: user scoping, the 512 kB snapshot limit, one decision per session,
 * archive (soft delete) and the link refusal for an archived session.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupHarness, teardownHarness, resetDatabase, TEST_USER_ID, type Harness } from './harness';
import { OmniMindClient } from '../../packages/boardroom-ai/server/src/services/omnimind-client';
import { DecisionSessionStore } from '../../packages/boardroom-ai/server/src/services/session-store';
import { commitDecision } from '../../packages/boardroom-ai/server/src/services/decision-commit.service';

const OTHER_USER_ID = 'test-user-e2e-other';

const response = (personaId: string, recommendation: string, confidence: number, dissentFlag = false) => ({
  personaId, situationReading: 'Saturday trade is steady', keyAssumptions: ['footfall holds'], analysis: 'a',
  recommendation, uncertainties: ['weather'], sourceMemoryIds: [], confidence, dissentFlag,
});

describe('E2E-14: Decision Lab session persistence (RD-17)', () => {
  let harness: Harness;
  let client: OmniMindClient;

  const raw = (method: string, path: string, userId: string, body?: unknown) =>
    fetch(`${harness.config.apiBaseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': harness.config.apiKey, 'x-user-id': userId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    harness = await setupHarness();
    client = new OmniMindClient(harness.config.apiBaseUrl, harness.config.apiKey);
  }, 60_000);

  afterAll(async () => {
    await teardownHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness); // users → decision_sessions cascade
    await harness.prisma.decisionAssumption.deleteMany({ where: { decision: { userId: TEST_USER_ID } } });
    await harness.prisma.decision.deleteMany({ where: { userId: TEST_USER_ID } });
    for (const [id, email] of [[TEST_USER_ID, 'e2e@example.test'], [OTHER_USER_ID, 'e2e-other@example.test']]) {
      await harness.prisma.user.upsert({ where: { id }, create: { id, email, passwordHash: 'unused', name: 'E2E' }, update: {} });
    }
  });

  it('create → write-through → restart (fresh store) → reload → commit links the decision', async () => {
    const before = new DecisionSessionStore(client, { debounceMs: 10 });
    const session = await before.create(TEST_USER_ID, { question: 'Should the bakery open a second stall at the Saturday market?', mode: 'decide' });
    expect(session.persisted).toBe(true);
    expect(session.id).toMatch(/^c[a-z0-9]{20,32}$/);

    session.personaResponses.set('optimist', response('optimist', 'Open the stall in March', 0.7));
    session.personaResponses.set('critic', response('critic', 'Wait until the oven is paid off', 0.6, true));
    before.schedulePersist(session); // round 1
    session.rebuttals = new Map([['critic', { personaId: 'critic', stance: 'concede' as const, reason: 'cash is fine', revisedRecommendation: 'Open in April', revisedConfidence: 0.55 }]]);
    session.ledger = [{ claim: 'timing', heldBy: ['optimist'], opposedBy: ['critic'], citedMemoryIds: [] }];
    session.synthesis = {
      disagreementMap: 'timing', decisiveTradeoff: 'growth vs cash', recommendation: 'Open the stall in March',
      nextActions: ['Book the pitch'], topRisks: ['Rain'], sourceMemoryIds: [],
      assumptionsToMonitor: [{ assumption: 'Saturday footfall holds through spring', reviewAt: new Date('2027-01-15T00:00:00.000Z'), confidence: 'MEDIUM' }],
    };
    await before.persistNow(session);

    const row = await harness.prisma.decisionSession.findUnique({ where: { id: session.id } });
    expect(row).toMatchObject({ userId: TEST_USER_ID, mode: 'decide', status: 'SYNTHESIZED', ceoSynthesis: 'Open the stall in March', deletedAt: null });

    // The restart: a brand-new store with an empty cache.
    const after = new DecisionSessionStore(client, { debounceMs: 10 });
    expect(await after.get(session.id, OTHER_USER_ID)).toBeNull();
    const reloaded = await after.get(session.id, TEST_USER_ID);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.question).toBe(session.question);
    expect(Object.fromEntries(reloaded!.personaResponses)).toEqual(Object.fromEntries(session.personaResponses));
    expect(reloaded!.rebuttals!.get('critic')).toMatchObject({ stance: 'concede', revisedRecommendation: 'Open in April' });
    expect(reloaded!.ledger).toEqual(session.ledger);
    expect(reloaded!.synthesis!.assumptionsToMonitor[0].reviewAt).toEqual(new Date('2027-01-15T00:00:00.000Z'));

    const decision = await commitDecision(reloaded!, {
      chosenPath: 'Open the stall in March', expectedOutcome: 'Stall covers its pitch fee by week 6', probabilitySuccess: 0.65,
    }, client);
    expect(decision).toMatchObject({ decisionSessionId: session.id, sessionId: null });
    await after.persistNow(reloaded!);

    const decisionRow = await harness.prisma.decision.findUnique({ where: { id: decision.id }, include: { assumptions: true } });
    expect(decisionRow).toMatchObject({ userId: TEST_USER_ID, decisionSessionId: session.id, sessionId: null, status: 'DECIDED' });
    expect(decisionRow!.assumptions.map((a) => a.text)).toEqual(['Saturday footfall holds through spring']);

    const record = await client.getDecisionSession(TEST_USER_ID, session.id);
    expect(record).toMatchObject({ status: 'DECIDED', decisionId: decision.id });

    // One decision per session.
    const dup = await raw('POST', '/decisions', TEST_USER_ID, { title: 'dup', question: 'dup', decisionSessionId: session.id });
    expect(dup.status).toBe(409);

    // Listing shows it, without the snapshot.
    const list = await client.listDecisionSessions(TEST_USER_ID, { limit: 5 });
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ id: session.id, personaCount: 2, hasSynthesis: true, decisionId: decision.id, status: 'DECIDED' });
    expect(list.items[0]).not.toHaveProperty('state');
  });

  it('user scoping, 413 snapshot limit, archive (soft delete) and the link refusal for an archived session', async () => {
    const created = await raw('POST', '/decision-sessions', TEST_USER_ID, { question: 'Hire a weekend baker?', mode: 'decide' });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };

    expect((await raw('GET', `/decision-sessions/${id}`, OTHER_USER_ID)).status).toBe(404);
    expect((await raw('PATCH', `/decision-sessions/${id}`, OTHER_USER_ID, { status: 'DISPATCHED' })).status).toBe(404);
    expect((await raw('DELETE', `/decision-sessions/${id}`, OTHER_USER_ID)).status).toBe(404);
    // Another user's session cannot be linked either (no existence leak: 422 like an unknown id).
    expect((await raw('POST', '/decisions', OTHER_USER_ID, { title: 't', question: 'q', decisionSessionId: id })).status).toBe(422);

    const big = await raw('PATCH', `/decision-sessions/${id}`, TEST_USER_ID, { state: { blob: 'x'.repeat(600 * 1024) } });
    expect(big.status).toBe(413);

    expect((await raw('DELETE', `/decision-sessions/${id}`, TEST_USER_ID)).status).toBe(200);
    const archived = await harness.prisma.decisionSession.findUnique({ where: { id } });
    expect(archived!.deletedAt).toBeInstanceOf(Date); // soft delete: the row stays
    expect((await raw('GET', `/decision-sessions/${id}`, TEST_USER_ID)).status).toBe(404);
    expect((await client.listDecisionSessions(TEST_USER_ID)).total).toBe(0);

    const refused = await raw('POST', '/decisions', TEST_USER_ID, { title: 't', question: 'q', decisionSessionId: id });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toBe('invalid_reference');
  });
});
