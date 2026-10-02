import { z } from 'zod';
import { normalizeDomain, isMinistryDomain } from '@boardroom/shared';
import { extractAndDedup } from '../lib/fact-extractor';
import { requireScope } from '../lib/namespace';
import { withAudit, auditRefusal, redactInputForAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext, MemoryWriteResult } from '../types';

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

const MemoryWriteInput = z.object({
  content: z.string().min(1).max(10000).describe('The memory content to store'),
  domain: DomainSchema.default('general').describe('Domain context: business, personal, ministry, technical'),
  tags: z.array(z.string()).default([]).describe('Tags for retrieval'),
  importance: z.number().min(0).max(1).default(0.5).describe('Importance score 0-1'),
  userId: z.string().describe('The user ID this memory belongs to'),
  skipExtraction: z.boolean().default(false).describe('Skip fact extraction and store as-is'),
});

const MemorySearchInput = z.object({
  query: z.string().min(1).describe('Search text — case-insensitive substring match on title/content'),
  userId: z.string().describe('User ID to search memories for'),
  domain: DomainSchema.optional().describe('Narrow to a specific domain'),
  tags: z.array(z.string()).optional().describe('Only memories carrying ALL of these tags'),
  status: z.enum(['DRAFT', 'CONFIRMED', 'SUPERSEDED', 'ARCHIVED', 'REJECTED']).optional()
    .describe('Exact memory status. When omitted, archived memories are excluded.'),
  limit: z.number().int().min(1).max(20).default(5).describe('Max results'),
  includeArchived: z.boolean().default(false)
    .describe("Deprecated and ignored by the API — pass status: 'ARCHIVED' to list archived memories."),
});

const MemorySupersededInput = z.object({
  id: z.string().describe('Memory ID to supersede'),
  newContent: z.string().min(1).describe('Updated content'),
  userId: z.string().describe('User ID'),
});

function refused(error: 'MINISTRY_DEFERRED' | 'FACT_EXTRACTOR_UNAVAILABLE', message: string): MemoryWriteResult {
  return { ok: false, error, message, created: [], updated: [], skipped: 0 };
}

export function memoryWriteTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_write',
    description: 'Write one or more memories to the shared store. Fact extraction and dedup runs automatically — duplicate facts are updated, not duplicated.',
    inputSchema: MemoryWriteInput,
    async execute(raw: unknown): Promise<MemoryWriteResult> {
      requireScope(ctx, 'memory:write');
      const input = parseInput(MemoryWriteInput, raw);

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
            }, input.userId));
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
            }, input.userId));
            return { ok: true, created, updated, skipped: 0 };
          }

          for (const fact of facts) {
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
              }, input.userId));
            } else if (fact.action === 'update' && fact.supersedes) {
              // Explicit supersede — `supersedes` is NOT accepted on POST /memories.
              const mem = await client.updateMemory(fact.supersedes, {
                content: fact.text,
                sourceType: 'MCP_AGENT',
                agentId: ctx.agentId,
              }, input.userId);
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
  };
}

export function memorySearchTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_search',
    description: 'Search the shared memory store (substring match on title/content, optional tag filter).',
    inputSchema: MemorySearchInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = parseInput(MemorySearchInput, raw);

      return withAudit(client, ctx, 'memory_search', input, async () => {
        const memories = await client.searchMemories({
          query: input.query,
          tags: input.tags,
          tenantId: ctx.tenantId,
          userId: input.userId,
          domain: input.domain,
          status: input.status,
          limit: input.limit,
        });
        return { memories, count: memories.length };
      });
    },
  };
}

export function memorySupersedeT(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_supersede',
    description: 'Mark an existing memory as outdated and replace its content.',
    inputSchema: MemorySupersededInput,
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
        return { id: mem.id, updated: true };
      });
    },
  };
}
