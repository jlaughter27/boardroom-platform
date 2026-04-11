// ContextCapsule types — TASK-004
// Pre-generated summaries for entities (project|person|goal)

export interface ContextCapsule {
  id: string;
  userId: string;
  entityType: 'project' | 'person' | 'goal' | 'task' | 'decision';
  entityId: string;
  summary: string;
  openRisks: string[];
  unresolvedQuestions: string[];
  activeStakeholders: string[];
  recentChanges: string[];
  generatedAt: Date;
  staleAfter: Date;
}

export interface CreateContextCapsuleRequest {
  entityType: ContextCapsule['entityType'];
  entityId: string;
  summary: string;
  openRisks?: string[];
  unresolvedQuestions?: string[];
  activeStakeholders?: string[];
  recentChanges?: string[];
  staleAfter: Date;
}

export interface UpdateContextCapsuleRequest {
  summary?: string;
  openRisks?: string[];
  unresolvedQuestions?: string[];
  activeStakeholders?: string[];
  recentChanges?: string[];
  staleAfter?: Date;
}