import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { enforceBudget, budgetStatus, budgetLimitFor } from '../../../src/memory/validation/budget-enforcer';
import { runValidationPipeline } from '../../../src/memory/validation/pipeline';
import { logger } from '../../../src/lib/logger';

const prismaWithCount = (n: number) => ({ memoryEntry: { count: async () => n } }) as any;

beforeEach(() => vi.clearAllMocks());

describe('enforceBudget', () => {
  it('should pass when under budget', async () => {
    const result = await enforceBudget('user-1', 'business', prismaWithCount(50));
    expect(result.valid).toBe(true);
    expect(result.currentCount).toBe(50);
    expect(result.limit).toBe(400);
    expect(result.errors).toHaveLength(0);
    expect(result.overAfterWrite).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // RD-4: budgets are soft — documented that way, now enforced that way.
  it('at the limit the write is still valid; the overage is flagged and logged', async () => {
    const result = await enforceBudget('user-1', 'business', prismaWithCount(400));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.currentCount).toBe(400);
    expect(result.limit).toBe(400);
    expect(result.overAfterWrite).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('memory_budget_exceeded'),
      expect.objectContaining({ event: 'memory_budget_exceeded', userId: 'user-1', domain: 'business', countBeforeWrite: 400, limit: 400 }));
  });

  it('far past the limit (ministry 300) it is still valid', async () => {
    const result = await enforceBudget('user-1', 'ministry', prismaWithCount(900));
    expect(result.valid).toBe(true);
    expect(result.limit).toBe(300);
    expect(result.overAfterWrite).toBe(true);
  });

  it('should use default limit for unknown domain', async () => {
    const result = await enforceBudget('user-1', 'unknown-domain', prismaWithCount(10));
    expect(result.valid).toBe(true);
    expect(result.limit).toBe(250);
    expect(budgetLimitFor('unknown-domain')).toBe(250);
  });

  it('budgetStatus: over means count > limit', () => {
    expect(budgetStatus('business', 400)).toEqual({ domain: 'business', count: 400, limit: 400, over: false });
    expect(budgetStatus('business', 401)).toEqual({ domain: 'business', count: 401, limit: 400, over: true });
    expect(budgetStatus('personal', 201).over).toBe(true);
  });
});

describe('runValidationPipeline — budget step (RD-4)', () => {
  const input = { title: 'T', content: 'C', domain: 'business', sourceType: 'MANUAL' };
  it('an over-budget write passes validation and reports the standing before the write', async () => {
    const r = await runValidationPipeline(input, 'user-1', 'business', prismaWithCount(400));
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.budget).toEqual({ domain: 'business', count: 400, limit: 400, over: false });
  });
  it('already past the limit → over: true, still valid', async () => {
    const r = await runValidationPipeline(input, 'user-1', 'business', prismaWithCount(450));
    expect(r.valid).toBe(true);
    expect(r.budget).toEqual({ domain: 'business', count: 450, limit: 400, over: true });
  });
});
