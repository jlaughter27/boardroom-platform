import { z } from 'zod';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext } from '../types';

const DecisionLogInput = z.object({
  title: z.string().min(1).max(200).describe('Decision title'),
  content: z.string().min(1).describe('What was decided and why'),
  userId: z.string().describe('User ID'),
  domain: z.string().default('business').describe('Domain context'),
  tags: z.array(z.string()).default([]),
  importance: z.number().min(0).max(1).default(0.8),
});

export function decisionLogTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'decision_log',
    description: 'Log a decision to the shared memory store with high importance.',
    inputSchema: DecisionLogInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'decision:write');
      const input = DecisionLogInput.parse(raw);

      return withAudit(client, ctx, 'decision_log', input, async () => {
        const mem = await client.createMemory({
          title: input.title,
          content: input.content,
          domain: input.domain,
          tags: [...input.tags, 'decision'],
          importance: input.importance,
          sourceType: 'MCP_AGENT',
          agentId: ctx.agentId,
          tenantId: ctx.tenantId,
          sourceWeight: ctx.sourceWeight,
        }, input.userId);
        return { id: mem.id, logged: true };
      });
    },
  };
}
