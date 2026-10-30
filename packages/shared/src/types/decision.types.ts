// Decision types — TASK-004 (DeepSeek)
// Implement from: docs/02-reference/MASTER-FRAMEWORK.md §4 Data Model

export interface DecisionOption {
  path: string;
  pros: string[];
  cons: string[];
}

/** Mirrors Prisma `Confidence` (shared with MemoryEntry) — SPECULATIVE is a real DB value. */
export type AssumptionConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'SPECULATIVE';

export interface Assumption {
  text: string;
  confidence: AssumptionConfidence;
  reviewAt: Date | null;
  status: 'ACTIVE' | 'VALIDATED' | 'INVALIDATED';
}

/** Mirrors Prisma `enum DecisionStatus`. String-valued so `'OPEN'` comparisons keep working. */
export enum DecisionStatus {
  OPEN = 'OPEN',
  DECIDED = 'DECIDED',
  REVIEWED = 'REVIEWED',
  REVISED = 'REVISED',
}

export interface Decision {
  id: string;
  userId: string;
  title: string;
  question: string;
  options: DecisionOption[];
  chosenPath: string | null;
  rationale: string | null;
  assumptions: Assumption[];
  constraints: string[];
  status: DecisionStatus;
  reviewAt: Date | null;
  outcome: string | null;
  /** Integer rating (Prisma `Int?`). */
  outcomeRating: number | null;
  /** Legacy: FK to the meeting `sessions` table (Room → Session). BoardRoom sends null. */
  sessionId: string | null;
  /** RD-17 — the Decision Lab session (`decision_sessions`) this decision was committed from. */
  decisionSessionId: string | null;
  /** Phase 6 — forecast captured at commit time (0..1). Scored against outcomeRating at review. */
  probabilitySuccess: number | null;
  /** Phase 6 — what the user expected to happen, in their words. */
  expectedOutcome: string | null;
  /** Phase 6 — each persona's recommendation + numeric confidence at decision time. */
  personaForecasts: PersonaForecast[];
  decidedAt: Date | null;
  /** decide | premortem | … (the session mode that produced it) */
  mode: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonaForecast {
  personaId: string;
  recommendation: string;
  /** 0..1 */
  confidence: number;
}

/** Phase 6 — calibration summary from GET /decisions/calibration */
export interface CalibrationBin {
  /** inclusive lower bound of the forecast bucket, e.g. 0.6 */
  lower: number;
  upper: number;
  count: number;
  meanForecast: number;
  /** share of decisions in this bin whose outcomeRating >= successThreshold */
  observedRate: number;
}

export interface CalibrationReport {
  reviewedDecisions: number;
  /** Minimum reviewed decisions before the report is considered meaningful */
  minimumForSignal: number;
  successThreshold: number;
  user: { brier: number | null; bins: CalibrationBin[] };
  personas: Record<string, { brier: number | null; count: number; bins: CalibrationBin[] }>;
}

/**
 * RD-17 — lifecycle of a persisted Decision Lab session. Mirrors Prisma
 * `enum DecisionSessionStatus`. Archiving is a soft delete, not a status.
 */
export enum DecisionSessionStatus {
  OPEN = 'OPEN',
  DISPATCHED = 'DISPATCHED',
  SYNTHESIZED = 'SYNTHESIZED',
  DECIDED = 'DECIDED',
}

export interface DecisionSession {
  id: string;
  userId: string;
  roomId: string | null;
  question: string;
  personaResponses: Record<string, unknown>;
  /** The CEO recommendation text; the full SynthesisReport lives in `state`. */
  ceoSynthesis: string | null;
  createdAt: Date;
  // ── RD-17 — persisted Decision Lab state ──
  /** UserMode of the session (null on rows that predate RD-17). */
  mode: string | null;
  status: DecisionSessionStatus;
  /** BoardRoom's opaque session snapshot (rebuttals, ledger, synthesis, asOf, …). */
  state: Record<string, unknown> | null;
  /** The non-deleted Decision committed from this session, if any. */
  decisionId: string | null;
  updatedAt: Date;
}

/** RD-17 — one row of `GET /decision-sessions` (never carries `state`). */
export interface DecisionSessionSummary {
  id: string;
  question: string;
  mode: string | null;
  status: DecisionSessionStatus;
  personaCount: number;
  hasSynthesis: boolean;
  decisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionSessionListResponse {
  items: DecisionSessionSummary[];
  total: number;
  offset: number;
  limit: number;
}

/** RD-17 — `POST /decision-sessions` body. */
export interface CreateDecisionSessionRequest {
  question: string;
  mode?: string | null;
  status?: DecisionSessionStatus;
  personaResponses?: Record<string, unknown>;
  ceoSynthesis?: string | null;
  state?: Record<string, unknown> | null;
}

/** RD-17 — `PATCH /decision-sessions/:id` body (non-empty subset; each field replaces). */
export interface UpdateDecisionSessionRequest {
  question?: string;
  mode?: string | null;
  status?: DecisionSessionStatus;
  personaResponses?: Record<string, unknown>;
  ceoSynthesis?: string | null;
  state?: Record<string, unknown> | null;
}

/** RD-17 — `GET /decision-sessions` query. */
export interface ListDecisionSessionsQuery {
  limit?: number;
  offset?: number;
}
