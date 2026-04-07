// decision Zod schemas — matches packages/shared/src/types/decision.types.ts

import { z } from 'zod';

// ── Sub-type Schemas ──

export const DecisionOptionSchema = z.object({
  path: z.string().describe('Name or description of this decision path'),
  pros: z.array(z.string()).describe('Arguments in favor of this path'),
  cons: z.array(z.string()).describe('Arguments against this path'),
});

export type DecisionOptionInput = z.infer<typeof DecisionOptionSchema>;

export const AssumptionConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW'])
  .describe('Confidence level for the assumption');

export const AssumptionStatusSchema = z.enum(['ACTIVE', 'VALIDATED', 'INVALIDATED'])
  .describe('Current status of the assumption');

export const AssumptionSchema = z.object({
  text: z.string().describe('Text of the assumption'),
  confidence: AssumptionConfidenceSchema.describe('Confidence in this assumption'),
  reviewAt: z.coerce.date().nullable().describe('When to review this assumption'),
  status: AssumptionStatusSchema.describe('Current status of the assumption'),
});

export type AssumptionInput = z.infer<typeof AssumptionSchema>;

export const DecisionStatusSchema = z.enum(['OPEN', 'DECIDED', 'REVIEWED', 'REVISED'])
  .describe('Lifecycle status of the decision');

// ── Full Decision Schema ──

export const DecisionSchema = z.object({
  id: z.string().describe('Unique decision identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  title: z.string().describe('Short title for the decision'),
  question: z.string().describe('The core question being decided'),
  options: z.array(DecisionOptionSchema).describe('Available decision paths'),
  chosenPath: z.string().nullable().describe('The path that was chosen'),
  rationale: z.string().nullable().describe('Why this path was chosen'),
  assumptions: z.array(AssumptionSchema).describe('Key assumptions underlying the decision'),
  constraints: z.array(z.string()).describe('Constraints affecting the decision'),
  status: DecisionStatusSchema.describe('Lifecycle status'),
  reviewAt: z.coerce.date().nullable().describe('When to review this decision'),
  outcome: z.string().nullable().describe('Observed outcome after decision'),
  outcomeRating: z.number().nullable().describe('Rating of the outcome'),
  sessionId: z.string().nullable().describe('Associated boardroom session ID'),
  version: z.number().int().describe('Optimistic concurrency version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type DecisionInput = z.infer<typeof DecisionSchema>;

// ── Decision Session Schema ──

export const DecisionSessionSchema = z.object({
  id: z.string().describe('Unique session identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  roomId: z.string().nullable().describe('Associated room ID'),
  question: z.string().describe('The question discussed in this session'),
  personaResponses: z.record(z.string(), z.unknown()).describe('Responses from each persona'),
  ceoSynthesis: z.string().nullable().describe('CEO persona synthesis'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
});

export type DecisionSessionInput = z.infer<typeof DecisionSessionSchema>;

// ── Create Decision Request Schema ──

export const CreateDecisionRequestSchema = z.object({
  title: z.string().min(1).describe('Short title for the decision'),
  question: z.string().min(1).describe('The core question being decided'),
  options: z.array(DecisionOptionSchema).optional().describe('Available decision paths'),
  chosenPath: z.string().nullable().optional().describe('The path that was chosen'),
  rationale: z.string().nullable().optional().describe('Why this path was chosen'),
  assumptions: z.array(AssumptionSchema).optional().describe('Key assumptions'),
  constraints: z.array(z.string()).optional().describe('Constraints affecting the decision'),
  status: DecisionStatusSchema.optional().describe('Lifecycle status'),
  reviewAt: z.coerce.date().nullable().optional().describe('When to review this decision'),
  outcome: z.string().nullable().optional().describe('Observed outcome'),
  outcomeRating: z.number().nullable().optional().describe('Rating of the outcome'),
  sessionId: z.string().nullable().optional().describe('Associated boardroom session ID'),
});

export type CreateDecisionRequestInput = z.infer<typeof CreateDecisionRequestSchema>;

// ── Update Decision Request Schema ──

export const UpdateDecisionRequestSchema = z.object({
  title: z.string().min(1).optional().describe('Short title for the decision'),
  question: z.string().min(1).optional().describe('The core question being decided'),
  options: z.array(DecisionOptionSchema).optional().describe('Available decision paths'),
  chosenPath: z.string().nullable().optional().describe('The path that was chosen'),
  rationale: z.string().nullable().optional().describe('Why this path was chosen'),
  assumptions: z.array(AssumptionSchema).optional().describe('Key assumptions'),
  constraints: z.array(z.string()).optional().describe('Constraints affecting the decision'),
  status: DecisionStatusSchema.optional().describe('Lifecycle status'),
  reviewAt: z.coerce.date().nullable().optional().describe('When to review this decision'),
  outcome: z.string().nullable().optional().describe('Observed outcome'),
  outcomeRating: z.number().nullable().optional().describe('Rating of the outcome'),
  sessionId: z.string().nullable().optional().describe('Associated boardroom session ID'),
});

export type UpdateDecisionRequestInput = z.infer<typeof UpdateDecisionRequestSchema>;
