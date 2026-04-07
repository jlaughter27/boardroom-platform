import { describe, it, expect } from 'vitest';
import { getContextRequest } from '../../src/personas/context-strategy';

describe('context-strategy', () => {
  const question = 'Should I hire a new engineer?';
  const userId = 'user-123';

  it('CEO gets maxItemsCEO (15) and all entity types', () => {
    const req = getContextRequest('ceo', question, userId);
    expect(req.maxItems).toBe(15);
    expect(req.includeEntities).toEqual(['memories', 'people', 'goals', 'projects', 'decisions']);
    expect(req.query).toBe(question);
    expect(req.userId).toBe(userId);
    expect(req.persona).toBe('ceo');
  });

  it('optimist includes memories, goals, projects', () => {
    const req = getContextRequest('optimist', question, userId);
    expect(req.maxItems).toBe(10);
    expect(req.includeEntities).toContain('memories');
    expect(req.includeEntities).toContain('goals');
    expect(req.includeEntities).toContain('projects');
  });

  it('critic includes memories, decisions, commitments', () => {
    const req = getContextRequest('critic', question, userId);
    expect(req.maxItems).toBe(10);
    expect(req.includeEntities).toContain('memories');
    expect(req.includeEntities).toContain('decisions');
    expect(req.includeEntities).toContain('commitments');
  });

  it('technician includes memories, projects, tasks', () => {
    const req = getContextRequest('technician', question, userId);
    expect(req.maxItems).toBe(10);
    expect(req.includeEntities).toContain('memories');
    expect(req.includeEntities).toContain('projects');
    expect(req.includeEntities).toContain('tasks');
  });

  it('alternate includes memories, decisions, projects', () => {
    const req = getContextRequest('alternate', question, userId);
    expect(req.maxItems).toBe(10);
    expect(req.includeEntities).toContain('memories');
    expect(req.includeEntities).toContain('decisions');
    expect(req.includeEntities).toContain('projects');
  });

  it('all requests include base fields', () => {
    const req = getContextRequest('optimist', question, userId);
    expect(req.query).toBe(question);
    expect(req.persona).toBe('optimist');
    expect(req.userId).toBe(userId);
  });
});
