/**
 * E2E-1 — Agent attribution propagates from MCP env → header → DB column.
 *
 * Catches Hermes Bug #1: agent_id was NULL after MCP writes because the
 * x-agent-id header wasn't being read by the API middleware. WS-1 added
 * the agent-context middleware and threaded agentContext through every
 * service call; WS-4 made agent_id NOT NULL with a 'legacy' DB default and
 * a 'boardroom-ai' service-layer default for non-MCP callers.
 *
 * Pre-WS-1 behavior: agent_id would be NULL (or the schema default after WS-4).
 * Post-WS-1 behavior: agent_id matches the OMNIMIND_MCP_AGENT_NAME env var
 *                     of the spawned MCP server.
 *
 * The 'legacy' DB default is the test's discriminator: a passing test sees the
 * configured 'test-code-1.0', a regression sees 'legacy' (or NULL on a
 * pre-WS-4 schema).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupHarness,
  teardownHarness,
  resetDatabase,
  startMcpClient,
  seedTestAgents,
  getAgent,
  TEST_USER_ID,
  findMemoriesByContentMarker,
  type Harness,
  type McpHandle,
} from './harness';

describe('E2E-1: Agent ID attribution flows from MCP env to memory_entries.agent_id', () => {
  let harness: Harness;
  let mcp: McpHandle;

  beforeAll(async () => {
    harness = await setupHarness();
  }, 60_000);

  afterAll(async () => {
    if (mcp) await mcp.close();
    await teardownHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness);
    await seedTestAgents(harness.prisma);
  });

  it('writes memory with agent_id = OMNIMIND_MCP_AGENT_NAME env value', async () => {
    const agent = getAgent('test-code');
    mcp = await startMcpClient({
      agent,
      apiBaseUrl: harness.config.apiBaseUrl,
    });

    const marker = `E2E-1-${Date.now()}`;
    const writeResult = await mcp.callTool<{ created: string[]; updated: string[] }>(
      'memory_write',
      {
        userId: TEST_USER_ID,
        content: `Marker ${marker}: write to verify agent_id attribution end-to-end`,
        domain: 'business',
        tags: ['e2e-1'],
        importance: 0.5,
        skipExtraction: true, // we want one row, not whatever the extractor decides
      }
    );

    expect(writeResult.created).toHaveLength(1);

    // Now assert against the DB row directly — not the MCP response.
    // The whole point of the test is that the seam carries identity through.
    const rows = await findMemoriesByContentMarker(harness.prisma, marker);
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.agentId).toBe(agent.agentId);
    // Belt-and-braces: ensure we DIDN'T fall through to the schema default
    // (which would mask the regression we're trying to catch).
    expect(row.agentId).not.toBe('legacy');
    expect(row.agentId).not.toBe('boardroom-ai');
  });

  it('distinguishes between two different agents writing to the same tenant', async () => {
    // Write from agent A, then from agent B (same tenant). Each row should
    // carry its OWN agent_id — not collide on the most-recently-started
    // MCP server, not fall through to a shared default.
    const agentA = getAgent('test-code');
    const agentB = getAgent('test-second-code');

    const mcpA = await startMcpClient({ agent: agentA, apiBaseUrl: harness.config.apiBaseUrl });
    try {
      const markerA = `E2E-1A-${Date.now()}`;
      await mcpA.callTool('memory_write', {
        userId: TEST_USER_ID,
        content: `Marker ${markerA}: from agent A`,
        domain: 'business',
        skipExtraction: true,
      });

      const rowsA = await findMemoriesByContentMarker(harness.prisma, markerA);
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0]!.agentId).toBe(agentA.agentId);
    } finally {
      await mcpA.close();
    }

    const mcpB = await startMcpClient({ agent: agentB, apiBaseUrl: harness.config.apiBaseUrl });
    try {
      const markerB = `E2E-1B-${Date.now()}`;
      await mcpB.callTool('memory_write', {
        userId: TEST_USER_ID,
        content: `Marker ${markerB}: from agent B`,
        domain: 'business',
        skipExtraction: true,
      });

      const rowsB = await findMemoriesByContentMarker(harness.prisma, markerB);
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0]!.agentId).toBe(agentB.agentId);
      expect(rowsB[0]!.agentId).not.toBe(agentA.agentId);
    } finally {
      await mcpB.close();
    }
  });
});
