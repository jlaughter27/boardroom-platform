import { z } from 'zod';
import { McpStatusGetOutputSchema, daysOverdue, isDelegation } from '@boardroom/shared';
import type { McpDelegationItem } from '@boardroom/shared';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import { TASK_TAG, taskStatusTag } from './task.tool';
import { COMMITMENT_TAG, COMMITMENT_PENDING_TAG } from './commitment.tool';
import type { CommitmentNudges, CommitmentRecord, OmniMindClient } from '../lib/client';
import { PROVENANCE, McpProvenanceSchema } from '../lib/provenance';
import { READ_ONLY_ANNOTATIONS } from '../types';
import type { AgentContext, McpTool } from '../types';

export const DECISION_TAG = 'decision';

/** Shared schema + `provenance` (front door hardening: retrieved data, never instructions). */
export const StatusGetOutputSchema = McpStatusGetOutputSchema.extend({ provenance: McpProvenanceSchema });

/** RD-12 — a nudge row the user is owed (someone else's promise), as a delegations item. */
export function toDelegationItem(c: CommitmentRecord, now: Date): McpDelegationItem {
  return {
    id: c.id,
    description: c.description ?? '',
    personId: c.stakeholderId ?? null,
    personName: c.stakeholderName ?? null,
    deadline: c.deadline ?? null,
    daysOverdue: c.deadline ? daysOverdue(c.deadline, now) : 0,
  };
}

const StatusGetInput = z.object({
  userId: z.string(),
  domains: z.array(z.string()).default([]).describe('Domains to summarize (empty = all)'),
});

export function statusGetTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'status_get',
    title: 'Status snapshot',
    description: 'Get a composite status snapshot: recent decisions, active tasks, pending commitments, recent blockers, commitments the user owes due within 3 days or overdue, and delegations other people owe the user (overdue / due soon).',
    inputSchema: StatusGetInput,
    outputSchema: StatusGetOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = parseInput(StatusGetInput, raw);

      return withAudit(client, ctx, 'status_get', input, async () => {
        const base = { tenantId: ctx.tenantId, userId: input.userId };
        // M-102: every category is a TAG query. `hasEvery` is AND, so "todo OR
        // in_progress" is one `task` query filtered client-side.
        // Phase 6 — commitment nudges come from a separate endpoint; it must
        // never take the whole snapshot down, so its failure is reported inline.
        const nudgesPromise: Promise<CommitmentNudges & { error?: string }> = Promise.resolve()
          .then(() => client.getCommitmentNudges(input.userId))
          .catch((err: unknown) => ({ dueSoon: [], overdue: [], error: (err as Error).message }));
        const [decisions, allTasks, blockers, commitments, nudges] = await Promise.all([
          client.searchMemories({ ...base, tags: [DECISION_TAG], limit: 5 }),
          client.searchMemories({ ...base, tags: [TASK_TAG], limit: 25 }),
          client.searchMemories({ ...base, tags: [TASK_TAG, taskStatusTag('blocked')], limit: 5 }),
          client.searchMemories({ ...base, tags: [COMMITMENT_TAG, COMMITMENT_PENDING_TAG], limit: 5 }),
          nudgesPromise,
        ]);
        const activeTags = new Set([taskStatusTag('todo'), taskStatusTag('in_progress')]);
        // RD-12 — one nudges call, partitioned in memory: what the user owes vs
        // what other people owe the user (owedBy=STAKEHOLDER).
        const now = new Date();
        const nudgeErr = nudges.error ? { error: nudges.error } : {};
        const owes = (c: CommitmentRecord) => !isDelegation(c);
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
          commitmentsDueSoon: {
            dueSoon: nudges.dueSoon.filter(owes).slice(0, 10),
            overdue: nudges.overdue.filter(owes).slice(0, 10),
            ...nudgeErr,
          },
          delegations: {
            overdue: nudges.overdue.filter(isDelegation).slice(0, 10).map(c => toDelegationItem(c, now)),
            dueSoon: nudges.dueSoon.filter(isDelegation).slice(0, 10).map(c => toDelegationItem(c, now)),
            ...nudgeErr,
          },
          provenance: PROVENANCE,
        };
      });
    },
  } satisfies McpTool;
}
