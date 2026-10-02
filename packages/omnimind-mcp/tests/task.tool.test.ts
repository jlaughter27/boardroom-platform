import { describe, it, expect, vi } from 'vitest';
import { taskUpsertTool, taskCompleteTool, taskBlockTool, taskListTool, taskStatusTool, isExactTaskMatch } from '../src/tools/task.tool';
import { ScopeDeniedError, McpValidationError } from '../src/types';
import type { OmniMindClient } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const MEM = { id: 'task-1', title: 'Build MCP', content: 'Task: Build MCP\nStatus: todo', domain: 'business', tags: ['task', 'task:todo'], importance: 0.6, sourceType: 'MCP_AGENT', tenantId: 'josh-business', createdAt: '', updatedAt: '' };
// M-102 regression: a SUPERSTRING title that the old `content ILIKE '%Task: Build MCP%'`
// lookup would have matched (and overwritten).
const SUPERSTRING = { ...MEM, id: 'task-2', title: 'Build MCP server', content: 'Task: Build MCP server\nStatus: in_progress', tags: ['task', 'task:in_progress'] };

function makeCtx(scopes = ['task:write', 'memory:read']): AgentContext {
  return { agentId: 'ag', agentName: 'ag', tenantId: 'josh-business', scopes, sourceWeight: 1.0 };
}

function makeClient(existing: Array<typeof MEM> = []): OmniMindClient {
  return {
    searchMemories: vi.fn().mockResolvedValue(existing),
    createMemory: vi.fn().mockResolvedValue({ id: 'task-new', status: 'created' }),
    updateMemory: vi.fn().mockResolvedValue({ ...MEM, content: 'updated' }),
    logAudit: vi.fn().mockResolvedValue(undefined),
  } as unknown as OmniMindClient;
}

describe('isExactTaskMatch', () => {
  it('matches exact title or exact "Task: <title>" first line only', () => {
    expect(isExactTaskMatch(MEM, 'Build MCP')).toBe(true);
    expect(isExactTaskMatch(MEM, '  Build MCP ')).toBe(true);
    expect(isExactTaskMatch(SUPERSTRING, 'Build MCP')).toBe(false);
    expect(isExactTaskMatch(MEM, 'Build')).toBe(false);
  });
});

describe('task_upsert', () => {
  it('creates task when none exists, searching by tag + exact title', async () => {
    const client = makeClient([]);
    const result = await taskUpsertTool(client, makeCtx()).execute({ title: 'Build MCP', userId: 'u' });
    expect(result.action).toBe('created');
    expect(client.searchMemories).toHaveBeenCalledWith(expect.objectContaining({ tags: ['task'], query: 'Build MCP', userId: 'u' }));
    expect(client.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Build MCP', tags: expect.arrayContaining(['task', 'task:todo']) }),
      'u'
    );
  });

  it('updates task when the exact title exists', async () => {
    const client = makeClient([MEM]);
    const result = await taskUpsertTool(client, makeCtx()).execute({ title: 'Build MCP', status: 'in_progress', userId: 'u' });
    expect(result.action).toBe('updated');
    expect(client.updateMemory).toHaveBeenCalledWith('task-1', expect.objectContaining({ tags: expect.arrayContaining(['task:in_progress']) }), 'u');
  });

  it('M-102: does NOT overwrite a task whose title is a superstring', async () => {
    const client = makeClient([SUPERSTRING]);
    const result = await taskUpsertTool(client, makeCtx()).execute({ title: 'Build MCP', userId: 'u' });
    expect(result.action).toBe('created');
    expect(client.updateMemory).not.toHaveBeenCalled();
  });

  it('M-107: reports action "updated" when the API auto-superseded a near-duplicate', async () => {
    const client = makeClient([]);
    vi.mocked(client.createMemory).mockResolvedValueOnce({ id: 'dupe-1', status: 'updated' });
    const result = await taskUpsertTool(client, makeCtx()).execute({ title: 'Build MCP', userId: 'u' });
    expect(result).toEqual({ id: 'dupe-1', action: 'updated' });
  });

  it('throws ScopeDeniedError for read-only agent', async () => {
    const client = makeClient();
    await expect(taskUpsertTool(client, makeCtx(['memory:read'])).execute({ title: 'x', userId: 'u' }))
      .rejects.toThrow(ScopeDeniedError);
  });

  it('M-109: throws McpValidationError (not raw ZodError) on bad input', async () => {
    const client = makeClient();
    await expect(taskUpsertTool(client, makeCtx()).execute({ title: '', userId: 'u' }))
      .rejects.toBeInstanceOf(McpValidationError);
  });
});

describe('task_complete', () => {
  it('marks task as done', async () => {
    const client = makeClient([MEM]);
    const result = await taskCompleteTool(client, makeCtx()).execute({ taskTitle: 'Build MCP', userId: 'u' });
    expect(result.completed).toBe(true);
    expect(client.updateMemory).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ content: expect.stringContaining('Status: done'), tags: expect.arrayContaining(['task', 'task:done']) }),
      'u'
    );
  });

  it('returns found:false when task not found', async () => {
    const client = makeClient([]);
    const result = await taskCompleteTool(client, makeCtx()).execute({ taskTitle: 'Nonexistent', userId: 'u' });
    expect(result.found).toBe(false);
  });

  it('M-102: superstring candidate is not completed', async () => {
    const client = makeClient([SUPERSTRING]);
    const result = await taskCompleteTool(client, makeCtx()).execute({ taskTitle: 'Build MCP', userId: 'u' });
    expect(result.found).toBe(false);
    expect(client.updateMemory).not.toHaveBeenCalled();
  });
});

describe('task_block', () => {
  it('marks task as blocked with description', async () => {
    const client = makeClient([MEM]);
    const result = await taskBlockTool(client, makeCtx()).execute({ taskTitle: 'Build MCP', blockerDescription: 'Waiting for API key', userId: 'u' });
    expect(result.blocked).toBe(true);
    expect(client.updateMemory).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ content: expect.stringContaining('Blocker: Waiting for API key'), tags: expect.arrayContaining(['task:blocked', 'blocker']) }),
      'u'
    );
  });
});

describe('task_list', () => {
  it('lists all tasks by tag', async () => {
    const client = makeClient([MEM]);
    const result = await taskListTool(client, makeCtx()).execute({ userId: 'u' });
    expect(result.tasks).toHaveLength(1);
    const params = vi.mocked(client.searchMemories).mock.calls[0][0];
    expect(params.tags).toEqual(['task']);
    expect(params.query).toBeUndefined();
  });

  it('M-102: filters by status via tags, not substring query', async () => {
    const client = makeClient([MEM]);
    await taskListTool(client, makeCtx()).execute({ userId: 'u', status: 'todo' });
    const params = vi.mocked(client.searchMemories).mock.calls[0][0];
    expect(params.tags).toEqual(['task', 'task:todo']);
    expect(params.query).toBeUndefined();
  });

  it('throws ScopeDeniedError', async () => {
    await expect(taskListTool(makeClient(), makeCtx([])).execute({ userId: 'u' }))
      .rejects.toThrow(ScopeDeniedError);
  });
});

describe('task_status', () => {
  it('returns status for found task', async () => {
    const client = makeClient([MEM]);
    const result = await taskStatusTool(client, makeCtx()).execute({ taskTitle: 'Build MCP', userId: 'u' });
    expect(result.found).toBe(true);
    expect(result.status).toBe('todo');
  });

  it('returns found:false for missing task', async () => {
    const result = await taskStatusTool(makeClient([]), makeCtx()).execute({ taskTitle: 'Ghost', userId: 'u' });
    expect(result.found).toBe(false);
  });
});
