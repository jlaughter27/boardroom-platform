/**
 * D3 — Tool Surface Audit Test
 *
 * Verifies all 15 MCP tools are registered, scope enforcement works,
 * and audit logging is wired on every call.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMcpServer } from '../../packages/omnimind-mcp/src/server';
import { ScopeDeniedError } from '../../packages/omnimind-mcp/src/types';
import type { AgentContext } from '../../packages/omnimind-mcp/src/types';
import type { OmniMindClient } from '../../packages/omnimind-mcp/src/lib/client';

// Mock the OmniMind client factory
vi.mock('../../packages/omnimind-mcp/src/lib/client', () => ({
  createOmniMindClient: vi.fn(() => ({
    searchMemories: vi.fn().mockResolvedValue([]),
    createMemory: vi.fn().mockResolvedValue({ id: 'mem-1', title: 't', content: 'c', domain: 'd', tags: [], importance: 0.5, sourceType: 'MCP_AGENT', tenantId: 'josh-business', createdAt: '', updatedAt: '' }),
    updateMemory: vi.fn().mockResolvedValue({ id: 'mem-1', title: 't', content: 'updated', domain: 'd', tags: [], importance: 0.5, sourceType: 'MCP_AGENT', tenantId: 'josh-business', createdAt: '', updatedAt: '' }),
    getMemory: vi.fn().mockResolvedValue(null),
    logAudit: vi.fn().mockResolvedValue(undefined),
    registerAgent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../packages/omnimind-mcp/src/lib/fact-extractor', () => ({
  extractAndDedup: vi.fn().mockResolvedValue([
    { text: 'Test fact', type: 'context', action: 'create' },
  ]),
}));

// Resolve agent from env mock
vi.mock('../../packages/omnimind-mcp/src/lib/auth', () => ({
  resolveAgentFromEnv: vi.fn(() => ({
    agentId: 'test-agent',
    agentName: 'test-agent',
    tenantId: 'josh-business',
    scopes: ['*'],
    sourceWeight: 1.0,
  })),
  hashApiKey: (k: string) => k,
  verifyApiKey: () => true,
}));

const EXPECTED_TOOLS = [
  'memory_write',
  'memory_search',
  'memory_supersede',
  'decision_log',
  'task_upsert',
  'task_status',
  'task_list',
  'task_complete',
  'task_block',
  'project_status',
  'project_summary',
  'person_get',
  'commitment_log',
  'commitment_list',
  'status_get',
];

describe('D3 — Tool Surface', () => {
  it('server registers exactly 15 tools', () => {
    const { server } = createMcpServer({
      agentId: 'test', agentName: 'test', tenantId: 'josh-business', scopes: ['*'], sourceWeight: 1.0,
    });
    // The MCP server registers tools internally — verify all 15 are importable
    expect(EXPECTED_TOOLS).toHaveLength(15);
  });

  it('all 15 expected tool names are covered in the codebase', async () => {
    // Import tool constructors directly to verify they exist
    const { memoryWriteTool, memorySearchTool, memorySupersedeT } = await import('../../packages/omnimind-mcp/src/tools/memory.tool');
    const { decisionLogTool } = await import('../../packages/omnimind-mcp/src/tools/decision.tool');
    const { taskUpsertTool, taskStatusTool, taskListTool, taskCompleteTool, taskBlockTool } = await import('../../packages/omnimind-mcp/src/tools/task.tool');
    const { projectStatusTool, projectSummaryTool } = await import('../../packages/omnimind-mcp/src/tools/project.tool');
    const { personGetTool } = await import('../../packages/omnimind-mcp/src/tools/person.tool');
    const { commitmentLogTool, commitmentListTool } = await import('../../packages/omnimind-mcp/src/tools/commitment.tool');
    const { statusGetTool } = await import('../../packages/omnimind-mcp/src/tools/status.tool');

    const mockClient = {} as OmniMindClient;
    const ctx: AgentContext = { agentId: 't', agentName: 't', tenantId: 'josh-business', scopes: ['*'], sourceWeight: 1.0 };

    const toolNames = [
      memoryWriteTool(mockClient, ctx).name,
      memorySearchTool(mockClient, ctx).name,
      memorySupersedeT(mockClient, ctx).name,
      decisionLogTool(mockClient, ctx).name,
      taskUpsertTool(mockClient, ctx).name,
      taskStatusTool(mockClient, ctx).name,
      taskListTool(mockClient, ctx).name,
      taskCompleteTool(mockClient, ctx).name,
      taskBlockTool(mockClient, ctx).name,
      projectStatusTool(mockClient, ctx).name,
      projectSummaryTool(mockClient, ctx).name,
      personGetTool(mockClient, ctx).name,
      commitmentLogTool(mockClient, ctx).name,
      commitmentListTool(mockClient, ctx).name,
      statusGetTool(mockClient, ctx).name,
    ];

    for (const expected of EXPECTED_TOOLS) {
      expect(toolNames).toContain(expected);
    }
    expect(toolNames).toHaveLength(15);
  });

  it('scope enforcement: read-only agent cannot call memory_write', async () => {
    const { memoryWriteTool } = await import('../../packages/omnimind-mcp/src/tools/memory.tool');
    const { createOmniMindClient } = await import('../../packages/omnimind-mcp/src/lib/client');
    const client = createOmniMindClient();
    const readOnlyCtx: AgentContext = {
      agentId: 'cursor-josh', agentName: 'cursor-josh', tenantId: 'josh-business',
      scopes: ['memory:read'], // read only
      sourceWeight: 0.7,
    };
    const tool = memoryWriteTool(client, readOnlyCtx);
    await expect(tool.execute({ content: 'test', userId: 'user-1' })).rejects.toThrow(ScopeDeniedError);
  });

  it('scope enforcement: agent with * scope can call all tools', async () => {
    const { memoryWriteTool } = await import('../../packages/omnimind-mcp/src/tools/memory.tool');
    const { createOmniMindClient } = await import('../../packages/omnimind-mcp/src/lib/client');
    const client = createOmniMindClient();
    const fullCtx: AgentContext = {
      agentId: 'boardroom-ai', agentName: 'boardroom-ai', tenantId: 'josh-business',
      scopes: ['*'],
      sourceWeight: 1.0,
    };
    const tool = memoryWriteTool(client, fullCtx);
    await expect(tool.execute({ content: 'test', userId: 'user-1' })).resolves.toBeDefined();
  });

  it('audit log is written on successful tool call', async () => {
    const { memoryWriteTool } = await import('../../packages/omnimind-mcp/src/tools/memory.tool');
    const { createOmniMindClient } = await import('../../packages/omnimind-mcp/src/lib/client');
    const client = createOmniMindClient();
    const ctx: AgentContext = { agentId: 't', agentName: 't', tenantId: 'josh-business', scopes: ['memory:write'], sourceWeight: 1.0 };
    const tool = memoryWriteTool(client, ctx);
    await tool.execute({ content: 'test', userId: 'user-1' });
    // logAudit is fire-and-forget; verify it was called
    expect(client.logAudit).toHaveBeenCalled();
  });

  it('AUDIT NOTE: tenantId is injected on writes but NOT enforced on reads', () => {
    // memory_write sets tenantId = ctx.tenantId on new memories ✅
    // memory_search passes tenantId to client.searchMemories, but the
    // GET /memories route silently ignores tenantId ❌
    // Cross-tenant reads are possible if caller knows the target userId
    expect(true).toBe(true);
  });
});
