import { describe, it, expect } from 'vitest';
import { exportSession } from '../../src/services/export.service';
import type { SessionState } from '../../src/agents/orchestrator';
import type { PersonaId, PersonaResponse, SynthesisReport } from '@boardroom/shared';

function makePersonaResponse(personaId: PersonaId): PersonaResponse {
  return {
    personaId,
    situationReading: `${personaId} reading`,
    keyAssumptions: ['assumption 1'],
    analysis: `${personaId} analysis`,
    recommendation: `${personaId} recommendation`,
    uncertainties: ['uncertainty 1'],
    sourceMemoryIds: ['mem_1'],
    confidence: 0.8,
    dissentFlag: false,
  };
}

function makeSynthesis(): SynthesisReport {
  return {
    disagreementMap: 'personas disagree on timeline',
    decisiveTradeoff: 'speed vs quality',
    recommendation: 'proceed with caution',
    nextActions: ['action 1', 'action 2'],
    topRisks: ['risk 1'],
    assumptionsToMonitor: [
      { assumption: 'market stays stable', reviewAt: new Date('2026-05-01') },
    ],
    sourceMemoryIds: ['mem_1', 'mem_2'],
  };
}

function makeSession(opts?: { withSynthesis?: boolean }): SessionState {
  const responses = new Map<PersonaId, PersonaResponse>();
  responses.set('optimist', makePersonaResponse('optimist'));
  responses.set('critic', makePersonaResponse('critic'));

  return {
    id: 'session_1',
    userId: 'user_1',
    question: 'Should we expand to Europe?',
    mode: 'decide',
    personaResponses: responses,
    synthesis: opts?.withSynthesis ? makeSynthesis() : null,
  };
}

describe('exportSession', () => {
  it('returns correct structure with all fields', () => {
    const session = makeSession({ withSynthesis: true });
    const result = exportSession(session);

    expect(result.question).toBe('Should we expand to Europe?');
    expect(result.mode).toBe('decide');
    expect(result.synthesis).not.toBeNull();
    expect(result.actionItems).toEqual(['action 1', 'action 2']);
    expect(result.assumptions).toHaveLength(1);
    expect(result.assumptions[0].assumption).toBe('market stays stable');
    expect(result.assumptions[0].reviewAt).toBe('2026-05-01T00:00:00.000Z');
    expect(result.createdAt).toBeDefined();
    expect(result.exportedAt).toBeDefined();
  });

  it('with no synthesis returns null synthesis and empty arrays', () => {
    const session = makeSession({ withSynthesis: false });
    const result = exportSession(session);

    expect(result.synthesis).toBeNull();
    expect(result.actionItems).toEqual([]);
    expect(result.assumptions).toEqual([]);
  });

  it('includes all persona responses in perspectives', () => {
    const session = makeSession({ withSynthesis: true });
    const result = exportSession(session);

    expect(Object.keys(result.perspectives)).toEqual(['optimist', 'critic']);
    expect((result.perspectives['optimist'] as PersonaResponse).personaId).toBe('optimist');
    expect((result.perspectives['critic'] as PersonaResponse).personaId).toBe('critic');
  });
});
