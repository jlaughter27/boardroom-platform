import { describe, it, expect } from 'vitest';
import {
  CreateDecisionSessionRequestSchema,
  UpdateDecisionSessionRequestSchema,
  ListDecisionSessionsQuerySchema,
  DecisionSessionSchema,
  DecisionSessionSummarySchema,
  CreateDecisionRequestSchema,
  DecisionSchema,
  DecisionSessionStatus,
  DECISION_SESSION_QUESTION_MAX_CHARS,
  DECISION_SESSION_STATE_MAX_BYTES,
} from '../index';

describe('RD-17 decision-session schemas', () => {
  it('create: question required, unknown keys refused, status is the enum', () => {
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: 'Open a second stall?', mode: 'decide' }).success).toBe(true);
    expect(CreateDecisionSessionRequestSchema.safeParse({ mode: 'decide' }).success).toBe(false);
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: '' }).success).toBe(false);
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: 'q', userId: 'cother' }).success).toBe(false);
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: 'q', status: 'ARCHIVED' }).success).toBe(false);
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: 'q', status: DecisionSessionStatus.SYNTHESIZED }).success).toBe(true);
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: 'x'.repeat(DECISION_SESSION_QUESTION_MAX_CHARS + 1) }).success).toBe(false);
  });

  it('create: state is an object or null (never an array or a string)', () => {
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: 'q', state: { v: 1 } }).success).toBe(true);
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: 'q', state: null }).success).toBe(true);
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: 'q', state: [1] }).success).toBe(false);
    expect(CreateDecisionSessionRequestSchema.safeParse({ question: 'q', state: 'blob' }).success).toBe(false);
  });

  it('update: non-empty subset, question optional, strict', () => {
    expect(UpdateDecisionSessionRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateDecisionSessionRequestSchema.safeParse({ status: 'DECIDED' }).success).toBe(true);
    expect(UpdateDecisionSessionRequestSchema.safeParse({ deletedAt: null }).success).toBe(false);
  });

  it('list query: limit 1..100, offset ≥ 0, coerced from strings', () => {
    expect(ListDecisionSessionsQuerySchema.parse({ limit: '5', offset: '10' })).toEqual({ limit: 5, offset: 10 });
    expect(ListDecisionSessionsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(ListDecisionSessionsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(ListDecisionSessionsQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });

  it('record + summary parse the wire shape; legacy rows default the RD-17 fields', () => {
    const legacy = DecisionSessionSchema.parse({
      id: 'c1', userId: 'u1', roomId: null, question: 'q', personaResponses: {}, ceoSynthesis: null,
      createdAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-10-30T10:00:00.000Z',
    });
    expect(legacy).toMatchObject({ mode: null, status: 'OPEN', state: null, decisionId: null });
    expect(legacy.createdAt).toBeInstanceOf(Date);
    expect(DecisionSessionSummarySchema.safeParse({
      id: 'c1', question: 'q', mode: 'decide', status: 'DISPATCHED', personaCount: 6, hasSynthesis: false, decisionId: null,
      createdAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-10-30T10:00:00.000Z',
    }).success).toBe(true);
  });

  it('decisions: decisionSessionId accepted on create, defaulted to null on the record', () => {
    expect(CreateDecisionRequestSchema.parse({ title: 't', question: 'q', decisionSessionId: 'c1' }).decisionSessionId).toBe('c1');
    expect(CreateDecisionRequestSchema.safeParse({ title: 't', question: 'q', decisionSessionId: '' }).success).toBe(false);
    const d = DecisionSchema.parse({
      id: 'd1', userId: 'u1', title: 't', question: 'q', options: [], chosenPath: null, rationale: null, assumptions: [],
      constraints: [], status: 'OPEN', reviewAt: null, outcome: null, outcomeRating: null, sessionId: null, version: 1,
      createdAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-10-30T10:00:00.000Z',
    });
    expect(d.decisionSessionId).toBeNull();
  });

  it('the snapshot limit is 512 kB', () => {
    expect(DECISION_SESSION_STATE_MAX_BYTES).toBe(524_288);
  });
});
