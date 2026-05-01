// Rate limit constants
// Enforced at the API gateway and session manager layers.
// Source: docs/02-reference/MASTER-FRAMEWORK.md §7 Rate Limiting

/**
 * Platform-wide rate limits.
 * CEO_MODE_PER_SESSION: max CEO synthesis calls per session
 * SESSIONS_PER_DAY: max boardroom sessions per user per day
 * MAX_OUTPUT_TOKENS_PER_PERSONA: default per-persona output cap
 * MAX_QUERIES_PER_MINUTE: API query rate limit per user
 * MAX_MEMORY_WRITES_PER_MINUTE: memory write rate limit per user
 * WINDOW_MS: token-bucket window size for per-minute limits
 */
export const RATE_LIMITS = {
  CEO_MODE_PER_SESSION: 10,
  SESSIONS_PER_DAY: 5,
  MAX_OUTPUT_TOKENS_PER_PERSONA: 2000,
  MAX_QUERIES_PER_MINUTE: 20,
  MAX_MEMORY_WRITES_PER_MINUTE: 30,
  WINDOW_MS: 60 * 1000,
} as const;
