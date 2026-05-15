/**
 * E2E-7 / D17 — Scope enforcement against a read-only agent.
 *
 * Background (WS-6 F-103):
 *   `requireScope(ctx, ...)` in `packages/omnimind-mcp/src/lib/namespace.ts`
 *   gates every tool call. The agent's scopes come from `OMNIMIND_MCP_SCOPES`
 *   env at spawn time. The defense bar is: an agent with ONLY `memory:read`
 *   in its scopes MUST NOT be able to invoke any write tool — every attempt
 *   must throw `ScopeDeniedError` (surfaced as MCP isError + structured payload).
 *
 *   This test ALSO covers F-103: it asserts that read-only tools (`task_status`,
 *   `task_list`, `project_status`, `project_summary`) succeed with just
 *   `memory:read`. Pre-WS-6 these tools required write scopes, which forced
 *   privilege creep on read-only agents.
 *
 * Scope wildcard test (`memory:*` granting `memory:read`) is in the unit tests
 * for `namespace.ts` — this E2E focuses on the cross-seam tool-side enforcement.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  setupHarness,
  teardownHarness,
  resetDatabase,
  startMcpClient,
  seedTestAgents,
  TEST_USER_ID,
  type Harness,
  type TestAgent,
  type McpHandle,
} from './harness';

// A read-only agent that should be allowed `memory:read` calls and nothing else.
const READ_ONLY_AGENT: TestAgent = {
  agentId: 'test-readonly-0.5',
  agentName: 'test-readonly-0.5',
  tenantId: 'josh-business',
  scopes: ['memory:read'],
  sourceWeight: 0.5,
  userId: TEST_USER_ID,
  apiKey: 'e2e-harness-api-key',
};

describe('E2E-7 / D17: read-only agent cannot invoke write tools, can invoke read tools', () => {
  let harness: Harness;
  let mcp: McpHandle;

  beforeAll(async () => {
    harness = await setupHarness();
  }, 60_000);

  afterAll(async () => {
    await teardownHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness);
    await seedTestAgents(harness.prisma);

    // Register the read-only agent so the agent-context fallback resolves it.
    const { createHash } = await import('node:crypto');
    await harness.prisma.agent.upsert({
      where: { name: READ_ONLY_AGENT.agentName },
      create: {
        id: READ_ONLY_AGENT.agentId,
        name: READ_ONLY_AGENT.agentName,
        apiKeyHash: createHash('sha256').update(READ_ONLY_AGENT.apiKey).digest('hex'),
        tenantId: READ_ONLY_AGENT.tenantId,
        scopes: READ_ONLY_AGENT.scopes,
        sourceWeight: READ_ONLY_AGENT.sourceWeight,
      },
      update: {
        scopes: READ_ONLY_AGENT.scopes,
        sourceWeight: READ_ONLY_AGENT.sourceWeight,
      },
    });

    mcp = await startMcpClient({
      agent: READ_ONLY_AGENT,
      apiBaseUrl: harness.config.apiBaseUrl,
    });
  });

  afterEach(async () => {
    if (mcp) await mcp.close();
  });

  // -------- write tools MUST be denied --------

  // Each call returns `isError: true` with a structured `SCOPE_DENIED` payload.
  // We use callToolRaw so we can inspect isError without the helper throwing.

  it('memory_write is denied (requires memory:write)', async () => {
    const result = await mcp.callToolRaw('memory_write', {
      content: 'should be blocked',
      userId: TEST_USER_ID,
      domain: 'business',
    });
    expect(result.isError).toBe(true);
    const text = JSON.stringify(result.parsed ?? result.content);
    expect(text).toMatch(/scope|SCOPE_DENIED|memory:write/i);
  });

  it('memory_supersede is denied (requires memory:write)', async () => {
    const result = await mcp.callToolRaw('memory_supersede', {
      id: 'any-id',
      newContent: 'should be blocked',
      userId: TEST_USER_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('decision_log is denied (requires decision:write)', async () => {
    const result = await mcp.callToolRaw('decision_log', {
      title: 'attempted decision',
      decision: 'should fail',
      rationale: 'no rationale',
      userId: TEST_USER_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('task_upsert is denied (requires task:write)', async () => {
    const result = await mcp.callToolRaw('task_upsert', {
      title: 'attempted task',
      userId: TEST_USER_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('task_complete is denied (requires task:write)', async () => {
    const result = await mcp.callToolRaw('task_complete', {
      taskTitle: 'any task',
      userId: TEST_USER_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('task_block is denied (requires task:write)', async () => {
    const result = await mcp.callToolRaw('task_block', {
      taskTitle: 'any task',
      reason: 'attempted',
      userId: TEST_USER_ID,
    });
    expect(result.isError).toBe(true);
  });

  it('commitment_log is denied (requires commitment:write)', async () => {
    const result = await mcp.callToolRaw('commitment_log', {
      personName: 'someone',
      commitment: 'attempted',
      userId: TEST_USER_ID,
    });
    expect(result.isError).toBe(true);
  });

  // -------- read tools MUST be allowed --------
  //
  // Pre-WS-6 these tools required write scopes (F-103). The fix changed them
  // to require `memory:read` so a read-only agent can use them.

  it('memory_search is permitted (requires memory:read)', async () => {
    const result = await mcp.callToolRaw('memory_search', {
      query: 'anything',
      userId: TEST_USER_ID,
      limit: 1,
    });
    expect(result.isError).toBe(false);
  });

  it('task_status is permitted with only memory:read (WS-6 F-103 fix)', async () => {
    const result = await mcp.callToolRaw('task_status', {
      taskTitle: 'any task',
      userId: TEST_USER_ID,
    });
    expect(result.isError).toBe(false);
  });

  it('task_list is permitted with only memory:read (WS-6 F-103 fix)', async () => {
    const result = await mcp.callToolRaw('task_list', {
      userId: TEST_USER_ID,
      limit: 5,
    });
    expect(result.isError).toBe(false);
  });

  it('project_status is permitted with only memory:read (WS-6 F-103 fix)', async () => {
    const result = await mcp.callToolRaw('project_status', {
      projectName: 'any project',
      userId: TEST_USER_ID,
    });
    expect(result.isError).toBe(false);
  });

  it('project_summary is permitted with only memory:read (WS-6 F-103 fix)', async () => {
    const result = await mcp.callToolRaw('project_summary', {
      projectName: 'any project',
      userId: TEST_USER_ID,
    });
    expect(result.isError).toBe(false);
  });
});
