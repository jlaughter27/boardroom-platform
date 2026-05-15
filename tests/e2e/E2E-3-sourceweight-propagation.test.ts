/**
 * E2E-3 — sourceWeight from env propagates all the way to the DB row.
 *
 * Catches Hermes Bug #3: a memory written by an agent with
 * OMNIMIND_MCP_SOURCE_WEIGHT=0.9 was landing with source_weight=0.85, because
 * the service layer was falling back to the static SOURCE_WEIGHTS table
 * (where MCP_AGENT = 0.85) instead of honoring the agent-context value.
 *
 * WS-1 made `agentContext.sourceWeight` win over the static lookup in
 * memory.service.ts (`agentContext?.sourceWeight ?? fallbackSourceWeight`).
 *
 * Pre-WS-1 behavior: source_weight = 0.85 (fallback for MCP_AGENT source type).
 * Post-WS-1 behavior: source_weight = whatever the agent's env says (0.9, 0.7, etc.).
 *
 * We test multiple distinct values so a regression that always returns a
 * single fallback (e.g., always 0.85) can't hide as a coincidental match.
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
} from './harness';

describe('E2E-3: sourceWeight env value lands on memory_entries.source_weight', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await setupHarness();
  }, 60_000);

  afterAll(async () => {
    await teardownHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness);
    await seedTestAgents(harness.prisma);
  });

  it('writes from a sourceWeight=1.0 agent get source_weight=1.0', async () => {
    const agent = getAgent('test-code'); // sourceWeight = 1.0
    expect(agent.sourceWeight).toBe(1.0);

    const mcp = await startMcpClient({ agent, apiBaseUrl: harness.config.apiBaseUrl });
    try {
      const marker = `E2E-3-CODE-${Date.now()}`;
      await mcp.callTool('memory_write', {
        userId: TEST_USER_ID,
        content: `Marker ${marker}`,
        domain: 'business',
        skipExtraction: true,
      });

      const rows = await findMemoriesByContentMarker(harness.prisma, marker);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sourceWeight).toBe(1.0);
    } finally {
      await mcp.close();
    }
  });

  it('writes from a sourceWeight=0.7 agent get source_weight=0.7 (not 0.85 fallback)', async () => {
    // This is the smoking gun for Bug #3. The MCP_AGENT static fallback is
    // 0.85; if we see 0.85 here, the seam is broken — the env value is being
    // ignored and the service is falling through to the static table.
    const agent = getAgent('test-cursor');
    expect(agent.sourceWeight).toBe(0.7);

    const mcp = await startMcpClient({ agent, apiBaseUrl: harness.config.apiBaseUrl });
    try {
      const marker = `E2E-3-CURSOR-${Date.now()}`;
      await mcp.callTool('memory_write', {
        userId: TEST_USER_ID,
        content: `Marker ${marker}`,
        domain: 'business',
        skipExtraction: true,
      });

      const rows = await findMemoriesByContentMarker(harness.prisma, marker);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sourceWeight).toBeCloseTo(0.7, 5);
      // The bug signature: anything close to 0.85 means we silently fell back
      // to the SOURCE_WEIGHTS[MCP_AGENT] lookup. Fail loudly if so.
      expect(Math.abs(rows[0]!.sourceWeight - 0.85)).toBeGreaterThan(0.01);
    } finally {
      await mcp.close();
    }
  });

  it('writes from a sourceWeight=0.85 agent still get 0.85 (positive control)', async () => {
    // Negative-control flipped: confirm the path WORKS when the env value
    // happens to equal the fallback. Otherwise a buggy impl returning the
    // fallback would still pass tests that only checked non-0.85 weights.
    const agent = getAgent('test-desktop'); // sourceWeight = 0.85
    expect(agent.sourceWeight).toBe(0.85);

    const mcp = await startMcpClient({ agent, apiBaseUrl: harness.config.apiBaseUrl });
    try {
      const marker = `E2E-3-DESKTOP-${Date.now()}`;
      await mcp.callTool('memory_write', {
        userId: TEST_USER_ID,
        content: `Marker ${marker}`,
        domain: 'personal',
        skipExtraction: true,
      });

      const rows = await findMemoriesByContentMarker(harness.prisma, marker);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sourceWeight).toBeCloseTo(0.85, 5);
    } finally {
      await mcp.close();
    }
  });
});
