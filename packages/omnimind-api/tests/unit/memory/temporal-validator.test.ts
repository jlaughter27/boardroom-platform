import { describe, it, expect } from 'vitest';
import { validateTemporalConsistency } from '../../../src/memory/validation/temporal-validator';

const mockPrisma = {
  memoryEntry: {
    count: async () => 0,
    findUnique: async () => null,
  },
} as any;

describe('validateTemporalConsistency', () => {
  it('should pass when no temporal fields are provided', async () => {
    const result = await validateTemporalConsistency({}, mockPrisma);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when invalidAt is before validAt', async () => {
    const result = await validateTemporalConsistency(
      {
        validAt: new Date('2026-04-06'),
        invalidAt: new Date('2026-04-05'),
      },
      mockPrisma
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'invalidAt')).toBe(true);
  });

  it('should fail when supersededBy points to a nonexistent memory', async () => {
    const result = await validateTemporalConsistency(
      { supersededBy: 'nonexistent-id' },
      mockPrisma
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'supersededBy')).toBe(true);
  });
});
