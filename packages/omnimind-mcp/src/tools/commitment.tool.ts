import { z } from 'zod';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext } from '../types';

export const COMMITMENT_TAG = 'commitment';
export const COMMITMENT_PENDING_TAG = 'commitment:pending';

const CommitmentLogInput = z.object({
  title: z.string().min(1).max(200).describe('What you committed to do'),
  dueDate: z.string().optional().describe('ISO date string'),
  toWhom: z.string().optional().describe('Who you committed to'),
  userId: z.string(),
  tags: z.array(z.string()).default([]),
});

const CommitmentListInput = z.object({
  userId: z.string(),
  limit: z.number().int().min(1).max(30).default(10),
});

export function commitmentLogTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'commitment_log',
    description: 'Log a commitment (something you promised to do).',
    inputSchema: CommitmentLogInput,
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
        }, input.userId);
        return { id: created.id, logged: true, action: created.status };
      });
    },
  };
}

export function commitmentListTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'commitment_list',
    description: 'List pending commitments.',
    inputSchema: CommitmentListInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = parseInput(CommitmentListInput, raw);

      return withAudit(client, ctx, 'commitment_list', input, async () => {
        // M-102: `commitment:pending` is a TAG, not text — query by tags.
        const results = await client.searchMemories({
          tags: [COMMITMENT_TAG, COMMITMENT_PENDING_TAG],
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: input.limit,
        });
        return { commitments: results.map(m => ({ id: m.id, title: m.title, content: m.content })), count: results.length };
      });
    },
  };
}
