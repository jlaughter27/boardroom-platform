/**
 * Audit 2026-10-02 — S-101 / S-102 / S-103 regression coverage.
 */
import { describe, it, expect } from 'vitest';
import {
  MemorySchema,
  MemoryApiRecordSchema,
  GoalSchema,
  AssumptionSchema,
  DecisionSchema,
  DecisionStatusSchema,
  CommitmentStatusSchema,
  DecisionStatus,
  CommitmentStatus,
  normalizeDomain,
  isMinistryDomain,
} from '../index';
import type { Memory, MemoryApiRecord, Goal, Assumption } from '../index';
import { sha256Hash as nodeSha256, validateEnv as nodeValidateEnv } from '../node';

const baseMemory = {
  id: 'mem_1',
  userId: 'user_1',
  title: 't',
  content: 'c',
  domain: 'business',
  sector: '',
  tags: [],
  memoryClass: 'SEMANTIC',
  importance: 0.5,
  confidence: 'MEDIUM',
  status: 'CONFIRMED',
  validAt: '2026-01-01T00:00:00.000Z',
  invalidAt: null,
  supersededBy: null,
  sourceType: 'MCP_AGENT',
  sourceRef: null,
  sourceWeight: 1,
  version: 1,
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastAccessedAt: null,
};

describe('S-101 Memory carries the Prisma multi-agent columns (optional)', () => {
  it('MemorySchema still accepts the legacy shape without the new fields', () => {
    expect(() => MemorySchema.parse(baseMemory)).not.toThrow();
  });

  it('MemorySchema accepts a full OmniMind row with tenant/agent/encryption fields', () => {
    const parsed = MemorySchema.parse({
      ...baseMemory,
      agentId: 'claude-code-josh',
      tenantId: 'josh-business',
      deletedAt: null,
      recallCount: 3,
      embeddingModel: 'openai-text-embedding-3-small',
      encryptionKeyId: null,
      encryptionAlgorithm: 'aes-256-gcm',
    });
    expect(parsed.tenantId).toBe('josh-business');
    expect(parsed.recallCount).toBe(3);
    const typed: Memory = parsed; // TS: schema output assignable to the interface
    expect(typed.agentId).toBe('claude-code-josh');
  });

  it('MemoryApiRecordSchema is the ISO-string wire form', () => {
    const rec = MemoryApiRecordSchema.parse({ ...baseMemory, tenantId: 'josh-personal' });
    const typed: MemoryApiRecord = rec;
    expect(typeof typed.createdAt).toBe('string');
    expect(() => MemoryApiRecordSchema.parse({ ...baseMemory, recallCount: -1 })).toThrow();
  });
});

describe('S-102 TS/Zod agreement', () => {
  it('Goal.level is a number constrained to 0..3 by Zod', () => {
    const g: Goal = {
      id: 'g', userId: 'u', title: 'x', level: 2, parentGoalId: null, successMetrics: [],
      deadline: null, status: 'active', domain: '', version: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    expect(GoalSchema.parse(g).level).toBe(2);
    expect(() => GoalSchema.parse({ ...g, level: 4 })).toThrow();
  });

  it('Assumption.confidence accepts SPECULATIVE (a real Prisma value)', () => {
    const a: Assumption = { text: 'x', confidence: 'SPECULATIVE', reviewAt: null, status: 'ACTIVE' };
    expect(AssumptionSchema.parse(a).confidence).toBe('SPECULATIVE');
  });

  it('outcomeRating must be an integer', () => {
    const base = {
      id: 'd', userId: 'u', title: 't', question: 'q', options: [], chosenPath: null, rationale: null,
      assumptions: [], constraints: [], status: 'OPEN', reviewAt: null, outcome: null, outcomeRating: 4,
      sessionId: null, version: 1, createdAt: new Date(), updatedAt: new Date(),
    };
    expect(DecisionSchema.parse(base).outcomeRating).toBe(4);
    expect(() => DecisionSchema.parse({ ...base, outcomeRating: 3.5 })).toThrow();
  });

  it('DecisionStatus / CommitmentStatus enums keep their string values', () => {
    expect(DecisionStatus.OPEN).toBe('OPEN');
    expect(DecisionStatusSchema.parse('REVISED')).toBe(DecisionStatus.REVISED);
    expect(CommitmentStatus.DEFERRED).toBe('DEFERRED');
    expect(CommitmentStatusSchema.parse('MISSED')).toBe(CommitmentStatus.MISSED);
    expect(() => DecisionStatusSchema.parse('NOPE')).toThrow();
    expect(() => CommitmentStatusSchema.parse('NOPE')).toThrow();
  });
});

describe('normalizeDomain', () => {
  it('trims and lowercases', () => {
    expect(normalizeDomain('  Ministry ')).toBe('ministry');
    expect(normalizeDomain(undefined)).toBe('');
    expect(isMinistryDomain('MINISTRY')).toBe(true);
    expect(isMinistryDomain('business')).toBe(false);
  });
});

describe('S-103 @boardroom/shared/node subpath', () => {
  it('exposes the Node-only utilities', () => {
    expect(nodeSha256('a')).toHaveLength(64);
    expect(() => nodeValidateEnv([])).not.toThrow();
  });
});

describe('TOOL_PERMISSIONS matches the registered tool set (B-114)', () => {
  it('does not grant document_read to any persona', async () => {
    const { TOOL_PERMISSIONS } = await import('../index');
    expect(Object.keys(TOOL_PERMISSIONS).sort()).toEqual(['calculator', 'web_search']);
    expect((TOOL_PERMISSIONS as Record<string, unknown>).document_read).toBeUndefined();
  });
});
