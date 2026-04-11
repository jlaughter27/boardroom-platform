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
} from '../validation';

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