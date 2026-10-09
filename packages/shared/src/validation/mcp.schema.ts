// MCP tool output schemas — Phase 6 (lane D).
//
// Every omnimind-mcp tool registers one of these as its `outputSchema` and
// returns the same object as `structuredContent`. They live in shared so
// BoardRoom / OmniMind can validate or type MCP results without importing the
// MCP package. These are WIRE shapes (ISO strings, not Dates) and are
// deliberately lenient on record bodies (`id` required, everything else
// optional + passthrough) so a tool never fails output validation because the
// API added or omitted a non-essential column.

import { z } from 'zod';
import { KnowledgeGraphEdgeSchema, KnowledgeGraphNodeSchema } from './graph.schema';

// ── Shared primitives ──

/**
 * User-supplied idempotency key accepted by the MCP write tools (≤100 chars).
 * OmniMind's `Idempotency-Key` header allows 128; the MCP cap is lower so
 * `memory_write` can derive a per-extracted-fact key (`<key[0..32)>:<sha256 hex[0..64)>`)
 * that always fits under the server limit without truncation collisions.
 */
export const MCP_IDEMPOTENCY_KEY_MAX_LENGTH = 100;
export const McpIdempotencyKeySchema = z.string().min(1).max(MCP_IDEMPOTENCY_KEY_MAX_LENGTH);

/** Opaque pagination cursor (base64 of `{offset}`) — never parsed by clients. */
export const McpCursorSchema = z.string().min(1).max(256);

export const McpIdTitleSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
}).passthrough();

/** A memory row as returned by the MCP tools (reduced + lenient MemoryApiRecord). */
export const McpMemoryItemSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  domain: z.string().optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().optional(),
  status: z.string().optional(),
  sourceType: z.string().optional(),
  tenantId: z.string().optional(),
  agentId: z.string().optional(),
  validAt: z.string().optional(),
  invalidAt: z.string().nullable().optional(),
  supersededBy: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  /** Hybrid-search relevance score (POST /memories/search only). */
  score: z.number().optional(),
}).passthrough();

/** Commitment row as returned by GET /commitments/nudges (wire: ISO strings). */
export const McpCommitmentItemSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  deadline: z.string().nullable().optional(),
  status: z.string().optional(),
  stakeholderId: z.string().nullable().optional(),
  linkedProjectId: z.string().nullable().optional(),
}).passthrough();

/** ContextCapsule on the wire (ISO strings; Phase 6 adds sourceMemoryIds / version). */
export const McpContextCapsuleSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  entityType: z.string(),
  entityId: z.string(),
  summary: z.string(),
  openRisks: z.array(z.string()).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
  activeStakeholders: z.array(z.string()).default([]),
  recentChanges: z.array(z.string()).default([]),
  sourceMemoryIds: z.array(z.string()).optional(),
  importanceSeen: z.number().optional(),
  version: z.number().int().optional(),
  generatedAt: z.string().optional(),
  staleAfter: z.string().optional(),
}).passthrough();

// ── memory_* ──

export const McpMemoryWriteOutputSchema = z.object({
  ok: z.boolean(),
  created: z.array(z.string()),
  updated: z.array(z.string()),
  skipped: z.number().int().nonnegative(),
  error: z.enum(['MINISTRY_DEFERRED', 'FACT_EXTRACTOR_UNAVAILABLE']).optional(),
  message: z.string().optional(),
});

export const McpMemorySearchOutputSchema = z.object({
  memories: z.array(McpMemoryItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

export const McpMemorySupersedeOutputSchema = z.object({
  id: z.string(),
  updated: z.literal(true),
});

export const McpMemoryReflectOutputSchema = z.object({
  entityType: z.enum(['goal', 'project', 'person']),
  entityId: z.string(),
  capsule: McpContextCapsuleSchema,
});

export const McpConsolidationPairSchema = z.object({
  keepId: z.string(),
  archiveId: z.string(),
  similarity: z.number().min(0).max(1),
});

export const McpMemoryConsolidateOutputSchema = z.object({
  dryRun: z.boolean(),
  scanned: z.number().int().nonnegative(),
  pairs: z.array(McpConsolidationPairSchema),
  /** Number of pairs applied via PATCH supersedes (0 on dry run). */
  applied: z.number().int().nonnegative(),
  errors: z.array(z.object({ keepId: z.string(), archiveId: z.string(), message: z.string() })),
});

// ── decision_log ──

export const McpDecisionLogOutputSchema = z.object({
  logged: z.boolean(),
  id: z.string().optional(),
  action: z.enum(['created', 'updated']).optional(),
  error: z.literal('MINISTRY_DEFERRED').optional(),
  message: z.string().optional(),
});

// ── task_* ──

export const McpTaskUpsertOutputSchema = z.object({
  id: z.string(),
  action: z.enum(['created', 'updated']),
});

export const McpTaskStatusOutputSchema = z.object({
  found: z.boolean(),
  id: z.string().optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  content: z.string().optional(),
});

export const McpTaskListOutputSchema = z.object({
  tasks: z.array(McpMemoryItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

export const McpTaskCompleteOutputSchema = z.object({
  found: z.boolean(),
  id: z.string().optional(),
  completed: z.boolean().optional(),
});

export const McpTaskBlockOutputSchema = z.object({
  found: z.boolean(),
  id: z.string().optional(),
  blocked: z.boolean().optional(),
});

// ── project_* / person_get ──

export const McpProjectStatusOutputSchema = z.object({
  project: z.string(),
  relatedMemories: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })),
  count: z.number().int().nonnegative(),
});

export const McpProjectSummaryOutputSchema = z.object({
  project: z.string(),
  memories: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
  recentMemories: z.array(z.object({ id: z.string(), title: z.string() })),
  taskList: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })),
});

export const McpPersonGetOutputSchema = z.object({
  name: z.string(),
  memories: z.array(z.object({ id: z.string(), title: z.string(), content: z.string(), tags: z.array(z.string()) })),
  count: z.number().int().nonnegative(),
});

// ── commitment_* ──

export const McpCommitmentLogOutputSchema = z.object({
  id: z.string(),
  logged: z.literal(true),
  action: z.enum(['created', 'updated']),
});

export const McpCommitmentListOutputSchema = z.object({
  commitments: z.array(z.object({ id: z.string(), title: z.string(), content: z.string() })),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

// ── status_get ──

export const McpStatusGetOutputSchema = z.object({
  snapshot: z.object({
    recentDecisions: z.array(McpIdTitleSchema),
    activeTasks: z.array(McpIdTitleSchema),
    blockers: z.array(McpIdTitleSchema),
    pendingCommitments: z.array(McpIdTitleSchema),
  }),
  counts: z.object({
    decisions: z.number().int().nonnegative(),
    activeTasks: z.number().int().nonnegative(),
    blockers: z.number().int().nonnegative(),
    commitments: z.number().int().nonnegative(),
  }),
  /** From GET /commitments/nudges. `error` is set (and lists empty) when that endpoint is unavailable. */
  commitmentsDueSoon: z.object({
    dueSoon: z.array(McpCommitmentItemSchema),
    overdue: z.array(McpCommitmentItemSchema),
    error: z.string().optional(),
  }),
});

// ── graph_neighborhood ──

export const McpGraphNeighborhoodOutputSchema = z.object({
  root: z.string(),
  hops: z.union([z.literal(1), z.literal(2)]),
  nodes: z.array(KnowledgeGraphNodeSchema),
  edges: z.array(KnowledgeGraphEdgeSchema),
  /** True when the 60-node cap stopped the BFS early. */
  truncated: z.boolean(),
});

// ── Inferred types ──

export type McpMemoryItem = z.infer<typeof McpMemoryItemSchema>;
export type McpCommitmentItem = z.infer<typeof McpCommitmentItemSchema>;
export type McpContextCapsule = z.infer<typeof McpContextCapsuleSchema>;
export type McpMemoryWriteOutput = z.infer<typeof McpMemoryWriteOutputSchema>;
export type McpMemorySearchOutput = z.infer<typeof McpMemorySearchOutputSchema>;
export type McpMemoryReflectOutput = z.infer<typeof McpMemoryReflectOutputSchema>;
export type McpConsolidationPair = z.infer<typeof McpConsolidationPairSchema>;
export type McpMemoryConsolidateOutput = z.infer<typeof McpMemoryConsolidateOutputSchema>;
export type McpStatusGetOutput = z.infer<typeof McpStatusGetOutputSchema>;
export type McpGraphNeighborhoodOutput = z.infer<typeof McpGraphNeighborhoodOutputSchema>;
