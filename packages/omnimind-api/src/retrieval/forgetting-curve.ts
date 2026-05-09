// Forgetting curve helpers shared across all retrieval layers.
// Default: exclude memories where importance < 0.4 AND lastAccessedAt < 90 days ago.
// Override with includeArchived=true to lift the filter.

export const ARCHIVE_CUTOFF_DAYS = 90;

export function archiveCutoffDate(): Date {
  return new Date(Date.now() - ARCHIVE_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
}

// Returns the SQL fragment to append to a WHERE clause in raw queries.
// Usage: `AND (${forgettingCurveSQL(includeArchived)})` — safe because the
// string contains only literals (no user input).
export function forgettingCurveSQL(includeArchived: boolean): string {
  if (includeArchived) return 'TRUE';
  return `(importance >= 0.4 OR last_accessed_at >= NOW() - INTERVAL '${ARCHIVE_CUTOFF_DAYS} days')`;
}
