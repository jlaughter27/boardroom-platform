// Cortex types — Phase 3 (Claude)
// Thinking patterns, contradiction alerts, weekly memos, outcome review nudges

export interface ThinkingPattern {
  id: string;
  userId: string;
  pattern: string;
  patternType: PatternType;
  evidenceCount: number;
  confidence: number;
  firstDetected: Date;
  lastDetected: Date;
  trend: 'improving' | 'stable' | 'worsening' | null;
  createdAt: Date;
  updatedAt: Date;
}

export enum PatternType {
  BIAS = 'BIAS',
  STRENGTH = 'STRENGTH',
  BEHAVIORAL_CYCLE = 'BEHAVIORAL_CYCLE',
  DECISION_STYLE = 'DECISION_STYLE',
}

export interface ContradictionAlert {
  id: string;
  userId: string;
  description: string;
  entityA: { type: string; id: string; title: string };
  entityB: { type: string; id: string; title: string };
  severity: 'low' | 'medium' | 'high';
  status: ContradictionStatus;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
}

export enum ContradictionStatus {
  ACTIVE = 'ACTIVE',
  ACCEPTED_TENSION = 'ACCEPTED_TENSION',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

export interface WeeklyMemo {
  id: string;
  userId: string;
  weekStart: Date;
  weekEnd: Date;
  decisionsMade: number;
  decisionsByCategory: Record<string, number>;
  patternsNoticed: string[];
  activeContradictions: string[];
  upcomingPressurePoints: string[];
  thinkingQualityScore: number;
  scoreChange: number;
  recommendedFocus: string[];
  fullMemoText: string;
  generatedAt: Date;
}

export interface OutcomeReviewNudge {
  id: string;
  userId: string;
  decisionId: string;
  decisionTitle: string;
  nudgeType: '30_day' | '90_day';
  scheduledFor: Date;
  sentAt: Date | null;
  completedAt: Date | null;
  status: 'pending' | 'sent' | 'completed' | 'skipped';
}
