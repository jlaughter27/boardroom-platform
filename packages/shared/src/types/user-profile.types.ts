// UserProfile types — TASK-004 (DeepSeek)
// Implement from: docs/MASTER-FRAMEWORK.md §4 Data Model

export interface RiskProfile {
  financial: number;
  technical: number;
  people: number;
  strategic: number;
}

export interface CognitivePattern {
  pattern: string;
  evidenceCount: number;
  confidence: number;
}

export interface UserProfile {
  id: string;
  userId: string;
  role: string | null;
  industry: string | null;
  decisionFrequency: string | null;
  riskProfile: RiskProfile;
  valueHierarchy: string[];
  cognitivePatterns: CognitivePattern[];
  decisionHistorySummary: string | null;
  onboardingComplete: boolean;
  createdAt: Date;
  updatedAt: Date;
}
