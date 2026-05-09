import { z } from 'zod';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext } from '../types';

const ProjectStatusInput = z.object({
  projectName: z.string().min(1),
  userId: z.string(),
});

const ProjectSummaryInput = z.object({
  projectName: z.string().min(1),
  userId: z.string(),
});

export function projectStatusTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'project_status',
    description: 'Get the current status of a project.',
    inputSchema: ProjectStatusInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'project:write');
      const input = ProjectStatusInput.parse(raw);

      return withAudit(client, ctx, 'project_status', input, async () => {
        const results = await client.searchMemories({
          query: `project ${input.projectName}`,
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: 5,
        });
        return {
          project: input.projectName,
          relatedMemories: results.map(m => ({ id: m.id, title: m.title, content: m.content.slice(0, 200) })),
          count: results.length,
        };
      });
    },
  };
}

export function projectSummaryTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'project_summary',
    description: 'Retrieve a summary of all memories and tasks related to a project.',
    inputSchema: ProjectSummaryInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'project:write');
      const input = ProjectSummaryInput.parse(raw);

      return withAudit(client, ctx, 'project_summary', input, async () => {
        const [memories, tasks] = await Promise.all([
          client.searchMemories({
            query: `project ${input.projectName}`,
            tenantId: ctx.tenantId,
            userId: input.userId,
            limit: 10,
          }),
          client.searchMemories({
            query: `project:${input.projectName} task`,
            tenantId: ctx.tenantId,
            userId: input.userId,
            limit: 20,
          }),
        ]);

        return {
          project: input.projectName,
          memories: memories.length,
          tasks: tasks.length,
          recentMemories: memories.slice(0, 3).map(m => ({ id: m.id, title: m.title })),
          taskList: tasks.slice(0, 10).map(t => ({ id: t.id, title: t.title, content: t.content.slice(0, 150) })),
        };
      });
    },
  };
}
