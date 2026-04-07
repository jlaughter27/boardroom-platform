// Integration Zod schemas — matches packages/shared/src/types/integration.types.ts

import { z } from 'zod';

// ── Integration Type ──

export const IntegrationTypeSchema = z.enum(['gmail', 'google_calendar']);

// ── Integration ──

export const IntegrationSchema = z.object({
  id: z.string().describe('Unique integration identifier'),
  userId: z.string().describe('Owner user identifier'),
  type: IntegrationTypeSchema.describe('Integration type'),
  status: z.enum(['connected', 'disconnected', 'error']).describe('Connection status'),
  lastSyncAt: z.coerce.date().nullable().describe('Last successful sync timestamp'),
  config: z.record(z.unknown()).describe('Integration-specific configuration'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
});

export type IntegrationInput = z.infer<typeof IntegrationSchema>;

// ── Email Summary ──

export const EmailSummarySchema = z.object({
  emailId: z.string().describe('Gmail message identifier'),
  subject: z.string().describe('Email subject line'),
  from: z.string().describe('Sender address'),
  date: z.coerce.date().describe('Email date'),
  snippet: z.string().describe('Email snippet/preview'),
});

export type EmailSummaryInput = z.infer<typeof EmailSummarySchema>;

// ── Email Memory Proposal ──

export const EmailMemoryProposalSchema = z.object({
  title: z.string().describe('Brief descriptive title'),
  content: z.string().describe('The extracted information in context'),
  domain: z.string().describe('Memory domain (business, personal, ministry, ai-systems)'),
  tags: z.array(z.string()).describe('Relevant tags'),
  memoryClass: z.string().describe('SEMANTIC, EPISODIC, or DECISION'),
  importance: z.number().min(0).max(1).describe('Importance score 0.0-1.0'),
  linkedPeople: z.array(z.string()).describe('Names of people referenced'),
});

export type EmailMemoryProposalInput = z.infer<typeof EmailMemoryProposalSchema>;

// ── Email Extraction ──

export const EmailExtractionSchema = z.object({
  emailId: z.string().describe('Gmail message identifier'),
  subject: z.string().describe('Email subject line'),
  from: z.string().describe('Sender address'),
  date: z.coerce.date().describe('Email date'),
  proposedMemories: z.array(EmailMemoryProposalSchema).describe('Proposed memory extractions'),
});

export type EmailExtractionInput = z.infer<typeof EmailExtractionSchema>;
