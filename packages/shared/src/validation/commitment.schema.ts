// commitment Zod schemas — matches packages/shared/src/types/commitment.types.ts

import { z } from 'zod';

// ── Status Schema ──

export const CommitmentStatusSchema = z.enum(['OPEN', 'COMPLETED', 'MISSED', 'DEFERRED'])
  .describe('Lifecycle status of the commitment');

// ── Full Commitment Schema ──

export const CommitmentSchema = z.object({
  id: z.string().describe('Unique commitment identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  description: z.string().describe('What was committed to'),
  stakeholderId: z.string().nullable().describe('Person this commitment was made to'),
  deadline: z.coerce.date().nullable().describe('Target completion date'),
  status: CommitmentStatusSchema.describe('Lifecycle status'),
  sourceSessionId: z.string().nullable().describe('Boardroom session where commitment originated'),
  linkedProjectId: z.string().nullable().describe('Associated project ID'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  completedAt: z.coerce.date().nullable().describe('When the commitment was completed'),
});

export type CommitmentInput = z.infer<typeof CommitmentSchema>;

// ── Create Commitment Request Schema ──

export const CreateCommitmentRequestSchema = z.object({
  description: z.string().min(1).describe('What was committed to'),
  stakeholderId: z.string().nullable().optional().describe('Person this commitment was made to'),
  deadline: z.coerce.date().nullable().optional().describe('Target completion date'),
  status: CommitmentStatusSchema.optional().describe('Lifecycle status'),
  sourceSessionId: z.string().nullable().optional().describe('Boardroom session where commitment originated'),
  linkedProjectId: z.string().nullable().optional().describe('Associated project ID'),
  completedAt: z.coerce.date().nullable().optional().describe('When the commitment was completed'),
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
