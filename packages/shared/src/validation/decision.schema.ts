import type {
  PersonaForecast,
  CreateDecisionSessionRequest,
  UpdateDecisionSessionRequest,
  ListDecisionSessionsQuery,
} from '../types/decision.types';
import {
  DECISION_SESSION_QUESTION_MAX_CHARS,
  DECISION_SESSION_CEO_SYNTHESIS_MAX_CHARS,
  DECISION_SESSION_LIST_MAX_LIMIT,
} from '../constants/decision-session-config';
// decision Zod schemas — matches packages/shared/src/types/decision.types.ts

import { z } from 'zod';
import { DecisionStatus, DecisionSessionStatus } from '../types/decision.types';

// ── Sub-type Schemas ──

export const DecisionOptionSchema = z.object({
  path: z.string().describe('Name or description of this decision path'),
  pros: z.array(z.string()).describe('Arguments in favor of this path'),
  cons: z.array(z.string()).describe('Arguments against this path'),
});

export type DecisionOptionInput = z.infer<typeof DecisionOptionSchema>;

export const AssumptionConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW', 'SPECULATIVE'])
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

export const DecisionStatusSchema = z.nativeEnum(DecisionStatus)
  .describe('Lifecycle status of the decision');

// ── Full Decision Schema ──

export const PersonaForecastSchema = z.object({
  personaId: z.string().min(1),
  recommendation: z.string(),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<PersonaForecast>;

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
  outcomeRating: z.number().int().nullable().describe('Rating of the outcome'),
  sessionId: z.string().nullable().describe('Legacy meeting session (sessions table) ID'),
  decisionSessionId: z.string().nullable().default(null).describe('RD-17 — Decision Lab session this decision was committed from'),
  probabilitySuccess: z.number().min(0).max(1).nullable().default(null),
  expectedOutcome: z.string().nullable().default(null),
  personaForecasts: z.array(PersonaForecastSchema).default([]),
  decidedAt: z.coerce.date().nullable().default(null),
  mode: z.string().nullable().default(null),
  version: z.number().int().describe('Optimistic concurrency version'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type DecisionInput = z.infer<typeof DecisionSchema>;

// ── Decision Session Schema ──

export const DecisionSessionStatusSchema = z.nativeEnum(DecisionSessionStatus)
  .describe('RD-17 — lifecycle of a persisted Decision Lab session');

/** RD-17 — BoardRoom's opaque session snapshot. OmniMind stores it; BoardRoom validates on hydrate. */
export const DecisionSessionStateSchema = z.record(z.string(), z.unknown());

export const DecisionSessionSchema = z.object({
  id: z.string().describe('Unique session identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  roomId: z.string().nullable().describe('Associated room ID'),
  question: z.string().describe('The question discussed in this session'),
  personaResponses: z.record(z.string(), z.unknown()).describe('Responses from each persona'),
  ceoSynthesis: z.string().nullable().describe('CEO recommendation text'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  mode: z.string().nullable().default(null).describe('RD-17 — UserMode of the session'),
  status: DecisionSessionStatusSchema.default(DecisionSessionStatus.OPEN),
  state: DecisionSessionStateSchema.nullable().default(null).describe('RD-17 — BoardRoom session snapshot'),
  decisionId: z.string().nullable().default(null).describe('RD-17 — non-deleted Decision committed from this session'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type DecisionSessionInput = z.infer<typeof DecisionSessionSchema>;

/** RD-17 — one row of GET /decision-sessions (no `state`). */
export const DecisionSessionSummarySchema = z.object({
  id: z.string(),
  question: z.string(),
  mode: z.string().nullable(),
  status: DecisionSessionStatusSchema,
  personaCount: z.number().int().min(0),
  hasSynthesis: z.boolean(),
  decisionId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const DecisionSessionListResponseSchema = z.object({
  items: z.array(DecisionSessionSummarySchema),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
});

const decisionSessionFields = {
  question: z.string().min(1).max(DECISION_SESSION_QUESTION_MAX_CHARS),
  mode: z.string().min(1).max(40).nullable().optional(),
  status: DecisionSessionStatusSchema.optional(),
  personaResponses: z.record(z.string(), z.unknown()).optional(),
  ceoSynthesis: z.string().max(DECISION_SESSION_CEO_SYNTHESIS_MAX_CHARS).nullable().optional(),
  state: DecisionSessionStateSchema.nullable().optional(),
};

/** RD-17 — POST /decision-sessions. Unknown keys are refused (422). */
export const CreateDecisionSessionRequestSchema = z.object(decisionSessionFields).strict();

/** RD-17 — PATCH /decision-sessions/:id. Non-empty subset; each field replaces. */
export const UpdateDecisionSessionRequestSchema = z.object({
  ...decisionSessionFields,
  question: decisionSessionFields.question.optional(),
}).strict().refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' });

/** RD-17 — GET /decision-sessions query (`limit` 1..100, `offset` ≥ 0). */
export const ListDecisionSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(DECISION_SESSION_LIST_MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// CLAUDE rule 10 — compile-time parity between the RD-17 schemas and their interfaces.
type DecisionSessionMutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type DecisionSessionAssertParity<T extends true> = T;
export type CreateDecisionSessionRequestParity = DecisionSessionAssertParity<
  DecisionSessionMutuallyAssignable<z.infer<typeof CreateDecisionSessionRequestSchema>, CreateDecisionSessionRequest>>;
export type UpdateDecisionSessionRequestParity = DecisionSessionAssertParity<
  DecisionSessionMutuallyAssignable<z.infer<typeof UpdateDecisionSessionRequestSchema>, UpdateDecisionSessionRequest>>;
export type ListDecisionSessionsQueryParity = DecisionSessionAssertParity<
  DecisionSessionMutuallyAssignable<z.infer<typeof ListDecisionSessionsQuerySchema>, ListDecisionSessionsQuery>>;

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
  outcomeRating: z.number().int().nullable().optional().describe('Rating of the outcome'),
  sessionId: z.string().nullable().optional().describe('Legacy meeting session (sessions table) ID'),
  decisionSessionId: z.string().min(1).max(128).nullable().optional()
    .describe('RD-17 — Decision Lab session this decision is committed from (same user, not archived)'),
  probabilitySuccess: z.number().min(0).max(1).nullable().optional(),
  expectedOutcome: z.string().max(2000).nullable().optional(),
  personaForecasts: z.array(PersonaForecastSchema).optional(),
  decidedAt: z.coerce.date().nullable().optional(),
  mode: z.string().max(40).nullable().optional(),
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
  outcomeRating: z.number().int().nullable().optional().describe('Rating of the outcome'),
  sessionId: z.string().nullable().optional().describe('Associated boardroom session ID'),
  probabilitySuccess: z.number().min(0).max(1).nullable().optional(),
  expectedOutcome: z.string().max(2000).nullable().optional(),
  personaForecasts: z.array(PersonaForecastSchema).optional(),
  decidedAt: z.coerce.date().nullable().optional(),
  mode: z.string().max(40).nullable().optional(),
});

export type UpdateDecisionRequestInput = z.infer<typeof UpdateDecisionRequestSchema>;
