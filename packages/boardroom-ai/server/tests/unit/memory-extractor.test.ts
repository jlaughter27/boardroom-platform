import { describe, it, expect, vi } from 'vitest';
import { extractMemories, type ExtractionResult } from '../../src/agents/memory-extractor';
import type { PersonaResponse, SynthesisReport } from '@boardroom/shared';

// Mock prompt-loader so it doesn't read from disk
vi.mock('../../src/lib/prompt-loader', () => ({
  loadPrompt: () => 'You are a memory extraction agent.',
}));

function makeMockClient(responsePayload: unknown[]) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text' as const, text: JSON.stringify(responsePayload) }],
      }),
    },
  } as any;
}

function makePersonaResponse(overrides?: Partial<PersonaResponse>): PersonaResponse {
  return {
    personaId: 'optimist',
    situationReading: 'Looks good',
    keyAssumptions: ['Growth continues'],
    analysis: 'Positive outlook',
    recommendation: 'Go for it',
    uncertainties: ['Market volatility'],
    sourceMemoryIds: [],
    confidence: 0.8,
    dissentFlag: false,
    ...overrides,
  };
}

const sampleProposal = {
  action: 'ADD',
  title: 'Company runway is 8 months',
  content: 'User stated their company has approximately 8 months of runway remaining.',
  domain: 'finance',
  tags: ['runway', 'cash-flow'],
  memoryClass: 'SEMANTIC',
  importance: 0.7,
  confidence: 'HIGH',
  sourceType: 'AGENT_EXTRACTED',
  sourceRef: 'session:test',
};

describe('memory-extractor', () => {
  it('returns valid MemoryProposal array', async () => {
    const client = makeMockClient([sampleProposal]);
    const responses = new Map([['optimist', makePersonaResponse()]]);

    const result = await extractMemories('What is our runway?', responses, null, client);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposalCount).toBe(1);
    expect(result.proposals[0].title).toBe('Company runway is 8 months');
    expect(result.proposals[0].action).toBe('ADD');
    expect(result.proposals[0].sourceType).toBe('AGENT_EXTRACTED');
  });

  it('categories are correctly counted', async () => {
    const proposals = [
      { ...sampleProposal, tags: ['runway', 'fact'] },
      { ...sampleProposal, title: 'Hire designer by May', tags: ['commitment', 'hiring'] },
      { ...sampleProposal, title: 'CTO Sarah', tags: ['person', 'team'] },
      { ...sampleProposal, title: 'Decision pattern', tags: ['profile', 'delegation'] },
      { ...sampleProposal, title: 'Risk aversion pattern', tags: ['pattern', 'behavior'] },
    ];
    const client = makeMockClient(proposals);
    const responses = new Map([['optimist', makePersonaResponse()]]);

    const result = await extractMemories('Complex question', responses, null, client);

    expect(result.proposalCount).toBe(5);
    expect(result.categories.facts).toBe(1);
    expect(result.categories.commitments).toBe(1);
    expect(result.categories.personMentions).toBe(1);
    expect(result.categories.profileObservations).toBe(2);
  });

  it('empty response returns empty proposals', async () => {
    const client = {
      messages: {
        create: async () => ({
          content: [{ type: 'image' as const }],
        }),
      },
    } as any;
    const responses = new Map([['optimist', makePersonaResponse()]]);

    const result = await extractMemories('Test question', responses, null, client);

    expect(result.proposals).toHaveLength(0);
    expect(result.proposalCount).toBe(0);
    expect(result.categories).toEqual({
      facts: 0,
      commitments: 0,
      personMentions: 0,
      profileObservations: 0,
    });
  });

  it('proposals have sourceType AGENT_EXTRACTED', async () => {
    const proposals = [
      sampleProposal,
      { ...sampleProposal, title: 'Second fact', sourceType: 'AGENT_EXTRACTED' },
    ];
    const client = makeMockClient(proposals);
    const responses = new Map([['optimist', makePersonaResponse()]]);

    const result = await extractMemories('Test question', responses, null, client);

    for (const proposal of result.proposals) {
      expect(proposal.sourceType).toBe('AGENT_EXTRACTED');
    }
  });

  it('handles synthesis context when present', async () => {
    const client = makeMockClient([sampleProposal]);
    const responses = new Map([['optimist', makePersonaResponse()]]);
    const synthesis: SynthesisReport = {
      disagreementMap: 'Minor disagreements on timeline',
      decisiveTradeoff: 'Speed vs thoroughness',
      recommendation: 'Proceed with caution',
      nextActions: ['Review runway', 'Update projections'],
      topRisks: ['Market downturn'],
      assumptionsToMonitor: [{ assumption: 'Growth rate holds', reviewAt: new Date() }],
      sourceMemoryIds: [],
    };

    const result = await extractMemories('What is our runway?', responses, synthesis, client);

    expect(result.proposals).toHaveLength(1);
    expect(result.proposalCount).toBe(1);
  });
});
