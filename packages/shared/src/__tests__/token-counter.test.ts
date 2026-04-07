import { describe, it, expect } from 'vitest';
import { estimateTokens, isWithinBudget, estimateTokensForItems } from '../utils/token-counter';

describe('estimateTokens', () => {
  it('returns roughly chars/4', () => {
    const text = 'a'.repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });
});

describe('isWithinBudget', () => {
  it('returns true when under budget', () => {
    const text = 'a'.repeat(40); // ~10 tokens
    expect(isWithinBudget(text, 20)).toBe(true);
  });

  it('returns false when over budget', () => {
    const text = 'a'.repeat(100); // ~25 tokens
    expect(isWithinBudget(text, 10)).toBe(false);
  });
});

describe('estimateTokensForItems', () => {
  it('combines items with separator and estimates total', () => {
    const items = ['hello', 'world'];
    // 'hello\nworld' = 11 chars => ceil(11/4) = 3
    expect(estimateTokensForItems(items)).toBe(3);
  });
});
