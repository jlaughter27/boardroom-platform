// Temporal utilities for memory validity and retention
// Used by OmniMind retrieval and curator for date-based filtering

import { RETENTION_TIERS } from '../constants/memory-config';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Check if a date is stale (older than a threshold).
 * @param date - The date to check
 * @param thresholdDays - Number of days before a date is considered stale
 * @returns true if the date is more than thresholdDays ago
 */
export const isStale = (date: Date, thresholdDays: number): boolean => {
  const diffMs = Date.now() - date.getTime();
  const diffDays = diffMs / MS_PER_DAY;
  return diffDays > thresholdDays;
};

/**
 * Determine the retention tier for a memory based on its creation date.
 * Uses RETENTION_TIERS from memory-config (hotDays=90, warmDays=365).
 * @param createdAt - The creation date of the memory
 * @returns 'hot' if within hotDays, 'warm' if within warmDays, 'cold' otherwise
 */
export const getRetentionTier = (createdAt: Date): 'hot' | 'warm' | 'cold' => {
  const diffMs = Date.now() - createdAt.getTime();
  const diffDays = diffMs / MS_PER_DAY;

  if (diffDays <= RETENTION_TIERS.hotDays) return 'hot';
  if (diffDays <= RETENTION_TIERS.warmDays) return 'warm';
  return 'cold';
};

/**
 * Check if a deadline is overdue (in the past).
 * @param deadline - The deadline date to check
 * @returns true if the deadline is in the past
 */
export const isOverdue = (deadline: Date): boolean => {
  return deadline.getTime() < Date.now();
};

/**
 * Calculate the number of days until a future date.
 * Returns negative values for dates in the past.
 * @param date - The target date
 * @returns Number of days until the date (negative if past)
 */
export const daysUntil = (date: Date): number => {
  const diffMs = date.getTime() - Date.now();
  return Math.floor(diffMs / MS_PER_DAY);
};

/**
 * Calculate the number of days since a past date.
 * Returns positive values for dates in the past.
 * @param date - The reference date
 * @returns Number of days since the date (positive if past)
 */
export const daysSince = (date: Date): number => {
  const diffMs = Date.now() - date.getTime();
  return Math.floor(diffMs / MS_PER_DAY);
};
