// Decision types — TASK-004 (DeepSeek)
// Implement from: docs/MASTER-FRAMEWORK.md §4 Data Model

export interface DecisionOption {
  path: string;
  pros: string[];
  cons: string[];
}

export interface Assumption {
  text: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reviewAt: Date | null;
  status: 'ACTIVE' | 'VALIDATED' | 'INVALIDATED';
}

export type DecisionStatus = 'OPEN' | 'DECIDED' | 'REVIEWED' | 'REVISED';

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
