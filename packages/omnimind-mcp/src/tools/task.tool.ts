import { z } from 'zod';
import {
  McpCursorSchema,
  McpTaskUpsertOutputSchema,
  McpTaskStatusOutputSchema,
  McpTaskListOutputSchema,
  McpTaskCompleteOutputSchema,
  McpTaskBlockOutputSchema,
} from '@boardroom/shared';
import { requireScope } from '../lib/namespace';
import { withAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import { MAX_PAGE_SIZE, decodeCursor, pageOf } from '../lib/cursor';
import { IdempotencyKeyInput } from './memory.tool';
import type { OmniMindClient, MemoryRecord } from '../lib/client';
import { IDEMPOTENT_WRITE_ANNOTATIONS, READ_ONLY_ANNOTATIONS } from '../types';
import type { AgentContext, McpTool } from '../types';

/**
 * Task memories are plain memories tagged `task` + `task:<status>`
 * (+ `project:<ref>`), with `memory.title === <task title>` and content whose
 * first line is `Task: <title>`. Every lookup here goes through tags (M-102)
 * and matches the title EXACTLY — never a substring — so upserting
 * "Fix login" can never overwrite "Fix login page".
 */
export const TASK_TAG = 'task';
export const TASK_TITLE_PREFIX = 'Task: ';
const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

export function taskStatusTag(status: TaskStatus): string {
  return `${TASK_TAG}:${status}`;
}

export function isExactTaskMatch(mem: Pick<MemoryRecord, 'title' | 'content'>, title: string): boolean {
  const want = title.trim();
  if (mem.title === want) return true;
  const firstLine = (mem.content ?? '').split('\n', 1)[0];
  return firstLine === `${TASK_TITLE_PREFIX}${want}`;
}

export async function findTaskByExactTitle(
  client: OmniMindClient,
  ctx: AgentContext,
  userId: string,
  title: string
): Promise<MemoryRecord | null> {
  // Candidates: tagged `task` AND containing the title as a substring; then
  // exact-match client-side (newest first, as the API orders by createdAt desc).
  const candidates = await client.searchMemories({
    tags: [TASK_TAG],
    query: title.trim(),
    tenantId: ctx.tenantId,
    userId,
    limit: 20,
  });
  return candidates.find(m => isExactTaskMatch(m, title)) ?? null;
}

const TaskUpsertInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().default(''),
  status: z.enum(TASK_STATUSES).default('todo'),
  userId: z.string(),
  projectRef: z.string().optional().describe('Project name or ID this task belongs to'),
  tags: z.array(z.string()).default([]),
  dueDate: z.string().optional().describe('ISO date string'),
  idempotencyKey: IdempotencyKeyInput,
});

const TaskStatusInput = z.object({
  taskTitle: z.string().min(1).describe('Task title to look up (exact match)'),
  userId: z.string(),
});

const TaskListInput = z.object({
  userId: z.string(),
  status: z.enum([...TASK_STATUSES, 'all']).default('all'),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(10).describe('Page size (max 20)'),
  cursor: McpCursorSchema.optional().describe('Opaque cursor from a previous page (`nextCursor`)'),
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
    title: 'Upsert task',
    description: 'Create or update a task in the shared store (matched by exact title). Writes to memory with task metadata. Pass idempotencyKey to make retries safe.',
    inputSchema: TaskUpsertInput,
    outputSchema: McpTaskUpsertOutputSchema,
    annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'task:write');
      const input = parseInput(TaskUpsertInput, raw);

      return withAudit(client, ctx, 'task_upsert', input, async () => {
        const writeOpts = input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined;
        const title = input.title.trim();
        const content = [
          `${TASK_TITLE_PREFIX}${title}`,
          input.description && `Description: ${input.description}`,
          `Status: ${input.status}`,
          input.projectRef && `Project: ${input.projectRef}`,
          input.dueDate && `Due: ${input.dueDate}`,
        ].filter(Boolean).join('\n');

        const tags = [...input.tags, TASK_TAG, taskStatusTag(input.status)];
        if (input.projectRef) tags.push(`project:${input.projectRef}`);

        const existing = await findTaskByExactTitle(client, ctx, input.userId, title);

        if (existing) {
          const mem = await client.updateMemory(existing.id, {
            title,
            content,
            tags,
            sourceType: 'MCP_AGENT',
            agentId: ctx.agentId,
          }, input.userId, writeOpts);
          return { id: mem.id, action: 'updated' as const };
        }

        const created = await client.createMemory({
          title,
          content,
          domain: 'business',
          tags,
          importance: 0.6,
          sourceType: 'MCP_AGENT',
          agentId: ctx.agentId,
          tenantId: ctx.tenantId,
          sourceWeight: ctx.sourceWeight,
        }, input.userId, writeOpts);
        // M-107: the API may have auto-superseded a near-duplicate → 'updated'.
        return { id: created.id, action: created.status };
      });
    },
  } satisfies McpTool;
}

export function taskStatusTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'task_status',
    title: 'Task status',
    description: 'Look up the current status of a task (exact title match).',
    inputSchema: TaskStatusInput,
    outputSchema: McpTaskStatusOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async execute(raw: unknown) {
      // WS-6 F-103 — read-only tool requires read scope, not write.
      requireScope(ctx, 'memory:read');
      const input = parseInput(TaskStatusInput, raw);

      return withAudit(client, ctx, 'task_status', input, async () => {
        const mem = await findTaskByExactTitle(client, ctx, input.userId, input.taskTitle);
        if (!mem) return { found: false as const };
        const statusMatch = mem.content.match(/Status: (\S+)/);
        return {
          found: true as const,
          id: mem.id,
          title: mem.title,
          status: statusMatch?.[1] ?? 'unknown',
          content: mem.content,
        };
      });
    },
  } satisfies McpTool;
}

export function taskListTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'task_list',
    title: 'List tasks',
    description: 'List tasks, optionally filtered by status. Paginated: pass `cursor` from `nextCursor` for the next page (max 20 per page).',
    inputSchema: TaskListInput,
    outputSchema: McpTaskListOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async execute(raw: unknown) {
      // WS-6 F-103 — read-only tool requires read scope, not write.
      requireScope(ctx, 'memory:read');
      const input = parseInput(TaskListInput, raw);

      return withAudit(client, ctx, 'task_list', input, async () => {
        const tags = input.status === 'all' ? [TASK_TAG] : [TASK_TAG, taskStatusTag(input.status)];
        const offset = decodeCursor(input.cursor);
        // Offset cursor over GET /memories: ask for one extra row to learn
        // whether a further page exists without a second round-trip.
        const results = await client.searchMemories({
          tags,
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: input.limit + 1,
          offset,
        });
        const { items, nextCursor } = pageOf(results, offset, input.limit);
        return { tasks: items, count: items.length, nextCursor };
      });
    },
  } satisfies McpTool;
}

export function taskCompleteTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'task_complete',
    title: 'Complete task',
    description: 'Mark a task as done (exact title match).',
    inputSchema: TaskCompleteInput,
    outputSchema: McpTaskCompleteOutputSchema,
    annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'task:write');
      const input = parseInput(TaskCompleteInput, raw);

      return withAudit(client, ctx, 'task_complete', input, async () => {
        const existing = await findTaskByExactTitle(client, ctx, input.userId, input.taskTitle);
        if (!existing) return { found: false as const };

        const updatedContent = existing.content
          .replace(/Status: \S+/, 'Status: done')
          + (input.outcome ? `\nOutcome: ${input.outcome}` : '');

        await client.updateMemory(existing.id, {
          content: updatedContent,
          tags: [...existing.tags.filter(t => !t.startsWith(`${TASK_TAG}:`)), TASK_TAG, taskStatusTag('done')],
          agentId: ctx.agentId,
        }, input.userId);
        return { found: true as const, id: existing.id, completed: true };
      });
    },
  } satisfies McpTool;
}

export function taskBlockTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'task_block',
    title: 'Block task',
    description: 'Mark a task as blocked and record the blocker (exact title match).',
    inputSchema: TaskBlockInput,
    outputSchema: McpTaskBlockOutputSchema,
    annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'task:write');
      const input = parseInput(TaskBlockInput, raw);

      return withAudit(client, ctx, 'task_block', input, async () => {
        const existing = await findTaskByExactTitle(client, ctx, input.userId, input.taskTitle);
        if (!existing) return { found: false as const };

        const updatedContent = existing.content
          .replace(/Status: \S+/, 'Status: blocked')
          + `\nBlocker: ${input.blockerDescription}`;

        await client.updateMemory(existing.id, {
          content: updatedContent,
          tags: [...existing.tags.filter(t => !t.startsWith(`${TASK_TAG}:`)), TASK_TAG, taskStatusTag('blocked'), 'blocker'],
          agentId: ctx.agentId,
        }, input.userId);
        return { found: true as const, id: existing.id, blocked: true };
      });
    },
  } satisfies McpTool;
}
