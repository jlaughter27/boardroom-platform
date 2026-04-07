import { describe, it, expect, beforeEach } from 'vitest';

// We need to re-import fresh module state for each test
// Use dynamic imports or accept shared state across tests in a single run

import { trackCall, getSessionCost } from '../../src/services/cost-tracker';

describe('cost-tracker', () => {
  // Use unique session IDs per test to avoid shared state issues
  let testSessionId: string;
  let counter = 0;

  beforeEach(() => {
    counter++;
    testSessionId = `test-session-${counter}-${Date.now()}`;
  });

  it('getSessionCost returns null for unknown session', () => {
    expect(getSessionCost('nonexistent-session')).toBeNull();
  });

  it('trackCall stores call record with correct cost calculation', () => {
    trackCall(testSessionId, 'optimist', 'haiku', 1000, 500);
    const session = getSessionCost(testSessionId);

    expect(session).not.toBeNull();
    expect(session!.calls).toHaveLength(1);
    expect(session!.calls[0].personaId).toBe('optimist');
    expect(session!.calls[0].model).toBe('haiku');
    expect(session!.calls[0].inputTokens).toBe(1000);
    expect(session!.calls[0].outputTokens).toBe(500);

    // Haiku: $1/MTok input, $5/MTok output
    // Cost = (1000/1_000_000) * 1 + (500/1_000_000) * 5
    //      = 0.001 + 0.0025 = 0.0035
    expect(session!.calls[0].cost).toBeCloseTo(0.0035, 6);
  });

  it('getSessionCost returns aggregated costs after multiple calls', () => {
    trackCall(testSessionId, 'optimist', 'haiku', 1000, 500);
    trackCall(testSessionId, 'critic', 'haiku', 2000, 1000);

    const session = getSessionCost(testSessionId);
    expect(session).not.toBeNull();
    expect(session!.calls).toHaveLength(2);
    expect(session!.totalInputTokens).toBe(3000);
    expect(session!.totalOutputTokens).toBe(1500);

    // Call 1: (1000/1M)*1 + (500/1M)*5 = 0.001 + 0.0025 = 0.0035
    // Call 2: (2000/1M)*1 + (1000/1M)*5 = 0.002 + 0.005  = 0.007
    // Total: 0.0105
    expect(session!.estimatedCost).toBeCloseTo(0.0105, 6);
  });

  it('cost calculation uses MODEL_COSTS correctly for Sonnet ($3/$15 per MTok)', () => {
    trackCall(testSessionId, 'ceo', 'sonnet', 1_000_000, 1_000_000);
    const session = getSessionCost(testSessionId);

    expect(session).not.toBeNull();
    // Sonnet: $3/MTok input, $15/MTok output
    // Cost = (1M/1M)*3 + (1M/1M)*15 = 3 + 15 = 18
    expect(session!.estimatedCost).toBeCloseTo(18, 2);
    expect(session!.calls[0].cost).toBeCloseTo(18, 2);
  });
});
