import { describe, it, expect } from 'vitest';
import { getContextRequest, rewriteQuery } from '../../src/personas/context-strategy';

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
    expect(req.query).toBe(rewriteQuery('optimist', question));
    expect(req.query).toContain(question);
    expect(req.persona).toBe('optimist');
    expect(req.userId).toBe(userId);
  });

  // Phase 6 — persona-specific retrieval
  describe('rewriteQuery', () => {
    it('Critic → risks / failures / past mistakes', () => {
      expect(rewriteQuery('critic', question)).toBe(`risks, failures, past mistakes, what went wrong about: ${question}`);
    });
    it('Doer → tasks / deadlines / commitments / owners', () => {
      expect(rewriteQuery('doer', question)).toBe(`tasks, deadlines, commitments, owners about: ${question}`);
    });
    it('Technician → implementation / constraints / dependencies', () => {
      expect(rewriteQuery('technician', question)).toBe(`implementation, constraints, dependencies about: ${question}`);
    });
    it('Optimist → opportunities / wins / momentum', () => {
      expect(rewriteQuery('optimist', question)).toBe(`opportunities, wins, momentum about: ${question}`);
    });
    it('default personas (ceo, alternate, questionnaire, custom) keep the question verbatim', () => {
      for (const p of ['ceo', 'alternate', 'questionnaire', 'my-custom-persona']) {
        expect(rewriteQuery(p, question)).toBe(question);
      }
    });
    it('is deterministic', () => {
      expect(rewriteQuery('critic', question)).toBe(rewriteQuery('critic', question));
    });
  });

  it('critic requests includeArchived + DECISION memoryClass; others do not', () => {
    const critic = getContextRequest('critic', question, userId);
    expect(critic.includeArchived).toBe(true);
    expect(critic.memoryClass).toBe('DECISION');
    const optimist = getContextRequest('optimist', question, userId);
    expect(optimist.includeArchived).toBeUndefined();
    expect(optimist.memoryClass).toBeUndefined();
  });

  it('forwards asOf only when the session carries one', () => {
    const asOf = '2026-09-01T00:00:00.000Z';
    expect(getContextRequest('technician', question, userId, { asOf }).asOf).toBe(asOf);
    expect(getContextRequest('ceo', question, userId, { asOf }).asOf).toBe(asOf);
    expect(getContextRequest('technician', question, userId)).not.toHaveProperty('asOf');
  });
});
