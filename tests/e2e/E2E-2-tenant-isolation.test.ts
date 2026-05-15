/**
 * E2E-2 — Cross-tenant reads return zero results.
 *
 * Catches Hermes Bug #2: an MCP agent in tenant A could `memory_search` and
 * see results from tenant B because the retrieval layer wasn't filtering by
 * tenant. WS-1.5 added tenant filters to semantic/fulltext/trigram/structured
 * search paths, plus to the search-similar route.
 *
 * Pre-WS-1 behavior: agent in tenant B sees agent A's memory in search results.
 * Post-WS-1 behavior: agent in tenant B sees zero of agent A's writes.
 *
 * Implementation notes:
 *   - We use `memory_write` via MCP for the WRITE side (exercises agent-context
 *     headers, the service layer's tenant assignment, and the full wire path).
 *   - We use the OmniMind HTTP API DIRECTLY for the SEARCH side. Why: there's
 *     a pre-existing wire-shape mismatch between the API search response
 *     (`{items: [...]}`) and the MCP client's expectation (`{memories: [...]}`)
 *     in packages/omnimind-mcp/src/lib/client.ts:searchMemories. That makes
 *     memory_search-via-MCP always return empty, which would let this test
 *     pass trivially — it can't tell "no leak" apart from "no read at all."
 *     Filed as a follow-up; calling the API directly proves the tenant filter
 *     in the retrieval layer is actually working.
 *
 * Same user_id across both agents — the only thing protecting the data is
 * tenant_id. This is the exact failure mode of Bug #2 and exactly what we're
 * defending against.
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
  countMemoriesByTenant,
  type Harness,
  type TestAgent,
} from './harness';

interface ApiSearchResponse {
  items: Array<{ id: string; content: string; tenantId: string }>;
  total: number;
}

/**
 * Hit `GET /memories?q=...` directly, attributing the request to the given
 * test agent via headers. This is the path the agent-context middleware and
 * the retrieval layer's tenant filter both run on, so it's a faithful
 * proxy for what the MCP tool WOULD see if the wire-shape bug were fixed.
 */
async function apiSearchAsAgent(
  baseUrl: string,
  apiKey: string,
  agent: TestAgent,
  query: string
): Promise<ApiSearchResponse> {
  const url = new URL(`${baseUrl}/memories`);
  url.searchParams.set('q', query);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-user-id': TEST_USER_ID,
      'x-agent-id': agent.agentId,
      'x-tenant-id': agent.tenantId,
      'x-source-weight': String(agent.sourceWeight),
    },
  });
  if (!res.ok) {
    throw new Error(`GET /memories failed: ${res.status} — ${await res.text()}`);
  }
  return (await res.json()) as ApiSearchResponse;
}

describe('E2E-2: Cross-tenant search returns zero results', () => {
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

  it('agent in tenant B cannot see writes from tenant A', async () => {
    const businessAgent = getAgent('test-code'); // tenant: josh-business
    const personalAgent = getAgent('test-desktop'); // tenant: josh-personal

    // Sanity check the fixtures — if these change, the test stops covering
    // tenant isolation specifically.
    expect(businessAgent.tenantId).toBe('josh-business');
    expect(personalAgent.tenantId).toBe('josh-personal');
    expect(businessAgent.userId).toBe(personalAgent.userId);

    const businessSecret = `E2E-2-BUSINESS-SECRET-${Date.now()}`;

    // 1. Business agent writes a uniquely-marked memory via MCP.
    const businessMcp = await startMcpClient({
      agent: businessAgent,
      apiBaseUrl: harness.config.apiBaseUrl,
    });
    try {
      await businessMcp.callTool('memory_write', {
        userId: TEST_USER_ID,
        content: `Confidential: ${businessSecret}. Q3 revenue plan, not for personal context.`,
        domain: 'business',
        skipExtraction: true,
      });
    } finally {
      await businessMcp.close();
    }

    // 2. Confirm the write actually landed in the business tenant — this is
    //    the positive control. If THIS fails, the write seam is broken (Bug #1
    //    or Bug #2 writeside) and the leak check below is meaningless.
    const businessRows = await findMemoriesByContentMarker(harness.prisma, businessSecret);
    expect(businessRows).toHaveLength(1);
    expect(businessRows[0]!.tenantId).toBe('josh-business');
    expect(await countMemoriesByTenant(harness.prisma, 'josh-business')).toBe(1);
    expect(await countMemoriesByTenant(harness.prisma, 'josh-personal')).toBe(0);

    // 3. Positive control: business agent search MUST surface the row. If
    //    this fails, the retrieval layer is broken outright — any 0-result
    //    negative test would pass trivially. (Calls the HTTP API directly
    //    to avoid the MCP client wire-shape bug noted in the docstring.)
    const ownView = await apiSearchAsAgent(
      harness.config.apiBaseUrl,
      harness.config.apiKey,
      businessAgent,
      businessSecret
    );
    expect(ownView.items.length).toBeGreaterThanOrEqual(1);
    expect(ownView.items.some(i => i.tenantId === 'josh-business')).toBe(true);
    expect(ownView.items.some(i => i.content.includes(businessSecret))).toBe(true);

    // 4. THE assertion: personal-tenant agent searching the SAME marker
    //    must see ZERO results. Pre-WS-1 this returned the business row
    //    because the retrieval layer dropped the tenant filter.
    const crossTenantView = await apiSearchAsAgent(
      harness.config.apiBaseUrl,
      harness.config.apiKey,
      personalAgent,
      businessSecret
    );
    expect(crossTenantView.items).toHaveLength(0);
    expect(crossTenantView.total).toBe(0);
  });

  /**
   * F-202: a near-duplicate dedup search must not cross tenant boundaries.
   *
   * Pre-fix: `findNearDuplicate` did not filter by `tenant_id`. If a
   * josh-business memory existed and a josh-personal agent created a memory
   * with near-identical content, the service would find the business row,
   * call `updateMemory` with the personal agent's context, and the
   * contextOverrides path would silently rewrite the business memory's
   * `tenant_id` to `josh-personal`. Effectively a tenant-boundary violation
   * driven entirely by content similarity.
   *
   * This test relies on the MCP `memory_write` path executing the dedup
   * lookup — which runs whenever an embedding can be generated. In CI the
   * OpenAI key may be unset, in which case `generateEmbeddingWithRetry`
   * returns null and dedup is skipped. We assert the strong property
   * (no cross-tenant rewrite) regardless: if dedup ran, the business row
   * must still be josh-business; if dedup didn't run, two memories exist,
   * one per tenant, and the business row is also still josh-business.
   */
  it('F-202: cross-tenant dedup never rewrites the other tenant\'s row', async () => {
    const businessAgent = getAgent('test-code'); // josh-business
    const personalAgent = getAgent('test-desktop'); // josh-personal

    const sharedContent =
      'Critical operational note: Q4 customer retention strategy hinges on the new onboarding flow.';

    // 1. Business agent writes the canonical version of this content.
    const businessMcp = await startMcpClient({
      agent: businessAgent,
      apiBaseUrl: harness.config.apiBaseUrl,
    });
    try {
      await businessMcp.callTool('memory_write', {
        userId: TEST_USER_ID,
        content: sharedContent,
        domain: 'business',
        skipExtraction: true,
      });
    } finally {
      await businessMcp.close();
    }

    const businessRowsBefore = await findMemoriesByContentMarker(
      harness.prisma,
      sharedContent.slice(0, 40)
    );
    expect(businessRowsBefore).toHaveLength(1);
    expect(businessRowsBefore[0]!.tenantId).toBe('josh-business');
    const businessRowIdBefore = businessRowsBefore[0]!.id;

    // 2. Personal agent writes near-identical content. Pre-F-202 this would
    //    trigger the unscoped dedup search, find the business row, and
    //    rewrite its tenant_id to josh-personal.
    const personalMcp = await startMcpClient({
      agent: personalAgent,
      apiBaseUrl: harness.config.apiBaseUrl,
    });
    try {
      await personalMcp.callTool('memory_write', {
        userId: TEST_USER_ID,
        content: sharedContent, // exact-match — guaranteed to hit any dedup threshold
        domain: 'personal',
        skipExtraction: true,
      });
    } finally {
      await personalMcp.close();
    }

    // 3. The strong assertion: the business row's tenantId is UNCHANGED.
    //    This holds whether dedup ran (and was correctly scoped) or whether
    //    it was skipped (no OpenAI key in CI). It is the only assertion that
    //    detects the F-202 bug regardless of CI embedding availability.
    const businessRowAfter = await harness.prisma.memoryEntry.findUnique({
      where: { id: businessRowIdBefore },
      select: { id: true, tenantId: true, agentId: true },
    });
    expect(businessRowAfter).not.toBeNull();
    expect(businessRowAfter!.tenantId).toBe('josh-business');
    expect(businessRowAfter!.agentId).toBe(businessAgent.agentId);

    // 4. Tenant counts must remain isolated: josh-business has its row,
    //    josh-personal has zero or one (depending on whether dedup ran in
    //    its OWN tenant scope — which is the correct behavior).
    expect(await countMemoriesByTenant(harness.prisma, 'josh-business')).toBe(1);
    const personalCount = await countMemoriesByTenant(harness.prisma, 'josh-personal');
    expect(personalCount).toBeGreaterThanOrEqual(0);
    expect(personalCount).toBeLessThanOrEqual(1);
  });

    // 2. Confirm the write actually landed in the business tenant — this is
    //    the positive control. If THIS fails, the write seam is broken (Bug #1
    //    or Bug #2 writeside) and the leak check below is meaningless.
    const businessRows = await findMemoriesByContentMarker(harness.prisma, businessSecret);
    expect(businessRows).toHaveLength(1);
    expect(businessRows[0]!.tenantId).toBe('josh-business');
    expect(await countMemoriesByTenant(harness.prisma, 'josh-business')).toBe(1);
    expect(await countMemoriesByTenant(harness.prisma, 'josh-personal')).toBe(0);

    // 3. Positive control: business agent search MUST surface the row. If
    //    this fails, the retrieval layer is broken outright — any 0-result
    //    negative test would pass trivially. (Calls the HTTP API directly
    //    to avoid the MCP client wire-shape bug noted in the docstring.)
    const ownView = await apiSearchAsAgent(
      harness.config.apiBaseUrl,
      harness.config.apiKey,
      businessAgent,
      businessSecret
    );
    expect(ownView.items.length).toBeGreaterThanOrEqual(1);
    expect(ownView.items.some(i => i.tenantId === 'josh-business')).toBe(true);
    expect(ownView.items.some(i => i.content.includes(businessSecret))).toBe(true);

    // 4. THE assertion: personal-tenant agent searching the SAME marker
    //    must see ZERO results. Pre-WS-1 this returned the business row
    //    because the retrieval layer dropped the tenant filter.
    const crossTenantView = await apiSearchAsAgent(
      harness.config.apiBaseUrl,
      harness.config.apiKey,
      personalAgent,
      businessSecret
    );
    expect(crossTenantView.items).toHaveLength(0);
    expect(crossTenantView.total).toBe(0);
  });
});
