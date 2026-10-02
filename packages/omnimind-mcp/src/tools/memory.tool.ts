import { z } from 'zod';
import {
  normalizeDomain,
  isMinistryDomain,
  McpIdempotencyKeySchema,
  McpCursorSchema,
  McpMemoryWriteOutputSchema,
  McpMemorySearchOutputSchema,
  McpMemorySupersedeOutputSchema,
  McpMemoryReflectOutputSchema,
  McpMemoryConsolidateOutputSchema,
} from '@boardroom/shared';
import type { McpConsolidationPair } from '@boardroom/shared';
import { extractAndDedup } from '../lib/fact-extractor';
import { requireScope } from '../lib/namespace';
import { withAudit, auditRefusal, redactInputForAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import { MAX_PAGE_SIZE } from '../lib/cursor';
import type { OmniMindClient, MemoryRecord } from '../lib/client';
import {
  ADDITIVE_WRITE_ANNOTATIONS,
  DESTRUCTIVE_WRITE_ANNOTATIONS,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from '../types';
import type { AgentContext, McpTool, MemoryWriteResult } from '../types';

/**
 * Normalize domain so refusal gates (ministry) cannot be bypassed by case or
 * whitespace. WS-6 F-101. Uses the shared `normalizeDomain` so the MCP-side
 * gate, the API-side gate and audit redaction all agree.
 */
export const DomainSchema = z
  .string()
  .min(1)
  .transform(s => normalizeDomain(s))
  .refine(s => s.length > 0, { message: 'domain cannot be empty after trim' });

export const MINISTRY_DEFERRED_MESSAGE =
  'Ministry-domain memories are deferred. Use a non-ministry domain. Ministry path will return in Phase 6+.';

/** Phase 6 — optional `Idempotency-Key` for the write tools (≤128 chars). */
export const IdempotencyKeyInput = McpIdempotencyKeySchema.optional().describe(
  'Optional idempotency key (≤128 chars). Repeating a call with the same key within 24h replays the first result instead of writing again.'
);

/** Cosine threshold above which two memories are treated as duplicates by memory_consolidate. */
export const CONSOLIDATE_SIMILARITY_THRESHOLD = 0.92;
export const CONSOLIDATE_MAX_LIMIT = 50;

const MemoryWriteInput = z.object({
  content: z.string().min(1).max(10000).describe('The memory content to store'),
  domain: DomainSchema.default('general').describe('Domain context: business, personal, ministry, technical'),
  tags: z.array(z.string()).default([]).describe('Tags for retrieval'),
  importance: z.number().min(0).max(1).default(0.5).describe('Importance score 0-1'),
  userId: z.string().describe('The user ID this memory belongs to'),
  skipExtraction: z.boolean().default(false).describe('Skip fact extraction and store as-is'),
  idempotencyKey: IdempotencyKeyInput,
});

const MemorySearchInput = z.object({
  query: z.string().min(1).describe('Natural-language query — hybrid semantic + full-text + trigram search with recency weighting'),
  userId: z.string().describe('User ID to search memories for'),
  domain: DomainSchema.optional().describe('Narrow to a specific domain'),
  tags: z.array(z.string()).optional().describe('Only memories carrying ALL of these tags'),
  status: z.enum(['DRAFT', 'CONFIRMED', 'SUPERSEDED', 'ARCHIVED', 'REJECTED']).optional()
    .describe('Exact memory status. When omitted, archived memories are excluded.'),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(5).describe('Page size (max 20)'),
  includeArchived: z.boolean().default(false).describe('Include ARCHIVED memories in the ranking'),
  asOf: z.string().datetime({ offset: true }).optional()
    .describe('ISO timestamp — only return facts that were valid at this moment (temporal validity filter)'),
  cursor: McpCursorSchema.optional().describe('Opaque cursor from a previous page (`nextCursor`)'),
});

const MemorySupersededInput = z.object({
  id: z.string().describe('Memory ID to supersede'),
  newContent: z.string().min(1).describe('Updated content'),
  userId: z.string().describe('User ID'),
});

const MemoryReflectInput = z.object({
  entityType: z.enum(['goal', 'project', 'person']).describe('Entity kind to reflect on'),
  entityId: z.string().min(1).describe('Entity id (Goal / Project / Person primary key)'),
  userId: z.string().describe('User ID'),
});

const MemoryConsolidateInput = z.object({
  userId: z.string().describe('User ID'),
  dryRun: z.boolean().default(true).describe('true (default) = only propose pairs; false = apply PATCH supersedes for each pair'),
  limit: z.number().int().min(1).max(CONSOLIDATE_MAX_LIMIT).default(20).describe('How many recent memories to scan (max 50)'),
  domain: DomainSchema.optional().describe('Restrict the scan to one domain'),
});

function refused(error: 'MINISTRY_DEFERRED' | 'FACT_EXTRACTOR_UNAVAILABLE', message: string): MemoryWriteResult {
  return { ok: false, error, message, created: [], updated: [], skipped: 0 };
}

export function memoryWriteTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_write',
    title: 'Write memory',
    description: 'Write one or more memories to the shared store. Fact extraction and dedup runs automatically — duplicate facts are updated, not duplicated. Pass idempotencyKey to make retries safe.',
    inputSchema: MemoryWriteInput,
    outputSchema: McpMemoryWriteOutputSchema,
    annotations: ADDITIVE_WRITE_ANNOTATIONS,
    async execute(raw: unknown): Promise<MemoryWriteResult> {
      requireScope(ctx, 'memory:write');
      const input = parseInput(MemoryWriteInput, raw);
      const writeOpts = input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined;

      // Ministry domain is explicitly deferred (Phase 6+). F-212: the refusal
      // is audited (redacted) instead of vanishing.
      if (isMinistryDomain(input.domain)) {
        auditRefusal(client, ctx, 'memory_write', input, 'MINISTRY_DEFERRED');
        return refused('MINISTRY_DEFERRED', MINISTRY_DEFERRED_MESSAGE);
      }

      const auditInput = redactInputForAudit(input);

      try {
        return await withAudit(client, ctx, 'memory_write', auditInput, async (): Promise<MemoryWriteResult> => {
          const created: string[] = [];
          const updated: string[] = [];

          // M-107: report the server's verdict — a near-duplicate is auto-superseded
          // server-side and comes back as status 'updated', not 'created'.
          const record = (r: { id: string; status: 'created' | 'updated' }) => {
            (r.status === 'updated' ? updated : created).push(r.id);
          };

          if (input.skipExtraction) {
            record(await client.createMemory({
              title: input.content.slice(0, 80),
              content: input.content,
              domain: input.domain,
              tags: input.tags,
              importance: input.importance,
              sourceType: 'MCP_AGENT',
              agentId: ctx.agentId,
              tenantId: ctx.tenantId,
              sourceWeight: ctx.sourceWeight,
            }, input.userId, writeOpts));
            return { ok: true, created, updated, skipped: 0 };
          }

          const facts = await extractAndDedup(input.content, ctx, client, input.userId);
          let skipped = 0;

          if (facts.length === 0) {
            // No facts extracted → store raw content as a single context memory
            record(await client.createMemory({
              title: input.content.slice(0, 80),
              content: input.content,
              domain: input.domain,
              tags: input.tags,
              importance: input.importance,
              sourceType: 'MCP_AGENT',
              agentId: ctx.agentId,
              tenantId: ctx.tenantId,
              sourceWeight: ctx.sourceWeight,
            }, input.userId, writeOpts));
            return { ok: true, created, updated, skipped: 0 };
          }

          // One idempotency key covers the whole call; each extracted fact gets
          // a derived key so a replay returns the same N rows, not one.
          const factOpts = (i: number) =>
            input.idempotencyKey ? { idempotencyKey: `${input.idempotencyKey}:${i}`.slice(0, 128) } : undefined;

          for (const [i, fact] of facts.entries()) {
            if (fact.action === 'create') {
              record(await client.createMemory({
                title: fact.text.slice(0, 80),
                content: fact.text,
                domain: input.domain,
                tags: [...input.tags, fact.type],
                importance: input.importance,
                sourceType: 'MCP_AGENT',
                agentId: ctx.agentId,
                tenantId: ctx.tenantId,
                sourceWeight: ctx.sourceWeight,
              }, input.userId, factOpts(i)));
            } else if (fact.action === 'update' && fact.supersedes) {
              // Explicit supersede — `supersedes` is NOT accepted on POST /memories.
              const mem = await client.updateMemory(fact.supersedes, {
                content: fact.text,
                sourceType: 'MCP_AGENT',
                agentId: ctx.agentId,
              }, input.userId, factOpts(i));
              updated.push(mem.id);
            } else {
              skipped++;
            }
          }

          return { ok: true, created, updated, skipped };
        });
      } catch (err) {
        // WS-2.4 — surface Haiku outages as a typed refusal the agent can retry.
        if ((err as { code?: string }).code === 'FACT_EXTRACTOR_UNAVAILABLE') {
          return refused('FACT_EXTRACTOR_UNAVAILABLE', (err as Error).message);
        }
        throw err;
      }
    },
  } satisfies McpTool;
}

export function memorySearchTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_search',
    title: 'Search memories',
    description: 'Hybrid search over the shared memory store (semantic + full-text + trigram, recency-weighted). Paginated: pass `cursor` from `nextCursor` for the next page (max 20 per page).',
    inputSchema: MemorySearchInput,
    outputSchema: McpMemorySearchOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = parseInput(MemorySearchInput, raw);

      return withAudit(client, ctx, 'memory_search', input, async () => {
        const { items, nextCursor } = await client.searchHybrid({
          query: input.query,
          limit: input.limit,
          domain: input.domain,
          tags: input.tags,
          status: input.status,
          includeArchived: input.includeArchived,
          asOf: input.asOf,
          cursor: input.cursor,
        }, input.userId);
        return { memories: items, count: items.length, nextCursor };
      });
    },
  } satisfies McpTool;
}

export function memorySupersedeT(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_supersede',
    title: 'Supersede memory',
    description: 'Mark an existing memory as outdated and replace its content. The old content is kept in version history, not deleted.',
    inputSchema: MemorySupersededInput,
    outputSchema: McpMemorySupersedeOutputSchema,
    annotations: DESTRUCTIVE_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:write');
      const input = parseInput(MemorySupersededInput, raw);

      // Check domain of the existing memory to decide whether to redact
      let auditInput: Record<string, unknown> = input as Record<string, unknown>;
      try {
        const existing = await client.getMemory(input.id, input.userId);
        if (existing && isMinistryDomain(existing.domain)) {
          auditInput = { ...auditInput, domain: 'ministry', newContent: '[REDACTED:ministry]' };
        }
      } catch {
        // If lookup fails, log as-is (fail open on audit redaction)
      }

      return withAudit(client, ctx, 'memory_supersede', auditInput, async () => {
        const mem = await client.updateMemory(input.id, {
          content: input.newContent,
          sourceType: 'MCP_AGENT',
          agentId: ctx.agentId,
        }, input.userId);
        return { id: mem.id, updated: true as const };
      });
    },
  } satisfies McpTool;
}

/**
 * Phase 6 — `memory_reflect`: regenerate one entity's ContextCapsule right now
 * (`POST /context/reflect`, Haiku, Zod-validated server-side) and return it.
 * Idempotent in effect: reflecting twice yields the same capsule (version++).
 */
export function memoryReflectTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_reflect',
    title: 'Reflect on entity',
    description: 'Regenerate the context capsule (summary, open risks, unresolved questions, recent changes, stakeholders) for one goal, project or person from its linked memories, and return it.',
    inputSchema: MemoryReflectInput,
    outputSchema: McpMemoryReflectOutputSchema,
    annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:write');
      const input = parseInput(MemoryReflectInput, raw);

      return withAudit(client, ctx, 'memory_reflect', input, async () => {
        const capsule = await client.reflect({ entityType: input.entityType, entityId: input.entityId }, input.userId);
        return { entityType: input.entityType, entityId: input.entityId, capsule };
      });
    },
  } satisfies McpTool;
}

type ConsolidationCandidate = Pick<MemoryRecord, 'id' | 'importance' | 'createdAt'>;

/** keep = higher importance; tie → newer `createdAt`. Exported for tests. */
export function chooseKeep(a: ConsolidationCandidate, b: ConsolidationCandidate): { keepId: string; archiveId: string } {
  const ia = a.importance ?? 0;
  const ib = b.importance ?? 0;
  if (ia !== ib) return ia > ib ? { keepId: a.id, archiveId: b.id } : { keepId: b.id, archiveId: a.id };
  const ta = Date.parse(a.createdAt ?? '') || 0;
  const tb = Date.parse(b.createdAt ?? '') || 0;
  return ta >= tb ? { keepId: a.id, archiveId: b.id } : { keepId: b.id, archiveId: a.id };
}

/**
 * Phase 6 — `memory_consolidate`: "dream" pass over the tenant's recent
 * memories. For each one, `POST /memories/search-similar` at ≥0.92 proposes
 * `{keepId, archiveId, similarity}`; with `dryRun=false` each pair is applied
 * as `PATCH /memories/:keepId { supersedes: archiveId }` (old row gets
 * `invalidAt`/`supersededBy`, nothing is deleted). Destructive only when
 * `dryRun=false`; the annotation reflects the worst case.
 */
export function memoryConsolidateTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_consolidate',
    title: 'Consolidate duplicate memories',
    description: 'Find near-duplicate memories (cosine ≥ 0.92) among the most recent ones and propose keep/archive pairs. Default dryRun=true only proposes; dryRun=false supersedes each archiveId with its keepId (reversible via version history, never deleted).',
    inputSchema: MemoryConsolidateInput,
    outputSchema: McpMemoryConsolidateOutputSchema,
    annotations: DESTRUCTIVE_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:write');
      const input = parseInput(MemoryConsolidateInput, raw);

      return withAudit(client, ctx, 'memory_consolidate', input, async () => {
        const recent = await client.searchMemories({
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: input.limit,
          domain: input.domain,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        });
        // Ministry rows are never touched: their content is encrypted and their
        // embeddings live on the local model; consolidation is OpenAI-side only.
        const scannable = recent.filter(m => !isMinistryDomain(m.domain));
        const excluded = new Set(recent.filter(m => isMinistryDomain(m.domain)).map(m => m.id));
        const byId = new Map(scannable.map(m => [m.id, m]));

        const pairs: McpConsolidationPair[] = [];
        const seen = new Set<string>();
        const archived = new Set<string>();

        for (const mem of scannable) {
          if (archived.has(mem.id) || !mem.content?.trim()) continue;
          let hits: Awaited<ReturnType<OmniMindClient['searchSimilar']>> = [];
          try {
            hits = await client.searchSimilar({
              query: mem.content,
              userId: input.userId,
              threshold: CONSOLIDATE_SIMILARITY_THRESHOLD,
              limit: 5,
              domain: mem.domain,
            });
          } catch {
            continue; // one failed similarity lookup must not abort the whole pass
          }
          for (const hit of hits) {
            if (hit.id === mem.id || hit.similarity < CONSOLIDATE_SIMILARITY_THRESHOLD) continue;
            if (isMinistryDomain(hit.domain) || excluded.has(hit.id)) continue;
            const key = [mem.id, hit.id].sort().join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            const other = byId.get(hit.id) ?? hit;
            if (archived.has(other.id)) continue;
            const { keepId, archiveId } = chooseKeep(mem, other);
            if (archived.has(keepId)) continue;
            archived.add(archiveId);
            pairs.push({ keepId, archiveId, similarity: Math.min(1, Math.max(0, hit.similarity)) });
          }
        }

        let applied = 0;
        const errors: Array<{ keepId: string; archiveId: string; message: string }> = [];
        if (!input.dryRun) {
          for (const pair of pairs) {
            try {
              await client.updateMemory(pair.keepId, { supersedes: pair.archiveId, agentId: ctx.agentId }, input.userId);
              applied++;
            } catch (err) {
              errors.push({ keepId: pair.keepId, archiveId: pair.archiveId, message: (err as Error).message });
            }
          }
        }

        return { dryRun: input.dryRun, scanned: scannable.length, pairs, applied, errors };
      });
    },
  } satisfies McpTool;
}
