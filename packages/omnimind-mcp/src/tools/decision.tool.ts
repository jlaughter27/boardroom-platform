import { z } from 'zod';
import { isMinistryDomain } from '@boardroom/shared';
import { requireScope } from '../lib/namespace';
import { withAudit, auditRefusal } from '../lib/audit';
import { parseInput } from '../lib/validate';
import { DomainSchema, MINISTRY_DEFERRED_MESSAGE } from './memory.tool';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext } from '../types';

const DecisionLogInput = z.object({
  title: z.string().min(1).max(200).describe('Decision title'),
  content: z.string().min(1).describe('What was decided and why'),
  userId: z.string().describe('User ID'),
  // F-205: normalized (trim + lowercase) so the ministry gate / redaction cannot be bypassed.
  domain: DomainSchema.default('business').describe('Domain context'),
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
      const input = parseInput(DecisionLogInput, raw);

      // Same gate as memory_write: ministry writes are deferred and the refusal
      // is audited with the content redacted (F-205 / F-212).
      if (isMinistryDomain(input.domain)) {
        auditRefusal(client, ctx, 'decision_log', input, 'MINISTRY_DEFERRED');
        return { logged: false as const, error: 'MINISTRY_DEFERRED' as const, message: MINISTRY_DEFERRED_MESSAGE };
      }

      return withAudit(client, ctx, 'decision_log', input, async () => {
        const created = await client.createMemory({
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
        return { id: created.id, logged: true as const, action: created.status };
      });
    },
  };
}
