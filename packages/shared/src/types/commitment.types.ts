// Commitment types — TASK-004 (DeepSeek)
// Implement from: docs/02-reference/MASTER-FRAMEWORK.md §4 Data Model

/** Mirrors Prisma `enum CommitmentStatus`. String-valued so `'OPEN'` comparisons keep working. */
export enum CommitmentStatus {
  OPEN = 'OPEN',
  COMPLETED = 'COMPLETED',
  MISSED = 'MISSED',
  DEFERRED = 'DEFERRED',
}

/**
 * Mirrors Prisma `enum CommitmentOwedBy` (RD-12). Direction of the promise:
 * USER = the user owes the counterparty; STAKEHOLDER = the counterparty owes
 * the user (a delegation).
 */
export enum CommitmentOwedBy {
  USER = 'USER',
  STAKEHOLDER = 'STAKEHOLDER',
}

export interface Commitment {
  id: string;
  userId: string;
  description: string;
  /** Counterparty person: who the user promised (owedBy=USER) or who owes the user (owedBy=STAKEHOLDER). */
  stakeholderId: string | null;
  deadline: Date | null;
  status: CommitmentStatus;
  sourceSessionId: string | null;
  linkedProjectId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  /** RD-12. Missing means USER (older fixtures); the DB always returns it. */
  owedBy?: CommitmentOwedBy;
}

/** RD-12 — optional CommitmentLink rows written with POST /commitments. */
export interface CommitmentLinksInput {
  decisionId?: string;
  taskId?: string;
}

/** RD-12 — a GET /commitments/nudges row: the commitment plus its counterparty's name. */
export interface CommitmentNudgeItem extends Commitment {
  stakeholderName: string | null;
}
