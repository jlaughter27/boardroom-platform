// Memory configuration constants
// REFERENCE VALUES ported from OmniMind system/config.json (April 2026)
// These were tuned over 20+ weeks of iteration on the file-based system.
// Adapted for PostgreSQL-backed architecture — line budgets replaced with
// row counts, but decay rates and scoring weights carry over directly.

/**
 * Decay half-lives by memory sector (in days).
 * After this many days, a memory's recency factor drops to 50%.
 * null = never decays (procedural knowledge persists forever).
 *
 * Ported from: omnimind/system/config.json → decay
 */
export const DECAY_HALF_LIFE_DAYS: Record<string, number | null> = {
  episodic: 30,
  semantic: 365,
  procedural: null,
  emotional: 90,
  reflective: 365,
};

/**
 * Sector weights for composite scoring.
 * Higher weight = more likely to surface in retrieval.
 *
 * Ported from: omnimind/system/config.json → scoring.sector_weights
 */
export const SECTOR_WEIGHTS: Record<string, number> = {
  episodic: 0.7,
  semantic: 1.0,
  procedural: 1.2,
  emotional: 0.6,
  reflective: 0.9,
};

/**
 * Composite scoring formula (for reference — implement in ranker.ts):
 * score = importance × recency_factor × frequency_factor × sector_weight
 *
 * Where recency_factor = 2^(-days_since_created / half_life_days)
 */
export const ARCHIVAL_THRESHOLD = 0.05;

/**
 * Domain-specific memory budget limits (max entries per domain per user).
 * Replaces OmniMind's line-count budgets for PostgreSQL context.
 * These are soft limits — exceeded triggers curator eviction proposals.
 */
export const DOMAIN_MEMORY_BUDGETS: Record<string, number> = {
  ministry: 300,
  business: 400,
  personal: 200,
  'ai-systems': 300,
  default: 250,
};

/**
 * Extraction confidence thresholds.
 * Ported from: omnimind/system/config.json → extraction
 */
export const EXTRACTION_CONFIG = {
  confidenceLevels: ['HIGH', 'MEDIUM', 'LOW', 'SPECULATIVE'] as const,
  autoPromoteThreshold: 'MEDIUM' as const,
  requireReviewBelow: 'LOW' as const,
};

/**
 * Retrieval limits — enforced in context-packager.ts
 */
export const RETRIEVAL_CONFIG = {
  maxItemsPerPersona: 10,
  maxItemsCEO: 15,
  tokenBudgetPerPersona: 2000,
  tokenBudgetCEO: 3000,
};

/**
 * Memory retention tiers.
 * Hot: full entries in PostgreSQL
 * Warm: summarized, full text in cold storage
 * Cold: summaries only
 */
export const RETENTION_TIERS = {
  hotDays: 90,
  warmDays: 365,
};

/**
 * Source weight defaults.
 * Human-stated facts are ground truth. Agent-inferred are provisional.
 */
export const SOURCE_WEIGHTS: Record<string, number> = {
  MANUAL: 1.0,
  BOARDROOM_SESSION: 0.8,
  API_IMPORT: 0.7,
  AGENT_EXTRACTED: 0.5,
  MCP_AGENT: 0.85,
  SESSION_SUMMARY: 0.7,
};

/**
 * Rollup configuration.
 * Ported from: omnimind/system/config.json → rollup
 */
export const ROLLUP_CONFIG = {
  frequency: 'weekly' as const,
  autoArchiveThresholdDays: 90,
  compressionStages: 3,
  maxUnprocessedBeforeAlert: 3,
};
