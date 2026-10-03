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
  sessionId: string | null;
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

export interface DecisionSession {
  id: string;
  userId: string;
  roomId: string | null;
  question: string;
  personaResponses: Record<string, unknown>;
  ceoSynthesis: string | null;
  createdAt: Date;
}
