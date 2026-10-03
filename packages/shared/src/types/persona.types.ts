// Persona types — TASK-004 (DeepSeek)
// Implement from: docs/02-reference/MASTER-FRAMEWORK.md §3 Persona System

export type BuiltInPersonaId = 'optimist' | 'critic' | 'alternate' | 'technician' | 'questionnaire' | 'doer' | 'ceo';
export type PersonaId = BuiltInPersonaId | (string & {});

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

/** Phase 6 — one monitored assumption. `confidence` mirrors Prisma `Confidence` (set by the pre-mortem CEO). */
export interface AssumptionToMonitor {
  assumption: string;
  reviewAt: Date;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'SPECULATIVE';
}

export interface SynthesisReport {
  disagreementMap: string;
  decisiveTradeoff: string;
  recommendation: string;
  nextActions: string[];
  topRisks: string[];
  assumptionsToMonitor: AssumptionToMonitor[];
  sourceMemoryIds: string[];
  /** Phase 6 debate protocol — CEO's answer to each DisagreementLedger row (empty when no ledger). */
  ledgerResolutions?: LedgerResolution[];
  /** Phase 6 — memory ids cited in round 1 that the CEO brief no longer cites. Computed server-side. */
  droppedConsiderations?: string[];
}

// ── Phase 6 debate protocol ──

export type RebuttalStance = 'defend' | 'concede';

/** Round-2 output of a dissenting persona after seeing anonymized peer views. */
export interface Rebuttal {
  personaId: PersonaId;
  stance: RebuttalStance;
  reason: string;
  revisedRecommendation?: string;
  /** 0..1 — the persona's confidence after round 2 */
  revisedConfidence: number;
}

export interface DisagreementLedgerEntry {
  claim: string;
  heldBy: PersonaId[];
  opposedBy: PersonaId[];
  citedMemoryIds: string[];
}

export type DisagreementLedger = DisagreementLedgerEntry[];

export interface LedgerResolution {
  claim: string;
  resolution: string;
}

export interface QuestionCluster {
  theme: string;
  questions: string[];
}

export interface QuestionnaireResponse {
  personaId: 'questionnaire';
  questionClusters: QuestionCluster[];
}
