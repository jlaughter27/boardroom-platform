// commitment Zod schemas — matches packages/shared/src/types/commitment.types.ts

import { z } from 'zod';
import { CommitmentOwedBy, CommitmentStatus } from '../types/commitment.types';

// ── Status Schema ──

export const CommitmentStatusSchema = z.nativeEnum(CommitmentStatus)
  .describe('Lifecycle status of the commitment');

// ── Direction Schema (RD-12) ──

export const CommitmentOwedBySchema = z.nativeEnum(CommitmentOwedBy)
  .describe('Who owes the item: USER (the user promised) or STAKEHOLDER (the counterparty owes the user)');

const COUNTERPARTY_DESCRIBE =
  'Counterparty person: who the user promised (owedBy=USER) or who owes the user (owedBy=STAKEHOLDER)';

// ── Full Commitment Schema ──

export const CommitmentSchema = z.object({
  id: z.string().describe('Unique commitment identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  description: z.string().describe('What was committed to'),
  stakeholderId: z.string().nullable().describe(COUNTERPARTY_DESCRIBE),
  deadline: z.coerce.date().nullable().describe('Target completion date'),
  status: CommitmentStatusSchema.describe('Lifecycle status'),
  sourceSessionId: z.string().nullable().describe('Boardroom session where commitment originated'),
  linkedProjectId: z.string().nullable().describe('Associated project ID'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  completedAt: z.coerce.date().nullable().describe('When the commitment was completed'),
  owedBy: CommitmentOwedBySchema.optional(),
});

export type CommitmentInput = z.infer<typeof CommitmentSchema>;

// ── Links on create (RD-12) — matches CommitmentLinksInput ──

export const CommitmentLinksInputSchema = z.object({
  decisionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
}).strict();

// ── Create Commitment Request Schema ──

export const CreateCommitmentRequestSchema = z.object({
  description: z.string().min(1).describe('What was committed to'),
  stakeholderId: z.string().nullable().optional().describe(COUNTERPARTY_DESCRIBE),
  deadline: z.coerce.date().nullable().optional().describe('Target completion date'),
  status: CommitmentStatusSchema.optional().describe('Lifecycle status'),
  sourceSessionId: z.string().nullable().optional().describe('Boardroom session where commitment originated'),
  linkedProjectId: z.string().nullable().optional().describe('Associated project ID'),
  completedAt: z.coerce.date().nullable().optional().describe('When the commitment was completed'),
  owedBy: CommitmentOwedBySchema.optional(),
  links: CommitmentLinksInputSchema.optional().describe('CommitmentLink rows to create with the commitment'),
});

export type CreateCommitmentRequestInput = z.infer<typeof CreateCommitmentRequestSchema>;

// ── Update Commitment Request Schema ──

export const UpdateCommitmentRequestSchema = z.object({
  description: z.string().min(1).optional().describe('What was committed to'),
  stakeholderId: z.string().nullable().optional().describe('Person this commitment was made to'),
  deadline: z.coerce.date().nullable().optional().describe('Target completion date'),
  status: CommitmentStatusSchema.optional().describe('Lifecycle status'),
  sourceSessionId: z.string().nullable().optional().describe('Boardroom session where commitment originated'),
  linkedProjectId: z.string().nullable().optional().describe('Associated project ID'),
  completedAt: z.coerce.date().nullable().optional().describe('When the commitment was completed'),
});

export type UpdateCommitmentRequestInput = z.infer<typeof UpdateCommitmentRequestSchema>;

// ── Nudge row (GET /commitments/nudges, RD-12) ──

export const CommitmentNudgeItemSchema = CommitmentSchema.extend({
  stakeholderName: z.string().nullable().describe("Counterparty person's name, null when none"),
});

export type CommitmentNudgeItemInput = z.infer<typeof CommitmentNudgeItemSchema>;
