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
  version: number;
  createdAt: Date;
  updatedAt: Date;
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
