// memory Zod schemas — matches packages/shared/src/types/memory.types.ts

import { z } from 'zod';
import { MemoryClass, MemoryStatus, Confidence, SourceType } from '../types/memory.types';
import { queryDateString, queryEnum, queryFlag, queryNativeEnum, queryNonNegativeInt, queryString } from './bounds.schema';
import { normalizeDomain } from '../utils/domain';

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
  // ── Multi-agent / tenant / encryption columns (optional, see memory.types.ts) ──
  agentId: z.string().optional().describe('Agent that wrote this row'),
  tenantId: z.string().optional().describe('Tenant namespace'),
  deletedAt: z.coerce.date().nullable().optional().describe('Soft-delete timestamp'),
  recallCount: z.number().int().min(0).optional().describe('Successful-retrieval counter'),
  embeddingModel: z.string().optional().describe('Embedding model used for this row'),
  encryptionKeyId: z.string().nullable().optional().describe('At-rest encryption key id'),
  encryptionAlgorithm: z.string().nullable().optional().describe('At-rest encryption algorithm'),
});

export type MemoryInput = z.infer<typeof MemorySchema>;

// ── Memory API Record Schema (JSON wire form, ISO date strings) ──

export const MemoryApiRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  content: z.string(),
  domain: z.string(),
  sector: z.string(),
  tags: z.array(z.string()),
  memoryClass: MemoryClassSchema,
  importance: z.number().min(0).max(1),
  confidence: ConfidenceSchema,
  status: MemoryStatusSchema,
  validAt: z.string(),
  invalidAt: z.string().nullable(),
  supersededBy: z.string().nullable(),
  sourceType: SourceTypeSchema,
  sourceRef: z.string().nullable(),
  sourceWeight: z.number(),
  version: z.number().int(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastAccessedAt: z.string().nullable(),
  agentId: z.string().optional(),
  tenantId: z.string().optional(),
  deletedAt: z.string().nullable().optional(),
  recallCount: z.number().int().min(0).optional(),
  embeddingModel: z.string().optional(),
  encryptionKeyId: z.string().nullable().optional(),
  encryptionAlgorithm: z.string().nullable().optional(),
});

export type MemoryApiRecordInput = z.infer<typeof MemoryApiRecordSchema>;

/**
 * Postgres text columns cannot store U+0000; without this guard a NUL in a
 * title or content reached the INSERT and surfaced as a 500 instead of a 422.
 */
const NO_NUL = { message: 'must not contain NUL (U+0000) characters' };
const noNul = (s: string) => !s.includes('\u0000');

// ── Create Memory Request Schema ──

/**
 * Normalize domain values so refusal gates (e.g. ministry) cannot be bypassed
 * by case variation or padding. WS-6 F-101.
 *
 * Shared `normalizeDomain` (H2, 2026-10-30): NFKC, strip zero-width/format
 * characters, trim, lowercase, and collapse every ministry-like spelling
 * (lookalikes, `ministries`, `ministry/*`, `tgfc-ministry`) to `'ministry'`.
 * The downstream refusal check (`memory.service.ts`) compares against
 * `'ministry'` — anything that should be refused MUST normalize to that form here.
 */
const DomainSchema = z
  .string()
  .min(1)
  .transform(s => normalizeDomain(s))
  .refine(s => s.length > 0, { message: 'domain cannot be empty after trim' });

export const CreateMemoryRequestSchema = z.object({
  title: z.string().min(1).refine(noNul, NO_NUL).describe('Short title summarizing the memory'),
  content: z.string().min(1).refine(noNul, NO_NUL).describe('Full text content of the memory'),
  domain: DomainSchema.describe('Knowledge domain this memory belongs to'),
  sourceType: SourceTypeSchema.describe('How this memory was created'),
  sector: z.string().optional().describe('Sector within the domain'),
  tags: z.array(z.string()).optional().describe('Searchable tags'),
  memoryClass: MemoryClassSchema.optional().describe('Classification tier'),
  importance: z.number().min(0).max(1).optional().describe('Importance score 0-1'),
  confidence: ConfidenceSchema.optional().describe('Confidence level'),
  sourceRef: z.string().nullable().optional().describe('Reference to the original source'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata'),
  dedup: z.boolean().optional().describe('false skips the near-duplicate auto-supersede (bulk imports that key their own rows, e.g. the vault importer); default true'),
});

export type CreateMemoryRequestInput = z.infer<typeof CreateMemoryRequestSchema>;

// ── Update Memory Request Schema ──

export const UpdateMemoryRequestSchema = z.object({
  title: z.string().min(1).refine(noNul, NO_NUL).optional().describe('Short title summarizing the memory'),
  content: z.string().min(1).refine(noNul, NO_NUL).optional().describe('Full text content of the memory'),
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

// ── RD-4: soft domain budgets (matches MemoryBudgetStatus / MemoryBudgetReport) ──

export const MemoryBudgetStatusSchema = z.object({
  domain: z.string().min(1).describe('Memory domain (normalized, lowercase)'),
  count: z.number().int().min(0).describe('Live memories in the domain (not deleted, not ARCHIVED)'),
  limit: z.number().int().positive().describe('DOMAIN_MEMORY_BUDGETS value for the domain (soft)'),
  over: z.boolean().describe('count > limit (writes still succeed)'),
});

export type MemoryBudgetStatusInput = z.infer<typeof MemoryBudgetStatusSchema>;

export const MemoryBudgetReportSchema = z.object({
  scope: z.enum(['user', 'tenant']).describe("'user' = all of the user's tenants (what the budget counts); 'tenant' = one tenant"),
  tenantId: z.string().nullable().describe('The tenant counted when scope is tenant, else null'),
  domains: z.array(MemoryBudgetStatusSchema),
});

export type MemoryBudgetReportInput = z.infer<typeof MemoryBudgetReportSchema>;

// ── GET /memories query (robustness fixes 2026-10-30) — matches ListMemoriesQuery ──

export const MEMORY_LIST_SORT_FIELDS = ['createdAt', 'updatedAt', 'importance', 'title', 'lastAccessedAt', 'validAt'] as const;

export const ListMemoriesQuerySchema = z.object({
  q: queryString().describe('Case-insensitive substring of title or content'),
  domain: queryString().describe('Exact domain'),
  tags: queryString().describe('Comma-separated tags; every tag must match'),
  tenantId: queryString().describe('Tenant filter'),
  memoryClass: queryNativeEnum(MemoryClass),
  status: queryNativeEnum(MemoryStatus),
  since: queryDateString().describe('Only memories created at or after this instant'),
  sortBy: queryEnum(MEMORY_LIST_SORT_FIELDS),
  sortOrder: queryEnum(['asc', 'desc']),
  limit: queryNonNegativeInt().describe('Page size (the service caps it at 100)'),
  offset: queryNonNegativeInt(),
  includeInvalidated: queryFlag().describe('true = include superseded / consolidated rows'),
  includeAllTenants: queryFlag().describe('true = cross tenants (admin key only)'),
});

export type ListMemoriesQueryInput = z.infer<typeof ListMemoriesQuerySchema>;
