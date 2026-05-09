import { z } from 'zod';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext } from '../types';

const PersonGetInput = z.object({
  name: z.string().min(1).describe('Person name to look up'),
  userId: z.string(),
});

export function personGetTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'person_get',
    description: 'Look up memories and context about a specific person.',
    inputSchema: PersonGetInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = PersonGetInput.parse(raw);

      return withAudit(client, ctx, 'person_get', input, async () => {
        const results = await client.searchMemories({
          query: input.name,
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: 5,
        });
        return {
          name: input.name,
          memories: results.map(m => ({ id: m.id, title: m.title, content: m.content.slice(0, 300), tags: m.tags })),
          count: results.length,
        };
      });
    },
  };
}
