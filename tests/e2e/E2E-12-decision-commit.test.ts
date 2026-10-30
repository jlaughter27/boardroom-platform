/**
 * E2E-12 — "Commit decision" against a real OmniMind + Postgres. Invented data only.
 *
 * BoardRoom sessions live in BoardRoom's memory (`session_<n>_<ms>` ids) and
 * never exist in OmniMind's `sessions` table, so a Decision that carries that
 * id as `sessionId` violates `decisions_session_id_fkey` (→ 500 upstream,
 * 502 in BoardRoom). Unit tests with a mocked OmniMind never saw it. This
 * drives BoardRoom's own committer (`commitDecision`) through the real
 * `OmniMindClient` and expects the Decision row to be created.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupHarness, teardownHarness, resetDatabase, TEST_USER_ID, type Harness } from './harness';
import { OmniMindClient } from '../../packages/boardroom-ai/server/src/services/omnimind-client';
import { buildDecisionInput, commitDecision } from '../../packages/boardroom-ai/server/src/services/decision-commit.service';
import type { SessionState } from '../../packages/boardroom-ai/server/src/agents/orchestrator';

function boardroomSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    // Same shape as sessions.routes.ts: `session_${++sessionCounter}_${Date.now()}`.
    id: `session_7_${Date.now()}`,
    userId: TEST_USER_ID,
    mode: 'decide',
    question: 'Should the bakery open a second stall at the Saturday market?',
    personaResponses: new Map([
      ['optimist', { personaId: 'optimist', situationReading: 'r', keyAssumptions: [], analysis: 'a', recommendation: 'Open the stall in March', uncertainties: [], sourceMemoryIds: [], confidence: 0.7, dissentFlag: false }],
      ['critic', { personaId: 'critic', situationReading: 'r', keyAssumptions: [], analysis: 'a', recommendation: 'Wait until the oven is paid off', uncertainties: [], sourceMemoryIds: [], confidence: 0.6, dissentFlag: true }],
    ]),
    synthesis: {
      disagreementMap: 'timing', decisiveTradeoff: 'growth vs cash', recommendation: 'Open the stall in March',
      nextActions: [], topRisks: [], sourceMemoryIds: [],
      assumptionsToMonitor: [{ assumption: 'Saturday footfall holds through spring', reviewAt: new Date(Date.now() + 30 * 86_400_000), confidence: 'MEDIUM' }],
    },
    projectIds: [],
    ...overrides,
  };
}

describe('E2E-12: commit a decision from a BoardRoom session', () => {
  let harness: Harness;
  let client: OmniMindClient;

  beforeAll(async () => {
    harness = await setupHarness();
    client = new OmniMindClient(harness.config.apiBaseUrl, harness.config.apiKey);
  }, 60_000);

  afterAll(async () => {
    await teardownHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness);
    // Decisions have no FK to users, so TRUNCATE … CASCADE leaves them: clear this user's rows.
    await harness.prisma.decisionAssumption.deleteMany({ where: { decision: { userId: TEST_USER_ID } } });
    await harness.prisma.decisionProjectLink.deleteMany({ where: { decision: { userId: TEST_USER_ID } } });
    await harness.prisma.decision.deleteMany({ where: { userId: TEST_USER_ID } });
  });

  it('POST /decisions with the payload BoardRoom builds for an in-memory session → 201', async () => {
    const input = buildDecisionInput(boardroomSession(), {
      chosenPath: 'Open the stall in March', expectedOutcome: 'Stall covers its pitch fee by week 6', probabilitySuccess: 0.65,
    });
    const res = await fetch(`${harness.config.apiBaseUrl}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': harness.config.apiKey, 'x-user-id': TEST_USER_ID },
      body: JSON.stringify(input),
    });
    const body = await res.json();
    expect({ status: res.status, body }).toMatchObject({ status: 201, body: { sessionId: null } });
  });

  it('commitDecision through the real OmniMindClient creates the row and links projects', async () => {
    const project = await harness.prisma.project.create({ data: { userId: TEST_USER_ID, title: 'Saturday market stall' } });
    try {
      const session = boardroomSession({ projectIds: [project.id] });
      const decision = await commitDecision(session, {
        chosenPath: 'Open the stall in March', expectedOutcome: 'Stall covers its pitch fee by week 6', probabilitySuccess: 0.65,
      }, client);

      expect(decision.id).toEqual(expect.any(String));
      expect(session.decisionId).toBe(decision.id);

      const row = await harness.prisma.decision.findUnique({ where: { id: decision.id }, include: { assumptions: true, projectLinks: true } });
      expect(row).toMatchObject({
        userId: TEST_USER_ID, status: 'DECIDED', chosenPath: 'Open the stall in March',
        probabilitySuccess: 0.65, mode: 'decide', sessionId: null,
      });
      expect(row!.assumptions.map((a) => a.text)).toEqual(['Saturday footfall holds through spring']);
      expect(row!.projectLinks.map((l) => l.projectId)).toEqual([project.id]);
    } finally {
      await harness.prisma.decisionProjectLink.deleteMany({ where: { projectId: project.id } });
      await harness.prisma.project.delete({ where: { id: project.id } });
    }
  });
});
