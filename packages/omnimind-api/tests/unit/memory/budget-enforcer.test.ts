import { describe, it, expect } from 'vitest';
import { enforceBudget } from '../../../src/memory/validation/budget-enforcer';

describe('enforceBudget', () => {
  it('should pass when under budget', async () => {
    const mockPrisma = {
      memoryEntry: {
        count: async () => 50,
      },
    } as any;

    const result = await enforceBudget('user-1', 'business', mockPrisma);
    expect(result.valid).toBe(true);
    expect(result.currentCount).toBe(50);
    expect(result.limit).toBe(400);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when at limit for ministry domain', async () => {
    const mockPrisma = {
      memoryEntry: {
        count: async () => 300,
      },
    } as any;

    const result = await enforceBudget('user-1', 'ministry', mockPrisma);
    expect(result.valid).toBe(false);
    expect(result.currentCount).toBe(300);
    expect(result.limit).toBe(300);
    expect(result.errors.some(e => e.field === 'domain')).toBe(true);
  });

  it('should use default limit for unknown domain', async () => {
    const mockPrisma = {
      memoryEntry: {
        count: async () => 10,
      },
    } as any;

    const result = await enforceBudget('user-1', 'unknown-domain', mockPrisma);
    expect(result.valid).toBe(true);
    expect(result.limit).toBe(250);
  });
});
