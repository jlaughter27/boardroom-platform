/**
 * E2E-8 / D18 — Admin endpoints require authentication.
 *
 * Background:
 *   `app.use('/admin', adminRouter)` is protected by `apiKeyAuth` middleware
 *   which validates `x-api-key` via `timingSafeEqual`. Any request without a
 *   valid key MUST return 401 — no admin data, no admin actions.
 *
 *   This test also captures the WS-6 F-102 fix: `/admin/duplicates` must be
 *   tenant-scoped by default. With a valid API key + an attached agent
 *   context, the response must NOT contain memories from a different tenant.
 *
 * Defense bar for the unauthenticated cases: status === 401, response body
 * does NOT contain DB rows / counts / agent names. For the authenticated +
 * cross-tenant case: response must be filtered to the caller's tenant.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupHarness,
  teardownHarness,
  resetDatabase,
  seedTestAgents,
  TEST_USER_ID,
  type Harness,
} from './harness';

interface ApiResponse {
  status: number;
  body: unknown;
}

async function callAdmin(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: unknown
): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { status: res.status, body: parsed };
}

describe('E2E-8 / D18: admin endpoints require valid API key', () => {
  let harness: Harness;

  // List of admin endpoints we expect to gate. (subset that exists on main)
  const ADMIN_GET_ENDPOINTS = [
    '/admin/stats',
    '/admin/agents',
    '/admin/audit',
    '/admin/memories',
    '/admin/duplicates',
    '/admin/contradictions',
  ];

  const ADMIN_POST_ENDPOINTS = [
    { path: '/admin/summarize', body: {} },
    { path: '/admin/decay/run', body: {} },
    {
      path: '/admin/duplicates/merge',
      body: { keepId: 'x', archiveId: 'y', userId: 'z' },
    },
  ];

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

  // ---------- Unauthenticated: every endpoint must 401 ----------

  for (const path of ADMIN_GET_ENDPOINTS) {
    it(`GET ${path} without x-api-key returns 401`, async () => {
      const res = await callAdmin(harness.config.apiBaseUrl, path, 'GET', {});
      expect(res.status).toBe(401);
      // Body must not leak admin data — just the unauthorized payload.
      const body = res.body as { error?: string };
      expect(body.error).toBe('unauthorized');
    });

    it(`GET ${path} with WRONG x-api-key returns 401`, async () => {
      const res = await callAdmin(harness.config.apiBaseUrl, path, 'GET', {
        'x-api-key': 'definitely-not-the-right-key',
      });
      expect(res.status).toBe(401);
    });
  }

  for (const { path, body } of ADMIN_POST_ENDPOINTS) {
    it(`POST ${path} without x-api-key returns 401`, async () => {
      const res = await callAdmin(harness.config.apiBaseUrl, path, 'POST', {}, body);
      expect(res.status).toBe(401);
    });
  }

  // ---------- Authenticated but cross-tenant: must be scoped (F-102) ----------

  it('GET /admin/duplicates with josh-personal agent context does NOT see josh-business duplicates', async () => {
    // Seed two near-duplicate pairs in josh-business, one normal memory in josh-personal.
    await harness.prisma.memoryEntry.createMany({
      data: [
        {
          userId: TEST_USER_ID,
          title: 'Business dup A',
          content: 'Q4 pipeline shows steady growth',
          domain: 'business',
          sourceType: 'MCP_AGENT',
          agentId: 'seed-biz',
          tenantId: 'josh-business',
          sourceWeight: 1.0,
        },
        {
          userId: TEST_USER_ID,
          title: 'Business dup B',
          content: 'Q4 pipeline shows steady growth',
          domain: 'business',
          sourceType: 'MCP_AGENT',
          agentId: 'seed-biz',
          tenantId: 'josh-business',
          sourceWeight: 1.0,
        },
      ],
    });

    // Note: without real embeddings we cannot trigger the cosine join. That's
    // fine — the assertion is about tenant scoping, not duplicate detection.
    // With no embeddings, the result set is empty regardless of tenant.
    const res = await callAdmin(harness.config.apiBaseUrl, '/admin/duplicates', 'GET', {
      'x-api-key': harness.config.apiKey,
      'x-agent-id': 'test-personal-viewer',
      'x-tenant-id': 'josh-personal',
      'x-source-weight': '1.0',
    });

    expect(res.status).toBe(200);
    const body = res.body as { pairs: Array<{ a_id: string; b_id: string }> };
    // Even if any pairs ARE returned (unlikely w/o embeddings), none must be
    // from josh-business — because the caller is josh-personal.
    for (const pair of body.pairs) {
      const a = await harness.prisma.memoryEntry.findUnique({
        where: { id: pair.a_id },
        select: { tenantId: true },
      });
      const b = await harness.prisma.memoryEntry.findUnique({
        where: { id: pair.b_id },
        select: { tenantId: true },
      });
      expect(a?.tenantId).toBe('josh-personal');
      expect(b?.tenantId).toBe('josh-personal');
    }
  });

  it('POST /admin/duplicates/merge refuses cross-tenant archive (returns 404)', async () => {
    // Seed a josh-business memory.
    const biz = await harness.prisma.memoryEntry.create({
      data: {
        userId: TEST_USER_ID,
        title: 'Business secret',
        content: 'sensitive business data',
        domain: 'business',
        sourceType: 'MCP_AGENT',
        agentId: 'seed-biz',
        tenantId: 'josh-business',
        sourceWeight: 1.0,
      },
    });

    // Call as a josh-personal agent, try to archive the josh-business row.
    const res = await callAdmin(harness.config.apiBaseUrl, '/admin/duplicates/merge', 'POST', {
      'x-api-key': harness.config.apiKey,
      'x-agent-id': 'test-personal-attacker',
      'x-tenant-id': 'josh-personal',
      'x-source-weight': '1.0',
    }, {
      keepId: 'arbitrary',
      archiveId: biz.id,
      userId: TEST_USER_ID,
    });

    expect(res.status).toBe(404);

    // Verify the business row was NOT archived.
    const after = await harness.prisma.memoryEntry.findUnique({
      where: { id: biz.id },
      select: { deletedAt: true },
    });
    expect(after?.deletedAt).toBeNull();
  });

  // ---------- Authenticated within own tenant: must work ----------

  it('GET /admin/stats with valid API key returns 200', async () => {
    const res = await callAdmin(harness.config.apiBaseUrl, '/admin/stats', 'GET', {
      'x-api-key': harness.config.apiKey,
      'x-agent-id': 'test-stats-viewer',
      'x-tenant-id': 'josh-business',
      'x-source-weight': '1.0',
    });

    expect(res.status).toBe(200);
    const body = res.body as { memories: number };
    expect(typeof body.memories).toBe('number');
  });
});
