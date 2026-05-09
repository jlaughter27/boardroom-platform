// Commitment types — TASK-004 (DeepSeek)
// Implement from: docs/02-reference/MASTER-FRAMEWORK.md §4 Data Model

export type CommitmentStatus = 'OPEN' | 'COMPLETED' | 'MISSED' | 'DEFERRED';

export interface Commitment {
  id: string;
  userId: string;
  description: string;
  stakeholderId: string | null;
  deadline: Date | null;
  status: CommitmentStatus;
  sourceSessionId: string | null;
  linkedProjectId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
