// persona Zod schemas — matches packages/shared/src/types/persona.types.ts

import { z } from 'zod';
import { AssumptionConfidenceSchema } from './decision.schema';

// ── Persona ID Schema ──

export const BuiltInPersonaIdSchema = z.enum([
  'optimist', 'critic', 'alternate', 'technician', 'questionnaire', 'doer', 'ceo',
]).describe('Identifier for a built-in boardroom persona');

export const PersonaIdSchema = z.string().describe('Identifier for a boardroom persona (built-in or custom)');

// ── Persona Response Schema ──

export const PersonaResponseSchema = z.object({
  personaId: PersonaIdSchema.describe('Which persona generated this response'),
  situationReading: z.string().describe('How this persona reads the current situation'),
  keyAssumptions: z.array(z.string()).describe('Key assumptions this persona identifies'),
  analysis: z.string().describe('Detailed analysis from this persona'),
  recommendation: z.string().describe('This persona\'s recommended course of action'),
  uncertainties: z.array(z.string()).describe('Areas of uncertainty identified'),
  sourceMemoryIds: z.array(z.string()).describe('Memory IDs that informed this response'),
  confidence: z.number().min(0).max(1).describe('Confidence in the analysis 0-1'),
  dissentFlag: z.boolean().describe('Whether this persona disagrees with the majority'),
});

export type PersonaResponseInput = z.infer<typeof PersonaResponseSchema>;

// ── Synthesis Report Schema ──

export const AssumptionToMonitorSchema = z.object({
  assumption: z.string().describe('The assumption to monitor'),
  reviewAt: z.coerce.date().describe('When to review this assumption'),
  confidence: AssumptionConfidenceSchema.optional().describe('Phase 6 — confidence that the assumption holds (pre-mortem CEO sets this)'),
});

// ── Phase 6 debate protocol ──

export const RebuttalStanceSchema = z.enum(['defend', 'concede']);

/** LLM output of a round-2 rebuttal call (personaId is attached server-side). */
export const RebuttalSchema = z.object({
  stance: RebuttalStanceSchema.describe('defend the round-1 position or concede to the majority'),
  reason: z.string().min(1).describe('One paragraph: why defend / why concede'),
  revisedRecommendation: z.string().optional().describe('Required in spirit when conceding; optional when defending'),
  revisedConfidence: z.number().min(0).max(1).describe('Confidence after seeing the other advisors'),
});

export type RebuttalInput = z.infer<typeof RebuttalSchema>;

export const DisagreementLedgerEntrySchema = z.object({
  claim: z.string(),
  heldBy: z.array(PersonaIdSchema),
  opposedBy: z.array(PersonaIdSchema),
  citedMemoryIds: z.array(z.string()),
});

export const DisagreementLedgerSchema = z.array(DisagreementLedgerEntrySchema);

export const LedgerResolutionSchema = z.object({
  claim: z.string().describe('The ledger claim being resolved (verbatim or close paraphrase)'),
  resolution: z.string().describe('How the CEO resolves it and why'),
});

export const SynthesisReportSchema = z.object({
  disagreementMap: z.string().describe('Summary of where personas disagree'),
  decisiveTradeoff: z.string().describe('The key tradeoff that must be made'),
  recommendation: z.string().describe('CEO synthesized recommendation'),
  nextActions: z.array(z.string()).describe('Recommended next actions'),
  topRisks: z.array(z.string()).describe('Top risks identified'),
  assumptionsToMonitor: z.array(AssumptionToMonitorSchema).describe('Assumptions requiring ongoing monitoring'),
  sourceMemoryIds: z.array(z.string()).describe('Memory IDs that informed this synthesis'),
  ledgerResolutions: z.array(LedgerResolutionSchema).optional().describe('Phase 6 — one resolution per DisagreementLedger row'),
  droppedConsiderations: z.array(z.string()).optional().describe('Phase 6 — round-1 memory ids the CEO no longer cites (server-computed)'),
});

export type SynthesisReportInput = z.infer<typeof SynthesisReportSchema>;

// ── Question Cluster Schema ──

export const QuestionClusterSchema = z.object({
  theme: z.string().describe('Theme grouping these questions'),
  questions: z.array(z.string()).describe('Questions within this theme'),
});

export type QuestionClusterInput = z.infer<typeof QuestionClusterSchema>;

// ── Questionnaire Response Schema ──

export const QuestionnaireResponseSchema = z.object({
  personaId: z.literal('questionnaire').describe('Always the questionnaire persona'),
  questionClusters: z.array(QuestionClusterSchema).describe('Grouped question clusters'),
});

export type QuestionnaireResponseInput = z.infer<typeof QuestionnaireResponseSchema>;
