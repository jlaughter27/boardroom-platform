import { describe, it, expect } from 'vitest';
import { isStale, getRetentionTier, isOverdue, daysUntil, daysSince } from '../utils/temporal';

const daysAgo = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const daysFromNow = (days: number): Date => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

describe('isStale', () => {
  it('returns true for a date 30 days ago with threshold 14', () => {
    expect(isStale(daysAgo(30), 14)).toBe(true);
  });

  it('returns false for today with threshold 14', () => {
    expect(isStale(new Date(), 14)).toBe(false);
  });
});

describe('getRetentionTier', () => {
  it('returns "hot" for a date 30 days ago', () => {
    expect(getRetentionTier(daysAgo(30))).toBe('hot');
  });

  it('returns "warm" for a date 200 days ago', () => {
    expect(getRetentionTier(daysAgo(200))).toBe('warm');
  });

  it('returns "cold" for a date 400 days ago', () => {
    expect(getRetentionTier(daysAgo(400))).toBe('cold');
  });
});

describe('isOverdue', () => {
  it('returns true for yesterday', () => {
    expect(isOverdue(daysAgo(1))).toBe(true);
  });

  it('returns false for tomorrow', () => {
    expect(isOverdue(daysFromNow(1))).toBe(false);
  });
});

describe('daysUntil', () => {
  it('returns negative for past dates', () => {
    expect(daysUntil(daysAgo(10))).toBeLessThan(0);
  });
});

describe('daysSince', () => {
  it('returns positive for past dates', () => {
    expect(daysSince(daysAgo(10))).toBeGreaterThan(0);
  });
});
