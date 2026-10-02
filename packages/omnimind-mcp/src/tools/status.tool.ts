import { z } from 'zod';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import { TASK_TAG, taskStatusTag } from './task.tool';
import { COMMITMENT_TAG, COMMITMENT_PENDING_TAG } from './commitment.tool';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext } from '../types';

export const DECISION_TAG = 'decision';

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
      const input = parseInput(StatusGetInput, raw);

      return withAudit(client, ctx, 'status_get', input, async () => {
        const base = { tenantId: ctx.tenantId, userId: input.userId };
        // M-102: every category is a TAG query. `hasEvery` is AND, so "todo OR
        // in_progress" is one `task` query filtered client-side.
        const [decisions, allTasks, blockers, commitments] = await Promise.all([
          client.searchMemories({ ...base, tags: [DECISION_TAG], limit: 5 }),
          client.searchMemories({ ...base, tags: [TASK_TAG], limit: 25 }),
          client.searchMemories({ ...base, tags: [TASK_TAG, taskStatusTag('blocked')], limit: 5 }),
          client.searchMemories({ ...base, tags: [COMMITMENT_TAG, COMMITMENT_PENDING_TAG], limit: 5 }),
        ]);
        const activeTags = new Set([taskStatusTag('todo'), taskStatusTag('in_progress')]);
        const activeTasks = allTasks.filter(m => (m.tags ?? []).some(t => activeTags.has(t))).slice(0, 10);

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
