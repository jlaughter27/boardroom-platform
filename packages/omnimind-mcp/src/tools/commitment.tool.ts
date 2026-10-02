import { z } from 'zod';
import { McpCursorSchema, McpCommitmentLogOutputSchema, McpCommitmentListOutputSchema } from '@boardroom/shared';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import { MAX_PAGE_SIZE, decodeCursor, pageOf } from '../lib/cursor';
import { IdempotencyKeyInput } from './memory.tool';
import type { OmniMindClient } from '../lib/client';
import { ADDITIVE_WRITE_ANNOTATIONS, READ_ONLY_ANNOTATIONS } from '../types';
import type { AgentContext, McpTool } from '../types';

export const COMMITMENT_TAG = 'commitment';
export const COMMITMENT_PENDING_TAG = 'commitment:pending';

const CommitmentLogInput = z.object({
  title: z.string().min(1).max(200).describe('What you committed to do'),
  dueDate: z.string().optional().describe('ISO date string'),
  toWhom: z.string().optional().describe('Who you committed to'),
  userId: z.string(),
  tags: z.array(z.string()).default([]),
  idempotencyKey: IdempotencyKeyInput,
});

const CommitmentListInput = z.object({
  userId: z.string(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(10).describe('Page size (max 20)'),
  cursor: McpCursorSchema.optional().describe('Opaque cursor from a previous page (`nextCursor`)'),
});

export function commitmentLogTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'commitment_log',
    title: 'Log commitment',
    description: 'Log a commitment (something you promised to do). Pass idempotencyKey to make retries safe.',
    inputSchema: CommitmentLogInput,
    outputSchema: McpCommitmentLogOutputSchema,
    annotations: ADDITIVE_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'commitment:write');
      const input = parseInput(CommitmentLogInput, raw);

      return withAudit(client, ctx, 'commitment_log', input, async () => {
        const content = [
          `Commitment: ${input.title}`,
          input.toWhom && `To: ${input.toWhom}`,
          input.dueDate && `Due: ${input.dueDate}`,
          'Status: pending',
        ].filter(Boolean).join('\n');

        const created = await client.createMemory({
          title: input.title,
          content,
          domain: 'business',
          tags: [...input.tags, COMMITMENT_TAG, COMMITMENT_PENDING_TAG],
          importance: 0.7,
          sourceType: 'MCP_AGENT',
          agentId: ctx.agentId,
          tenantId: ctx.tenantId,
          sourceWeight: ctx.sourceWeight,
        }, input.userId, input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined);
        return { id: created.id, logged: true as const, action: created.status };
      });
    },
  } satisfies McpTool;
}

export function commitmentListTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'commitment_list',
    title: 'List commitments',
    description: 'List pending commitments. Paginated: pass `cursor` from `nextCursor` for the next page (max 20 per page).',
    inputSchema: CommitmentListInput,
    outputSchema: McpCommitmentListOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = parseInput(CommitmentListInput, raw);

      return withAudit(client, ctx, 'commitment_list', input, async () => {
        // M-102: `commitment:pending` is a TAG, not text — query by tags.
        const offset = decodeCursor(input.cursor);
        const results = await client.searchMemories({
          tags: [COMMITMENT_TAG, COMMITMENT_PENDING_TAG],
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: input.limit + 1,
          offset,
        });
        const { items, nextCursor } = pageOf(results, offset, input.limit);
        return { commitments: items.map(m => ({ id: m.id, title: m.title, content: m.content })), count: items.length, nextCursor };
      });
    },
  } satisfies McpTool;
}
