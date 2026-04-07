// Cortex configuration constants — Phase 3 (Claude)
// Schedules, thresholds, and limits for the Cortex intelligence layer

export const CORTEX_CONFIG = {
  memoSchedule: '0 18 * * 0',
  patternScanSchedule: '0 3 * * 1',
  contradictionScanSchedule: '0 4 * * 1',
  minSessionsForPatterns: 10,
  minSessionsForMemo: 5,
  patternConfidenceThreshold: 0.6,
  contradictionSeverityThreshold: 0.5,
  memoMaxDecisionsToAnalyze: 50,
  outcomeReviewDays: [30, 90],
} as const;

export const COGNITIVE_LOAD = {
  maxActiveTasksBeforeWarning: 15,
  maxOverdueBeforeAlert: 3,
  maxDeadlinesThisWeekBeforeWarning: 5,
} as const;
