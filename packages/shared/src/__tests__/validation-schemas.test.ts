import { describe, it, expect } from 'vitest';
import {
  // Memory schemas
  MemorySchema,
  CreateMemoryRequestSchema,
  UpdateMemoryRequestSchema,
  MemoryProposalSchema,
  
  // Persona schemas
  PersonaResponseSchema,
  QuestionnaireResponseSchema,
  SynthesisReportSchema,
  
  // Entity schemas
  PersonSchema,
  CreatePersonRequestSchema,
  GoalSchema,
  CreateGoalRequestSchema,
  ProjectSchema,
  ProjectWithLinksSchema,
  CreateProjectRequestSchema,
  TaskSchema,
  CreateTaskRequestSchema,
  
  // Decision schemas
  DecisionSchema,
  CreateDecisionRequestSchema,
  DecisionSessionSchema,
  
  // Commitment schemas
  CommitmentSchema,
  CreateCommitmentRequestSchema,
  
  // ContextCapsule schemas
  ContextCapsuleSchema,
  CreateContextCapsuleRequestSchema,
  
  // UserProfile schemas
  UserProfileSchema,
  CreateUserProfileRequestSchema,
  
  // Enum schemas
  MemoryClassSchema,
  MemoryStatusSchema,
  ConfidenceSchema,
  SourceTypeSchema,
  DecisionStatusSchema,
  CommitmentStatusSchema,

  // RD-11 displacement
  DisplacementSchema,
  StopItemSchema,
} from '../validation';
import type { Displacement, StopItem } from '../types/persona.types';
import type { DisplacementSchemaParity, StopItemSchemaParity } from '../validation/persona.schema';

describe('Enum Schemas', () => {
  it('validates MemoryClass enum values', () => {
    expect(MemoryClassSchema.parse('WORKING')).toBe('WORKING');
    expect(MemoryClassSchema.parse('EPISODIC')).toBe('EPISODIC');
    expect(MemoryClassSchema.parse('SEMANTIC')).toBe('SEMANTIC');
    expect(MemoryClassSchema.parse('DECISION')).toBe('DECISION');
    expect(() => MemoryClassSchema.parse('INVALID')).toThrow();
  });

  it('validates Confidence enum values', () => {
    expect(ConfidenceSchema.parse('HIGH')).toBe('HIGH');
    expect(ConfidenceSchema.parse('MEDIUM')).toBe('MEDIUM');
    expect(ConfidenceSchema.parse('LOW')).toBe('LOW');
    expect(ConfidenceSchema.parse('SPECULATIVE')).toBe('SPECULATIVE');
  });

  it('validates SourceType enum values', () => {
    expect(SourceTypeSchema.parse('MANUAL')).toBe('MANUAL');
    expect(SourceTypeSchema.parse('BOARDROOM_SESSION')).toBe('BOARDROOM_SESSION');
    expect(SourceTypeSchema.parse('API_IMPORT')).toBe('API_IMPORT');
    expect(SourceTypeSchema.parse('AGENT_EXTRACTED')).toBe('AGENT_EXTRACTED');
  });
});

describe('Memory Schemas', () => {
  const validMemory = {
    id: 'mem_123',
    userId: 'user_456',
    title: 'Project Kickoff',
    content: 'Meeting notes from project kickoff',
    domain: 'business',
    sector: 'technology',
    tags: ['meeting', 'kickoff'],
    memoryClass: 'SEMANTIC' as const,
    importance: 0.7,
    confidence: 'MEDIUM' as const,
    status: 'CONFIRMED' as const,
    validAt: new Date('2024-01-15'),
    invalidAt: null,
    supersededBy: null,
    sourceType: 'BOARDROOM_SESSION' as const,
    sourceRef: 'session_789',
    sourceWeight: 1.0,
    version: 1,
    metadata: { participantCount: 5 },
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
    lastAccessedAt: new Date('2024-01-16'),
  };

  it('validates a complete Memory object', () => {
    expect(MemorySchema.parse(validMemory)).toEqual(validMemory);
  });

  it('validates CreateMemoryRequest with minimal fields', () => {
    const request = {
      title: 'New Memory',
      content: 'Memory content',
      domain: 'personal',
      sourceType: 'MANUAL' as const,
    };
    expect(CreateMemoryRequestSchema.parse(request)).toEqual(request);
  });

  it('CreateMemoryRequest accepts dedup: false and rejects NUL characters (Postgres text cannot store U+0000)', () => {
    const base = { title: 'T', content: 'C', domain: 'business', sourceType: 'API_IMPORT' as const };
    expect(CreateMemoryRequestSchema.parse({ ...base, dedup: false }).dedup).toBe(false);
    const bad = CreateMemoryRequestSchema.safeParse({ ...base, content: 'a\u0000b' });
    expect(bad.success).toBe(false);
    expect(bad.success ? '' : bad.error.issues[0].message).toMatch(/NUL/);
    expect(CreateMemoryRequestSchema.safeParse({ ...base, title: 'x\u0000' }).success).toBe(false);
    expect(UpdateMemoryRequestSchema.safeParse({ content: '\u0000' }).success).toBe(false);
  });

  it('validates UpdateMemoryRequest with partial fields', () => {
    const update = {
      title: 'Updated Title',
      importance: 0.8,
      tags: ['updated'],
    };
    expect(UpdateMemoryRequestSchema.parse(update)).toEqual(update);
  });

  it('validates MemoryProposal for agent extraction', () => {
    const proposal = {
      action: 'ADD' as const,
      title: 'Proposed Memory',
      content: 'Content extracted from session',
      domain: 'business',
      tags: ['extracted'],
      memoryClass: 'WORKING' as const,
      importance: 0.5,
      confidence: 'MEDIUM' as const,
      sourceType: 'AGENT_EXTRACTED' as const,
      sourceRef: 'session_abc',
    };
    expect(MemoryProposalSchema.parse(proposal)).toEqual(proposal);
  });
});

describe('Person Schemas', () => {
  const validPerson = {
    id: 'person_123',
    userId: 'user_456',
    name: 'John Doe',
    role: 'CTO',
    domains: ['technology', 'leadership'],
    importance: 0.8,
    relationshipToUser: 'colleague',
    lastContactAt: new Date('2024-01-10'),
    notes: 'Met at conference',
    interactionFrequency: 5,
    version: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  it('validates a complete Person object', () => {
    expect(PersonSchema.parse(validPerson)).toEqual(validPerson);
  });

  it('validates CreatePersonRequest with minimal fields', () => {
    const request = {
      name: 'Jane Smith',
    };
    expect(CreatePersonRequestSchema.parse(request)).toEqual(request);
  });
});

describe('Goal Schemas', () => {
  const validGoal = {
    id: 'goal_123',
    userId: 'user_456',
    title: 'Increase Revenue',
    level: 1,
    parentGoalId: null,
    successMetrics: ['20% growth', '$1M ARR'],
    deadline: new Date('2024-12-31'),
    status: 'active',
    domain: 'business',
    version: 1,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  it('validates a complete Goal object', () => {
    expect(GoalSchema.parse(validGoal)).toEqual(validGoal);
  });

  it('validates CreateGoalRequest with minimal fields', () => {
    const request = {
      title: 'Learn TypeScript',
    };
    expect(CreateGoalRequestSchema.parse(request)).toEqual(request);
  });
});

// ── RD-11 — SynthesisReport.displacement ──

describe('SynthesisReportSchema.displacement (RD-11)', () => {
  const base = {
    disagreementMap: 'Optimist vs Critic on timing',
    decisiveTradeoff: 'Speed vs focus',
    recommendation: 'Proceed after pausing one project',
    nextActions: ['Draft the offer'],
    topRisks: ['Overextension'],
    assumptionsToMonitor: [],
    sourceMemoryIds: [],
  };

  it('parses a report without displacement (pre-RD-11 / review mode)', () => {
    const out = SynthesisReportSchema.parse(base);
    expect(out.displacement).toBeUndefined();
    expect(out.recommendation).toBe(base.recommendation);
  });

  it('parses a valid displacement', () => {
    const displacement = { answer: 'Pause the podcast relaunch to make room.', stops: [{ title: 'Podcast relaunch', action: 'pause' }], netNew: false };
    expect(SynthesisReportSchema.parse({ ...base, displacement }).displacement).toEqual(displacement);
  });

  it('truncates 5 stops to 3', () => {
    const stops = ['A', 'B', 'C', 'D', 'E'].map(title => ({ title, action: 'defer' }));
    const out = SynthesisReportSchema.parse({ ...base, displacement: { answer: 'Too much at once.', stops, netNew: false } });
    expect(out.displacement?.stops.map(s => s.title)).toEqual(['A', 'B', 'C']);
  });

  it('drops junk stops (empty, "(none)", copied load-section lines) before capping at 3', () => {
    const stops = [
      { title: '(none)', action: 'pause' },
      { title: 'level: UNKNOWN', action: 'defer' },
      { title: '   ', action: 'stop' },
      { title: '', action: 'stop' },
      { title: 'Flags: none', action: 'defer' },
      { title: 'by domain (active projects / open commitments)', action: 'defer' },
      { title: '- business: 3 / 2', action: 'pause' },
      { title: 'Podcast relaunch', action: 'pause' },
      { title: 'Newsletter redesign', action: 'defer' },
      { title: 'Weekly ops review', action: 'delegate' },
      { title: 'Fourth real item', action: 'stop' },
    ];
    const out = SynthesisReportSchema.parse({ ...base, displacement: { answer: 'Too much at once.', stops, netNew: false } });
    expect(out.displacement?.stops).toEqual([
      { title: 'Podcast relaunch', action: 'pause' },
      { title: 'Newsletter redesign', action: 'defer' },
      { title: 'Weekly ops review', action: 'delegate' },
    ]);
  });

  it('a displacement whose only stops are junk keeps the answer with stops []', () => {
    const out = SynthesisReportSchema.parse({ ...base, displacement: { answer: 'Pause something.', stops: [{ title: '(none)', action: 'pause' }, { title: 'level: UNKNOWN', action: 'defer' }], netNew: false } });
    expect(out.displacement).toEqual({ answer: 'Pause something.', stops: [], netNew: false });
  });

  it('a missing stops array becomes []', () => {
    const out = SynthesisReportSchema.parse({ ...base, displacement: { answer: 'Nothing needs to stop.', netNew: true } });
    expect(out.displacement).toEqual({ answer: 'Nothing needs to stop.', stops: [], netNew: true });
  });

  it.each([
    ['an unknown action', { answer: 'Drop it.', stops: [{ title: 'Podcast relaunch', action: 'abandon' }], netNew: false }],
    ['an empty answer', { answer: '', stops: [], netNew: false }],
    ['a missing netNew', { answer: 'Pause it.', stops: [] }],
    ['a non-object', 'pause the podcast'],
  ])('%s gives displacement === undefined while every other field still parses', (_label, displacement) => {
    const result = SynthesisReportSchema.safeParse({ ...base, displacement });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.displacement).toBeUndefined();
    expect(result.data).toMatchObject(base);
  });

  it('StopItemSchema caps title length at 200 and rejects empty titles', () => {
    expect(StopItemSchema.safeParse({ title: 'x'.repeat(201), action: 'stop' }).success).toBe(false);
    expect(StopItemSchema.safeParse({ title: '', action: 'stop' }).success).toBe(false);
    expect(StopItemSchema.safeParse({ title: 'Podcast relaunch', action: 'renegotiate' }).success).toBe(true);
  });

  it('type-level parity: z.infer of DisplacementSchema / StopItemSchema equals Displacement / StopItem', () => {
    // Enforced at compile time in persona.schema.ts (`pnpm typecheck` fails on drift);
    // these assignments make the dependency explicit here as well.
    const displacementParity: DisplacementSchemaParity = true;
    const stopItemParity: StopItemSchemaParity = true;
    const parsed: Displacement = DisplacementSchema.parse({ answer: 'Defer the redesign.', stops: [{ title: 'Redesign', action: 'defer' }], netNew: false });
    const item: StopItem = StopItemSchema.parse({ title: 'Redesign', action: 'defer' });
    expect([displacementParity, stopItemParity]).toEqual([true, true]);
    expect(parsed.stops[0]).toEqual(item);
  });
});

// ── GET /projects?include=links ──

describe('ProjectWithLinksSchema', () => {
  const project = {
    id: 'p1', userId: 'u1', title: 'Saturday market stall', status: 'active', deadline: null,
    successMetrics: [], domain: 'business', version: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  };

  it('parses a project with goal / task link ids', () => {
    const out = ProjectWithLinksSchema.parse({ ...project, goalIds: ['g1'], taskIds: ['t1', 't2'] });
    expect(out.goalIds).toEqual(['g1']);
    expect(out.taskIds).toEqual(['t1', 't2']);
  });

  it('requires both id arrays', () => {
    expect(ProjectWithLinksSchema.safeParse({ ...project, goalIds: [] }).success).toBe(false);
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });
});
