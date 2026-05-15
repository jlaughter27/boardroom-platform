/**
 * Test fixtures for distinct agents with varying scopes / tenants / weights.
 *
 * Why fixtures (not random): the 4 Hermes bugs all hinge on attribution.
 * Distinct, named agents with KNOWN sourceWeights make the assertions
 * unambiguous — if the DB row has sourceWeight 0.9, we know it came from
 * `test-code-1.0` only when its env had sourceWeight=0.9. (Yes, that's
 * intentional: the agent's name embeds its weight so test failures point
 * straight at the misconfiguration.)
 *
 * We register agents two ways:
 *   1. As DB rows (`agents` table) so the API-key fallback path resolves them
 *   2. As MCP env-var bundles passed to `startMcpClient()`
 *
 * The MCP server reads `OMNIMIND_MCP_*` env on startup and attaches headers
 * to every outbound request. The fallback DB lookup is a belt-and-braces
 * second layer in case headers go missing.
 */

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export interface TestAgent {
  /** Unique agent identifier — matches the agent_id column in memory_entries. */
  agentId: string;
  /** Human-readable name (same as agentId for simplicity in tests). */
  agentName: string;
  tenantId: string;
  scopes: string[];
  sourceWeight: number;
  /**
   * Userid this agent writes for. In production a single agent writes for one
   * user; for cross-tenant tests we use the SAME userId across tenants so the
   * test is unambiguously checking tenant isolation, not user isolation.
   */
  userId: string;
  /**
   * Raw API key the MCP client uses for x-api-key. The server-side check is
   * against `process.env.OMNIMIND_API_KEY`, which is shared — but each agent
   * still has its own `apiKeyHash` row in the agents table so the agent-context
   * middleware's fallback lookup resolves correctly.
   */
  apiKey: string;
}

const SHARED_API_KEY = 'e2e-harness-api-key';

/**
 * The default test user ID. We pre-create this user in the test DB so all
 * memory writes have a valid `user_id` FK target. Same id across all agents
 * to keep tenant-isolation tests clean.
 */
export const TEST_USER_ID = 'test-user-e2e';
export const TEST_USER_EMAIL = 'e2e@test.local';

const AGENT_PRESETS: Record<string, Omit<TestAgent, 'apiKey' | 'userId'>> = {
  'test-code': {
    agentId: 'test-code-1.0',
    agentName: 'test-code-1.0',
    tenantId: 'josh-business',
    scopes: ['memory:read', 'memory:write', 'decision:write', 'task:write'],
    sourceWeight: 1.0,
  },
  'test-desktop': {
    agentId: 'test-desktop-0.85',
    agentName: 'test-desktop-0.85',
    tenantId: 'josh-personal',
    scopes: ['memory:read', 'memory:write'],
    sourceWeight: 0.85,
  },
  'test-cursor': {
    agentId: 'test-cursor-0.7',
    agentName: 'test-cursor-0.7',
    tenantId: 'josh-business',
    scopes: ['memory:read', 'memory:write'],
    sourceWeight: 0.7,
  },
  /**
   * Same tenant as test-code but different agent id — used to test that two
   * agents in the same tenant can read each other's writes.
   */
  'test-second-code': {
    agentId: 'test-second-code-0.9',
    agentName: 'test-second-code-0.9',
    tenantId: 'josh-business',
    scopes: ['memory:read', 'memory:write'],
    sourceWeight: 0.9,
  },
};

export function getAgent(name: keyof typeof AGENT_PRESETS): TestAgent {
  const preset = AGENT_PRESETS[name];
  if (!preset) throw new Error(`Unknown test agent preset: ${name}`);
  return {
    ...preset,
    userId: TEST_USER_ID,
    apiKey: SHARED_API_KEY,
  };
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Pre-create the test user row + an `agents` row for each preset.
 *
 * Why upsert: tests reset the DB between cases (TRUNCATE … CASCADE) so this
 * function gets called once per test in `beforeEach`. Upsert keeps it idempotent
 * even if the truncate didn't catch this row for some reason.
 */
export async function seedTestAgents(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    create: {
      id: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      passwordHash: 'unused-in-tests',
      name: 'E2E Test User',
    },
    update: {},
  });

  for (const presetKey of Object.keys(AGENT_PRESETS)) {
    const a = getAgent(presetKey as keyof typeof AGENT_PRESETS);
    await prisma.agent.upsert({
      where: { name: a.agentName },
      create: {
        id: a.agentId,
        name: a.agentName,
        apiKeyHash: hashApiKey(a.apiKey),
        tenantId: a.tenantId,
        scopes: a.scopes,
        sourceWeight: a.sourceWeight,
      },
      update: {
        tenantId: a.tenantId,
        scopes: a.scopes,
        sourceWeight: a.sourceWeight,
      },
    });
  }
}

export const TEST_AGENTS = AGENT_PRESETS;
