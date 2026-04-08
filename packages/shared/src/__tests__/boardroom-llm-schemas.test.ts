import { describe, it, expect } from 'vitest';
import {
  DoerTaskBreakdownSchema,
  ExtractedGoalsSchema,
  ExtractedProjectsSchema,
  EmailMemoryProposalsSchema,
  ExtractedCommitmentsSchema,
} from '../validation/boardroom-llm-response.schema';

describe('DoerTaskBreakdownSchema', () => {
  it('accepts valid task breakdown', () => {
    const input = { tasks: [{ title: 'Draft proposal', owner: 'Alice', priority: 'high' }] };
    expect(DoerTaskBreakdownSchema.parse(input)).toEqual(input);
  });

  it('accepts minimal tasks (title only)', () => {
    const input = { tasks: [{ title: 'Do thing' }] };
    expect(DoerTaskBreakdownSchema.parse(input).tasks).toHaveLength(1);
  });

  it('rejects missing tasks array', () => {
    expect(() => DoerTaskBreakdownSchema.parse({})).toThrow();
  });

  it('rejects invalid priority', () => {
    expect(() => DoerTaskBreakdownSchema.parse({ tasks: [{ title: 'X', priority: 'urgent' }] })).toThrow();
  });
});

describe('ExtractedGoalsSchema', () => {
  it('accepts valid goals', () => {
    const input = [{ title: 'Grow revenue', level: 1, domain: 'business' }];
    expect(ExtractedGoalsSchema.parse(input)).toEqual(input);
  });

  it('rejects level out of range', () => {
    expect(() => ExtractedGoalsSchema.parse([{ title: 'X', level: 5, domain: 'biz' }])).toThrow();
  });

  it('rejects non-array', () => {
    expect(() => ExtractedGoalsSchema.parse({ title: 'X' })).toThrow();
  });
});

describe('ExtractedProjectsSchema', () => {
  it('accepts valid projects', () => {
    const input = [{ title: 'Relaunch site', domain: 'business', status: 'active' }];
    expect(ExtractedProjectsSchema.parse(input)).toEqual(input);
  });

  it('rejects invalid status', () => {
    expect(() => ExtractedProjectsSchema.parse([{ title: 'X', domain: 'biz', status: 'done' }])).toThrow();
  });
});

describe('EmailMemoryProposalsSchema', () => {
  it('accepts valid proposals and applies defaults for optional fields', () => {
    const input = [{ content: 'Meeting notes from Q2 review', domain: 'business', tags: ['meeting'] }];
    const result = EmailMemoryProposalsSchema.parse(input);
    expect(result[0].content).toBe('Meeting notes from Q2 review');
    expect(result[0].domain).toBe('business');
    expect(result[0].tags).toEqual(['meeting']);
    expect(result[0].title).toBe('Email Extract');
    expect(result[0].memoryClass).toBe('SEMANTIC');
    expect(result[0].importance).toBe(0.5);
    expect(result[0].linkedPeople).toEqual([]);
  });

  it('accepts minimal proposals (content only)', () => {
    const input = [{ content: 'Something important' }];
    expect(EmailMemoryProposalsSchema.parse(input)).toHaveLength(1);
  });

  it('accepts full proposals with all fields', () => {
    const input = [{ content: 'X', title: 'Custom Title', domain: 'personal', tags: ['tag1'], memoryClass: 'EPISODIC', importance: 0.8, linkedPeople: ['Alice'] }];
    const result = EmailMemoryProposalsSchema.parse(input);
    expect(result[0].title).toBe('Custom Title');
    expect(result[0].memoryClass).toBe('EPISODIC');
    expect(result[0].importance).toBe(0.8);
    expect(result[0].linkedPeople).toEqual(['Alice']);
  });
});

describe('ExtractedCommitmentsSchema', () => {
  it('accepts valid commitments', () => {
    const input = [{ description: 'Send report by Friday', stakeholder: 'Bob', deadline: '2026-04-11' }];
    expect(ExtractedCommitmentsSchema.parse(input)).toEqual(input);
  });

  it('accepts null stakeholder and deadline', () => {
    const input = [{ description: 'Review docs', stakeholder: null, deadline: null }];
    expect(ExtractedCommitmentsSchema.parse(input)).toEqual(input);
  });

  it('rejects missing description', () => {
    expect(() => ExtractedCommitmentsSchema.parse([{ stakeholder: 'X', deadline: null }])).toThrow();
  });
});
