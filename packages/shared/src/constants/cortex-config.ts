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
  // RD-11 — load formula v1 (deterministic load check in the core-context block)
  formulaVersion: 1,
  /** false until M1-B1 re-points MCP task/commitment tools at entity rows (+ M1-B3 backfill). M1-B1 flips it. */
  coverageComplete: false,
  maxActiveProjectsPerDomain: 3,
  capacityPoints: 40,
  stretchedAtPoints: 32,
  overAtPoints: 48,
  weights: { project: 4, commitment: 2, overdueCommitmentExtra: 2, task: 1, overdueTaskExtra: 1, awaitingReview: 1 },
  closedProjectStatuses: ['paused', 'archived', 'completed', 'done', 'cancelled', 'canceled'],
  closedTaskStatuses: ['done', 'completed', 'cancelled', 'canceled', 'archived'],
  maxStopCandidates: 5,
  maxDomainRows: 8,
  candidateTitleMaxChars: 80,
} as const;
