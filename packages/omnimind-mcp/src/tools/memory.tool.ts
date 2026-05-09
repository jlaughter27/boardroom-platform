import { z } from 'zod';
import { extractAndDedup } from '../lib/fact-extractor';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext, MemoryWriteResult } from '../types';

const MemoryWriteInput = z.object({
  content: z.string().min(1).max(10000).describe('The memory content to store'),
  domain: z.string().default('general').describe('Domain context: business, personal, ministry, technical'),
  tags: z.array(z.string()).default([]).describe('Tags for retrieval'),
  importance: z.number().min(0).max(1).default(0.5).describe('Importance score 0-1'),
  userId: z.string().describe('The user ID this memory belongs to'),
  skipExtraction: z.boolean().default(false).describe('Skip fact extraction and store as-is'),
});

const MemorySearchInput = z.object({
  query: z.string().min(1).describe('Search query'),
  userId: z.string().describe('User ID to search memories for'),
  domain: z.string().optional().describe('Narrow to a specific domain'),
  limit: z.number().int().min(1).max(20).default(5).describe('Max results'),
  includeArchived: z.boolean().default(false).describe('Include archived memories'),
});

const MemorySupersededInput = z.object({
  id: z.string().describe('Memory ID to supersede'),
  newContent: z.string().min(1).describe('Updated content'),
  userId: z.string().describe('User ID'),
});

export function memoryWriteTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_write',
    description: 'Write one or more memories to the shared store. Fact extraction and dedup runs automatically — duplicate facts are updated, not duplicated.',
    inputSchema: MemoryWriteInput,
    async execute(raw: unknown): Promise<MemoryWriteResult> {
      requireScope(ctx, 'memory:write');
      const input = MemoryWriteInput.parse(raw);

      return withAudit(client, ctx, 'memory_write', input, async () => {
        const created: string[] = [];
        const updated: string[] = [];

        if (input.skipExtraction) {
          const mem = await client.createMemory({
            title: input.content.slice(0, 80),
            content: input.content,
            domain: input.domain,
            tags: input.tags,
            importance: input.importance,
            sourceType: 'MCP_AGENT',
            agentId: ctx.agentId,
            tenantId: ctx.tenantId,
            sourceWeight: ctx.sourceWeight,
          }, input.userId);
          created.push(mem.id);
          return { created, updated, skipped: 0 };
        }

        const facts = await extractAndDedup(input.content, ctx, client, input.userId);
        let skipped = 0;

        if (facts.length === 0) {
          // No facts extracted → store raw content as a single context memory
          const mem = await client.createMemory({
            title: input.content.slice(0, 80),
            content: input.content,
            domain: input.domain,
            tags: input.tags,
            importance: input.importance,
            sourceType: 'MCP_AGENT',
            agentId: ctx.agentId,
            tenantId: ctx.tenantId,
            sourceWeight: ctx.sourceWeight,
          }, input.userId);
          created.push(mem.id);
          return { created, updated, skipped: 0 };
        }

        for (const fact of facts) {
          if (fact.action === 'create') {
            const mem = await client.createMemory({
              title: fact.text.slice(0, 80),
              content: fact.text,
              domain: input.domain,
              tags: [...input.tags, fact.type],
              importance: input.importance,
              sourceType: 'MCP_AGENT',
              agentId: ctx.agentId,
              tenantId: ctx.tenantId,
              sourceWeight: ctx.sourceWeight,
            }, input.userId);
            created.push(mem.id);
          } else if (fact.action === 'update' && fact.supersedes) {
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

        return { created, updated, skipped };
      });
    },
  };
}

export function memorySearchTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_search',
    description: 'Search the shared memory store using hybrid retrieval (semantic + keyword).',
    inputSchema: MemorySearchInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = MemorySearchInput.parse(raw);

      return withAudit(client, ctx, 'memory_search', input, async () => {
        const memories = await client.searchMemories({
          query: input.query,
          tenantId: ctx.tenantId,
          userId: input.userId,
          domain: input.domain,
          limit: input.limit,
          includeArchived: input.includeArchived,
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
      const input = MemorySupersededInput.parse(raw);

      return withAudit(client, ctx, 'memory_supersede', input, async () => {
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
