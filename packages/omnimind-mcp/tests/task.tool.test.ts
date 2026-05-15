import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskUpsertTool, taskCompleteTool, taskBlockTool, taskListTool, taskStatusTool } from '../src/tools/task.tool';
import { ScopeDeniedError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const MEM = { id: 'task-1', title: 'Build MCP', content: 'Task: Build MCP\nStatus: todo', domain: 'business', tags: ['task', 'task:todo'], importance: 0.6, sourceType: 'MCP_AGENT', tenantId: 'josh-business', createdAt: '', updatedAt: '' };

function makeCtx(scopes = ['task:write', 'memory:read']): AgentContext {
  return { agentId: 'ag', agentName: 'ag', tenantId: 'josh-business', scopes, sourceWeight: 1.0 };
}

function makeClient(existing: typeof MEM | null = null): OmniMindClient {
  return {
    searchMemories: vi.fn().mockResolvedValue(existing ? [existing] : []),
    createMemory: vi.fn().mockResolvedValue(MEM),
    updateMemory: vi.fn().mockResolvedValue({ ...MEM, content: 'updated' }),
    logAudit: vi.fn().mockResolvedValue(undefined),
  } as unknown as OmniMindClient;
}

describe('task_upsert', () => {
  it('creates task when none exists', async () => {
    const client = makeClient(null);
    const result = await taskUpsertTool(client, makeCtx()).execute({ title: 'Build MCP', userId: 'u' });
    expect(result.action).toBe('created');
  });

  it('updates task when one exists', async () => {
    const client = makeClient(MEM);
    const result = await taskUpsertTool(client, makeCtx()).execute({ title: 'Build MCP', status: 'in_progress', userId: 'u' });
    expect(result.action).toBe('updated');
  });

  it('throws ScopeDeniedError for read-only agent', async () => {
    const client = makeClient();
    await expect(taskUpsertTool(client, makeCtx(['memory:read'])).execute({ title: 'x', userId: 'u' }))
      .rejects.toThrow(ScopeDeniedError);
  });
});

describe('task_complete', () => {
  it('marks task as done', async () => {
    const client = makeClient(MEM);
    const result = await taskCompleteTool(client, makeCtx()).execute({ taskTitle: 'Build MCP', userId: 'u' });
    expect(result.completed).toBe(true);
    expect(client.updateMemory).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ content: expect.stringContaining('Status: done') }),
      'u'
    );
  });

  it('returns found:false when task not found', async () => {
    const client = makeClient(null);
    const result = await taskCompleteTool(client, makeCtx()).execute({ taskTitle: 'Nonexistent', userId: 'u' });
    expect(result.found).toBe(false);
  });
});

describe('task_block', () => {
  it('marks task as blocked with description', async () => {
    const client = makeClient(MEM);
    const result = await taskBlockTool(client, makeCtx()).execute({ taskTitle: 'Build MCP', blockerDescription: 'Waiting for API key', userId: 'u' });
    expect(result.blocked).toBe(true);
    expect(client.updateMemory).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ content: expect.stringContaining('Blocker: Waiting for API key') }),
      'u'
    );
  });
});

describe('task_list', () => {
  it('returns task list', async () => {
    const client = makeClient(MEM);
    const result = await taskListTool(client, makeCtx()).execute({ userId: 'u' });
    expect(result.tasks).toHaveLength(1);
  });

  it('throws ScopeDeniedError', async () => {
    await expect(taskListTool(makeClient(), makeCtx([])).execute({ userId: 'u' }))
      .rejects.toThrow(ScopeDeniedError);
  });
});

describe('task_status', () => {
  it('returns status for found task', async () => {
    const client = makeClient(MEM);
    const result = await taskStatusTool(client, makeCtx()).execute({ taskTitle: 'Build MCP', userId: 'u' });
    expect(result.found).toBe(true);
    expect(result.status).toBe('todo');
  });

  it('returns found:false for missing task', async () => {
    const result = await taskStatusTool(makeClient(null), makeCtx()).execute({ taskTitle: 'Ghost', userId: 'u' });
    expect(result.found).toBe(false);
  });
});
