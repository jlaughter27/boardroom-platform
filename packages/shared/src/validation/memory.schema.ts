// memory Zod schemas — matches packages/shared/src/types/memory.types.ts

import { z } from 'zod';
import { MemoryClass, MemoryStatus, Confidence, SourceType } from '../types/memory.types';

// ── Enum Schemas ──

export const MemoryClassSchema = z.nativeEnum(MemoryClass)
  .describe('Classification tier of the memory');

export const MemoryStatusSchema = z.nativeEnum(MemoryStatus)
  .describe('Lifecycle status of the memory');

export const ConfidenceSchema = z.nativeEnum(Confidence)
  .describe('Confidence level of the memory');

export const SourceTypeSchema = z.nativeEnum(SourceType)
  .describe('How this memory was created');

// ── Full Memory Schema ──

export const MemorySchema = z.object({
  id: z.string().describe('Unique memory identifier (cuid)'),
  userId: z.string().describe('Owner user identifier'),
  title: z.string().describe('Short title summarizing the memory'),
  content: z.string().describe('Full text content of the memory'),
  domain: z.string().describe('Knowledge domain this memory belongs to'),
  sector: z.string().describe('Sector within the domain'),
  tags: z.array(z.string()).describe('Searchable tags'),
  memoryClass: MemoryClassSchema.describe('Classification tier'),
  importance: z.number().min(0).max(1).describe('Importance score 0-1'),
  confidence: ConfidenceSchema.describe('Confidence level'),
  status: MemoryStatusSchema.describe('Lifecycle status'),
  validAt: z.coerce.date().describe('When this memory became valid'),
  invalidAt: z.coerce.date().nullable().describe('When this memory was invalidated'),
  supersededBy: z.string().nullable().describe('ID of the memory that supersedes this one'),
  sourceType: SourceTypeSchema.describe('How this memory was created'),
  sourceRef: z.string().nullable().describe('Reference to the original source'),
  sourceWeight: z.number().describe('Weight assigned to the source'),
  version: z.number().int().describe('Optimistic concurrency version'),
  metadata: z.record(z.string(), z.unknown()).describe('Arbitrary metadata'),
  createdAt: z.coerce.date().describe('Creation timestamp'),
  updatedAt: z.coerce.date().describe('Last update timestamp'),
  lastAccessedAt: z.coerce.date().nullable().describe('Last access timestamp'),
});

export type MemoryInput = z.infer<typeof MemorySchema>;

// ── Create Memory Request Schema ──

/**
 * Normalize domain values so refusal gates (e.g. ministry) cannot be bypassed
 * by case variation or padding. WS-6 F-101.
 *
 * Trim whitespace, lowercase, reject empty. The downstream refusal check
 * (`memory.service.ts`) compares against `'ministry'` (lowercase) — anything
 * that should be refused MUST normalize to that form here.
 */
const DomainSchema = z
  .string()
  .min(1)
  .transform(s => s.trim().toLowerCase())
  .refine(s => s.length > 0, { message: 'domain cannot be empty after trim' });

export const CreateMemoryRequestSchema = z.object({
  title: z.string().min(1).describe('Short title summarizing the memory'),
  content: z.string().min(1).describe('Full text content of the memory'),
  domain: DomainSchema.describe('Knowledge domain this memory belongs to'),
  sourceType: SourceTypeSchema.describe('How this memory was created'),
  sector: z.string().optional().describe('Sector within the domain'),
  tags: z.array(z.string()).optional().describe('Searchable tags'),
  memoryClass: MemoryClassSchema.optional().describe('Classification tier'),
  importance: z.number().min(0).max(1).optional().describe('Importance score 0-1'),
  confidence: ConfidenceSchema.optional().describe('Confidence level'),
  sourceRef: z.string().nullable().optional().describe('Reference to the original source'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata'),
});

export type CreateMemoryRequestInput = z.infer<typeof CreateMemoryRequestSchema>;

// ── Update Memory Request Schema ──

export const UpdateMemoryRequestSchema = z.object({
  title: z.string().min(1).optional().describe('Short title summarizing the memory'),
  content: z.string().min(1).optional().describe('Full text content of the memory'),
  domain: DomainSchema.optional().describe('Knowledge domain this memory belongs to'),
  sourceType: SourceTypeSchema.optional().describe('How this memory was created'),
  sector: z.string().optional().describe('Sector within the domain'),
  tags: z.array(z.string()).optional().describe('Searchable tags'),
  memoryClass: MemoryClassSchema.optional().describe('Classification tier'),
  importance: z.number().min(0).max(1).optional().describe('Importance score 0-1'),
  confidence: ConfidenceSchema.optional().describe('Confidence level'),
  sourceRef: z.string().nullable().optional().describe('Reference to the original source'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata'),
});

export type UpdateMemoryRequestInput = z.infer<typeof UpdateMemoryRequestSchema>;

// ── Memory Proposal Schema ──

export const MemoryProposalSchema = z.object({
  action: z.enum(['ADD', 'UPDATE', 'DELETE', 'LINK']).describe('Proposed action'),
  title: z.string().describe('Title of the proposed memory'),
  content: z.string().describe('Content of the proposed memory'),
  domain: z.string().describe('Knowledge domain'),
  tags: z.array(z.string()).describe('Searchable tags'),
  memoryClass: MemoryClassSchema.describe('Classification tier'),
  importance: z.number().min(0).max(1).describe('Importance score 0-1'),
  confidence: ConfidenceSchema.describe('Confidence level'),
  sourceType: SourceTypeSchema.describe('How this memory was created'),
  sourceRef: z.string().nullable().describe('Reference to the original source'),
  targetId: z.string().optional().describe('Target memory ID for UPDATE/DELETE/LINK'),
  relatedEntityIds: z.array(z.string()).optional().describe('IDs of related entities'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata'),
});

export type MemoryProposalInput = z.infer<typeof MemoryProposalSchema>;
