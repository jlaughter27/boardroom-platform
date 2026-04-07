// persona Zod schemas — matches packages/shared/src/types/persona.types.ts

import { z } from 'zod';

// ── Persona ID Schema ──

export const PersonaIdSchema = z.enum([
  'optimist', 'critic', 'alternate', 'technician', 'questionnaire', 'doer', 'ceo',
]).describe('Identifier for a boardroom persona');

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
});

export const SynthesisReportSchema = z.object({
  disagreementMap: z.string().describe('Summary of where personas disagree'),
  decisiveTradeoff: z.string().describe('The key tradeoff that must be made'),
  recommendation: z.string().describe('CEO synthesized recommendation'),
  nextActions: z.array(z.string()).describe('Recommended next actions'),
  topRisks: z.array(z.string()).describe('Top risks identified'),
  assumptionsToMonitor: z.array(AssumptionToMonitorSchema).describe('Assumptions requiring ongoing monitoring'),
  sourceMemoryIds: z.array(z.string()).describe('Memory IDs that informed this synthesis'),
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
