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
  it('accepts valid proposals with optional fields', () => {
    const input = [{ content: 'Meeting notes from Q2 review', domain: 'business', tags: ['meeting'] }];
    expect(EmailMemoryProposalsSchema.parse(input)).toEqual(input);
  });

  it('accepts minimal proposals (content only)', () => {
    const input = [{ content: 'Something important' }];
    expect(EmailMemoryProposalsSchema.parse(input)).toHaveLength(1);
  });

  it('passes through extra fields', () => {
    const input = [{ content: 'X', extra: true }];
    expect(EmailMemoryProposalsSchema.parse(input)[0]).toHaveProperty('extra', true);
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
