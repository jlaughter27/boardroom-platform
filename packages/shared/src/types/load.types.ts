// Load types — RD-11 (load check / overextension governor)
// Deterministic snapshot of the founder's open load, computed by OmniMind
// (`services/load.service.ts`) with SQL and no LLM. The snapshot never crosses
// a service boundary in v1 — only its rendered `## Current load` text does —
// so there is no Zod schema yet (the deferred `GET /context/load` adds one).

/** `unknown` replaces `ok` while coverage is incomplete (MCP-logged tasks/commitments are not entity rows). */
export type LoadLevel = 'ok' | 'stretched' | 'over' | 'unknown';

export type LoadFlagType = 'overloaded' | 'too_many_overdue' | 'deadline_cluster' | 'domain_sprawl';

export interface LoadDomainRow {
  domain: string;
  activeProjects: number;
  openCommitments: number;
  overdueCommitments: number;
  openTasks: number;
  overdueTasks: number;
  points: number;
}

export interface LoadFlag {
  type: LoadFlagType;
  severity: 'warning' | 'critical';
  count: number;
  /** Set on `domain_sprawl` only. */
  domain?: string;
}

/** An active, domain-assigned, non-ministry project the CEO could name as a pause candidate. */
export interface LoadStopCandidate {
  projectId: string;
  title: string;
  domain: string;
  openTasks: number;
  openCommitments: number;
}

export interface LoadTotals {
  activeProjects: number;
  openCommitments: number;
  overdueCommitments: number;
  openTasks: number;
  overdueTasks: number;
  dueThisWeek: number;
  awaitingReview: number;
}

/** No `computedAt`: the snapshot is deterministic for a given (input, now). */
export interface LoadSnapshot {
  formulaVersion: 1;
  level: LoadLevel;
  points: number;
  capacity: number;
  coverageComplete: boolean;
  totals: LoadTotals;
  domains: LoadDomainRow[];
  flags: LoadFlag[];
  stopCandidates: LoadStopCandidate[];
  omittedCandidates: number;
}
