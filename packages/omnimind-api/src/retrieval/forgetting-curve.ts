// Forgetting curve helpers shared across all retrieval layers.
// Default: exclude memories where importance < 0.4 AND the memory has not been
// touched (COALESCE(lastAccessedAt, createdAt)) in 90 days.
// Override with includeArchived=true to lift the filter.
//
// AUDIT-2026-10-02 / O-103: the curve previously tested `last_accessed_at`
// alone. That column is NULL until the first recall, so once decay pushed a
// never-surfaced memory under 0.4 it became permanently invisible to persona
// retrieval. All four layers now fall back to created_at.

export const ARCHIVE_CUTOFF_DAYS = 90;

export function archiveCutoffDate(): Date {
  return new Date(Date.now() - ARCHIVE_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
}

// Returns the SQL fragment to append to a WHERE clause in raw queries.
// Usage: `AND (${forgettingCurveSQL(includeArchived)})` — safe because the
// string contains only literals (no user input).
export function forgettingCurveSQL(includeArchived: boolean): string {
  if (includeArchived) return 'TRUE';
  return `(importance >= 0.4 OR COALESCE(last_accessed_at, created_at) >= NOW() - INTERVAL '${ARCHIVE_CUTOFF_DAYS} days')`;
}

export type RetrievalLayer = 'structured' | 'fts' | 'trigram' | 'semantic';

/**
 * F-204: retrieval layers tolerate a single layer failing (they return []),
 * but the failure is logged AND reported through this hook so the context
 * assembler can mark the package `degraded`.
 */
export type LayerErrorHook = (layer: RetrievalLayer, err: Error) => void;
