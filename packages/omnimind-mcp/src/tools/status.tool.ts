import { z } from 'zod';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext } from '../types';

const StatusGetInput = z.object({
  userId: z.string(),
  domains: z.array(z.string()).default([]).describe('Domains to summarize (empty = all)'),
});

export function statusGetTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'status_get',
    description: 'Get a composite status snapshot: recent decisions, active tasks, pending commitments, and recent blockers.',
    inputSchema: StatusGetInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = StatusGetInput.parse(raw);

      return withAudit(client, ctx, 'status_get', input, async () => {
        const [decisions, activeTasks, blockers, commitments] = await Promise.all([
          client.searchMemories({ query: 'decision', tenantId: ctx.tenantId, userId: input.userId, limit: 5 }),
          client.searchMemories({ query: 'task:in_progress task:todo', tenantId: ctx.tenantId, userId: input.userId, limit: 10 }),
          client.searchMemories({ query: 'blocker task:blocked', tenantId: ctx.tenantId, userId: input.userId, limit: 5 }),
          client.searchMemories({ query: 'commitment:pending', tenantId: ctx.tenantId, userId: input.userId, limit: 5 }),
        ]);

        return {
          snapshot: {
            recentDecisions: decisions.slice(0, 3).map(m => ({ id: m.id, title: m.title })),
            activeTasks: activeTasks.slice(0, 5).map(m => ({ id: m.id, title: m.title })),
            blockers: blockers.slice(0, 3).map(m => ({ id: m.id, title: m.title })),
            pendingCommitments: commitments.slice(0, 3).map(m => ({ id: m.id, title: m.title })),
          },
          counts: {
            decisions: decisions.length,
            activeTasks: activeTasks.length,
            blockers: blockers.length,
            commitments: commitments.length,
          },
        };
      });
    },
  };
}
