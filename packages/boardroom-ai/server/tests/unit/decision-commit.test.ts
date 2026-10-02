import { describe, it, expect, vi } from 'vitest';
import type { PersonaResponse, Rebuttal, SynthesisReport } from '@boardroom/shared';
import type { SessionState } from '../../src/agents/orchestrator';
import { DecideBodySchema, buildDecisionInput, buildPersonaForecasts, buildAssumptions, commitDecision } from '../../src/services/decision-commit.service';

function pr(personaId: string, recommendation: string, confidence = 0.7): PersonaResponse {
  return { personaId, situationReading: 'r', keyAssumptions: [], analysis: 'a', recommendation, uncertainties: [], sourceMemoryIds: [], confidence, dissentFlag: false };
}

const synthesis: SynthesisReport = {
  disagreementMap: 'd', decisiveTradeoff: 'speed vs runway', recommendation: 'Hire now', nextActions: [], topRisks: [],
  assumptionsToMonitor: [
    { assumption: 'Runway covers 9 months', reviewAt: new Date('2026-12-01T00:00:00Z'), confidence: 'LOW' },
    { assumption: 'Q3 launch holds', reviewAt: new Date('2026-11-01T00:00:00Z') },
  ],
  sourceMemoryIds: [],
};

function session(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: 'session_1', userId: 'u1', mode: 'decide',
    question: 'Should I hire a senior engineer now?\nContext line 2',
    personaResponses: new Map([['optimist', pr('optimist', 'Hire now', 0.8)], ['critic', pr('critic', 'Wait a quarter', 0.6)]]),
    synthesis,
    rebuttals: new Map<string, Rebuttal>([['critic', { personaId: 'critic', stance: 'concede', reason: 'r', revisedRecommendation: 'Hire now, phased', revisedConfidence: 0.55 }]]),
    projectIds: ['proj_1', 'proj_2'],
    ...overrides,
  };
}

describe('decision-commit — DecideBodySchema', () => {
  it('requires probabilitySuccess (0..1) and expectedOutcome', () => {
    expect(DecideBodySchema.safeParse({ chosenPath: 'Hire now' }).success).toBe(false);
    expect(DecideBodySchema.safeParse({ chosenPath: 'Hire now', expectedOutcome: 'x' }).success).toBe(false);
    expect(DecideBodySchema.safeParse({ chosenPath: 'Hire now', expectedOutcome: 'x', probabilitySuccess: 1.2 }).success).toBe(false);
    expect(DecideBodySchema.safeParse({ chosenPath: 'Hire now', expectedOutcome: 'x', probabilitySuccess: 0.65 }).success).toBe(true);
    const parsed = DecideBodySchema.parse({ chosenPath: 'Hire now', expectedOutcome: 'x', probabilitySuccess: 0.65, reviewAt: '2026-12-01' });
    expect(parsed.reviewAt).toBeInstanceOf(Date);
  });
});

describe('decision-commit — builders', () => {
  it('personaForecasts use the revised recommendation/confidence when a rebuttal happened', () => {
    expect(buildPersonaForecasts(session())).toEqual([
      { personaId: 'critic', recommendation: 'Hire now, phased', confidence: 0.55 },
      { personaId: 'optimist', recommendation: 'Hire now', confidence: 0.8 },
    ]);
  });

  it('assumptions come from the report, DecisionAssumption-shaped, MEDIUM when the CEO gave no confidence', () => {
    expect(buildAssumptions(session())).toEqual([
      { text: 'Runway covers 9 months', confidence: 'LOW', reviewAt: new Date('2026-12-01T00:00:00Z'), status: 'ACTIVE' },
      { text: 'Q3 launch holds', confidence: 'MEDIUM', reviewAt: new Date('2026-11-01T00:00:00Z'), status: 'ACTIVE' },
    ]);
    expect(buildAssumptions({ synthesis: null })).toEqual([]);
  });

  it('buildDecisionInput: mode from session, decidedAt now, reviewAt default +30d, status DECIDED, sessionId set', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    const input = buildDecisionInput(session({ mode: 'premortem' }), { chosenPath: 'Hire now', expectedOutcome: 'Ship Q3', probabilitySuccess: 0.65 }, now);
    expect(input).toMatchObject({
      title: 'Should I hire a senior engineer now?',
      chosenPath: 'Hire now', expectedOutcome: 'Ship Q3', probabilitySuccess: 0.65,
      status: 'DECIDED', sessionId: 'session_1', mode: 'premortem', decidedAt: now,
      rationale: 'speed vs runway',
    });
    expect(input.reviewAt.getTime()).toBe(now.getTime() + 30 * 86_400_000);
    expect(input.options.map(o => o.path)).toEqual(['Hire now', 'Hire now, phased']);
    expect(input.personaForecasts).toHaveLength(2);
    expect(input.assumptions).toHaveLength(2);
  });

  it('explicit reviewAt + rationale win over defaults', () => {
    const reviewAt = new Date('2027-01-15T00:00:00Z');
    const input = buildDecisionInput(session(), { chosenPath: 'Wait', rationale: 'cash', expectedOutcome: 'x', probabilitySuccess: 0.4, reviewAt });
    expect(input.reviewAt).toBe(reviewAt);
    expect(input.rationale).toBe('cash');
  });
});

describe('decision-commit — commitDecision', () => {
  it('creates via OmniMind, links every project id, remembers decisionId; link failures are swallowed', async () => {
    const s = session();
    const omnimind = {
      createDecision: vi.fn().mockResolvedValue({ id: 'dec_1', chosenPath: 'Hire now' }),
      linkProjectDecision: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('404')),
    };
    const decision = await commitDecision(s, { chosenPath: 'Hire now', expectedOutcome: 'x', probabilitySuccess: 0.7 }, omnimind as any);
    expect(decision.id).toBe('dec_1');
    expect(s.decisionId).toBe('dec_1');
    expect(omnimind.createDecision).toHaveBeenCalledWith('u1', expect.objectContaining({ sessionId: 'session_1', personaForecasts: expect.any(Array) }));
    expect(omnimind.linkProjectDecision).toHaveBeenCalledTimes(2);
    expect(omnimind.linkProjectDecision).toHaveBeenCalledWith('u1', 'proj_1', 'dec_1');
    expect(omnimind.linkProjectDecision).toHaveBeenCalledWith('u1', 'proj_2', 'dec_1');
  });
});
