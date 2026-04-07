// Persona types — TASK-004 (DeepSeek)
// Implement from: docs/MASTER-FRAMEWORK.md §3 Persona System

export type PersonaId = 'optimist' | 'critic' | 'alternate' | 'technician' | 'questionnaire' | 'doer' | 'ceo';

export type ModelTier = 'sonnet' | 'haiku';

export interface PersonaConfig {
  id: PersonaId;
  name: string;
  model: ModelTier;
  maxOutputTokens: number;
  systemPromptPath: string;
}

export interface PersonaResponse {
  personaId: PersonaId;
  situationReading: string;
  keyAssumptions: string[];
  analysis: string;
  recommendation: string;
  uncertainties: string[];
  sourceMemoryIds: string[];
  confidence: number;
  dissentFlag: boolean;
}

export interface SynthesisReport {
  disagreementMap: string;
  decisiveTradeoff: string;
  recommendation: string;
  nextActions: string[];
  topRisks: string[];
  assumptionsToMonitor: { assumption: string; reviewAt: Date }[];
  sourceMemoryIds: string[];
}

export interface QuestionCluster {
  theme: string;
  questions: string[];
}

export interface QuestionnaireResponse {
  personaId: 'questionnaire';
  questionClusters: QuestionCluster[];
}
