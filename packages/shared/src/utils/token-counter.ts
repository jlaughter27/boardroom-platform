// Token estimation utilities for LLM budget management
// Used by context-packager to stay within per-persona token budgets

/**
 * Estimate the number of tokens in a text string.
 * Uses a rough heuristic of ~4 characters per token.
 * @param text - The text to estimate tokens for
 * @returns Estimated token count (rounded up)
 */
export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

/**
 * Check if a text string fits within a token budget.
 * @param text - The text to check
 * @param maxTokens - The maximum allowed token count
 * @returns true if the estimated token count is within budget
 */
export const isWithinBudget = (text: string, maxTokens: number): boolean => {
  return estimateTokens(text) <= maxTokens;
};

/**
 * Estimate the total token count for an array of items joined by a separator.
 * @param items - The text items to combine
 * @param separator - The separator string (default: '\n')
 * @returns Estimated token count for the combined text
 */
export const estimateTokensForItems = (items: string[], separator: string = '\n'): number => {
  const combined = items.join(separator);
  return estimateTokens(combined);
};
