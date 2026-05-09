import { z } from 'zod';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import type { OmniMindClient } from '../lib/client';
import type { AgentContext } from '../types';

const TaskUpsertInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().default(''),
  status: z.enum(['todo', 'in_progress', 'blocked', 'done']).default('todo'),
  userId: z.string(),
  projectRef: z.string().optional().describe('Project name or ID this task belongs to'),
  tags: z.array(z.string()).default([]),
  dueDate: z.string().optional().describe('ISO date string'),
});

const TaskStatusInput = z.object({
  taskTitle: z.string().min(1).describe('Task title to look up'),
  userId: z.string(),
});

const TaskListInput = z.object({
  userId: z.string(),
  status: z.enum(['todo', 'in_progress', 'blocked', 'done', 'all']).default('all'),
  limit: z.number().int().min(1).max(50).default(10),
});

const TaskCompleteInput = z.object({
  taskTitle: z.string().min(1),
  userId: z.string(),
  outcome: z.string().optional().describe('Brief outcome note'),
});

const TaskBlockInput = z.object({
  taskTitle: z.string().min(1),
  userId: z.string(),
  blockerDescription: z.string().min(1),
});

export function taskUpsertTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'task_upsert',
    description: 'Create or update a task in the shared store. Writes to memory with task metadata.',
    inputSchema: TaskUpsertInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'task:write');
      const input = TaskUpsertInput.parse(raw);

      return withAudit(client, ctx, 'task_upsert', input, async () => {
        const content = [
          `Task: ${input.title}`,
          input.description && `Description: ${input.description}`,
          `Status: ${input.status}`,
          input.projectRef && `Project: ${input.projectRef}`,
          input.dueDate && `Due: ${input.dueDate}`,
        ].filter(Boolean).join('\n');

        const tags = [...input.tags, 'task', `task:${input.status}`];
        if (input.projectRef) tags.push(`project:${input.projectRef}`);

        const existing = await client.searchMemories({
          query: `Task: ${input.title}`,
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: 1,
          similarityThreshold: 0.92,
        });

        if (existing.length > 0) {
          const mem = await client.updateMemory(existing[0].id, {
            content,
            tags,
            sourceType: 'MCP_AGENT',
            agentId: ctx.agentId,
          }, input.userId);
          return { id: mem.id, action: 'updated' };
        }

        const mem = await client.createMemory({
          title: input.title,
          content,
          domain: 'business',
          tags,
          importance: 0.6,
          sourceType: 'MCP_AGENT',
          agentId: ctx.agentId,
          tenantId: ctx.tenantId,
          sourceWeight: ctx.sourceWeight,
        }, input.userId);
        return { id: mem.id, action: 'created' };
      });
    },
  };
}

export function taskStatusTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'task_status',
    description: 'Look up the current status of a task.',
    inputSchema: TaskStatusInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'task:write');
      const input = TaskStatusInput.parse(raw);

      return withAudit(client, ctx, 'task_status', input, async () => {
        const results = await client.searchMemories({
          query: `Task: ${input.taskTitle}`,
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: 1,
        });
        if (results.length === 0) return { found: false };
        const mem = results[0];
        const statusMatch = mem.content.match(/Status: (\S+)/);
        return {
          found: true,
          id: mem.id,
          title: mem.title,
          status: statusMatch?.[1] ?? 'unknown',
          content: mem.content,
        };
      });
    },
  };
}

export function taskListTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'task_list',
    description: 'List tasks, optionally filtered by status.',
    inputSchema: TaskListInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'task:write');
      const input = TaskListInput.parse(raw);

      return withAudit(client, ctx, 'task_list', input, async () => {
        const query = input.status === 'all' ? 'task' : `task:${input.status}`;
        const results = await client.searchMemories({
          query,
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: input.limit,
        });
        return { tasks: results, count: results.length };
      });
    },
  };
}

export function taskCompleteTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'task_complete',
    description: 'Mark a task as done.',
    inputSchema: TaskCompleteInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'task:write');
      const input = TaskCompleteInput.parse(raw);

      return withAudit(client, ctx, 'task_complete', input, async () => {
        const results = await client.searchMemories({
          query: `Task: ${input.taskTitle}`,
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: 1,
          similarityThreshold: 0.9,
        });
        if (results.length === 0) return { found: false };

        const existing = results[0];
        const updatedContent = existing.content
          .replace(/Status: \S+/, 'Status: done')
          + (input.outcome ? `\nOutcome: ${input.outcome}` : '');

        await client.updateMemory(existing.id, {
          content: updatedContent,
          tags: [...(existing.tags.filter(t => !t.startsWith('task:'))), 'task', 'task:done'],
          agentId: ctx.agentId,
        }, input.userId);
        return { found: true, id: existing.id, completed: true };
      });
    },
  };
}

export function taskBlockTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'task_block',
    description: 'Mark a task as blocked and record the blocker.',
    inputSchema: TaskBlockInput,
    async execute(raw: unknown) {
      requireScope(ctx, 'task:write');
      const input = TaskBlockInput.parse(raw);

      return withAudit(client, ctx, 'task_block', input, async () => {
        const results = await client.searchMemories({
          query: `Task: ${input.taskTitle}`,
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: 1,
          similarityThreshold: 0.9,
        });
        if (results.length === 0) return { found: false };

        const existing = results[0];
        const updatedContent = existing.content
          .replace(/Status: \S+/, 'Status: blocked')
          + `\nBlocker: ${input.blockerDescription}`;

        await client.updateMemory(existing.id, {
          content: updatedContent,
          tags: [...(existing.tags.filter(t => !t.startsWith('task:'))), 'task', 'task:blocked', 'blocker'],
          agentId: ctx.agentId,
        }, input.userId);
        return { found: true, id: existing.id, blocked: true };
      });
    },
  };
}
