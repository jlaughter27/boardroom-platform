/**
 * E2E-6 / D16 — Ministry-domain refusal cannot be bypassed by case, whitespace,
 * array form, or null variants.
 *
 * Background (WS-6 F-101):
 *   The ministry refusal gate at MCP and API used a strict `=== 'ministry'`
 *   compare. Any input that doesn't EXACTLY match (`'Ministry'`, `'ministry '`,
 *   `['ministry']`) passes the gate. The memory is written to the DB without
 *   encryption, without audit redaction, and with no Ollama routing.
 *
 *   Fix: normalize at the Zod validation boundary (`.trim().toLowerCase()`)
 *   plus defense-in-depth normalization in the service layer.
 *
 * Defense bar: ANY domain whose normalized form is `'ministry'` MUST result in
 * a 503 MINISTRY_DEFERRED response. ANY write that bypasses the gate MUST NOT
 * land in `memory_entries` — count(*) at the end of each variant must equal
 * count(*) at the start.
 *
 * We hit the API directly so we control header / body forms exactly (array
 * headers, embedded JSON, etc.). MCP-side tests are the responsibility of the
 * MCP server's own unit tests; this file is the cross-seam regression gate.
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

async function apiCreateMemory(
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>
): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl}/memories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'x-user-id': TEST_USER_ID,
      'x-agent-id': 'test-ministry-bypass',
      'x-tenant-id': 'josh-business',
      'x-source-weight': '1.0',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { status: res.status, body };
}

describe('E2E-6 / D16: ministry-domain bypass attempts are all refused', () => {
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

  /**
   * Helper — assert post-condition: zero rows added to `memory_entries`.
   * The refusal gate must short-circuit before any write.
   */
  async function expectNoMemoriesWritten(): Promise<void> {
    const count = await harness.prisma.memoryEntry.count({
      where: { userId: TEST_USER_ID, deletedAt: null },
    });
    expect(count).toBe(0);
  }

  it('exact lowercase "ministry" is refused with 503 MINISTRY_DEFERRED', async () => {
    // Sanity check — the canonical form must still trigger refusal.
    const res = await apiCreateMemory(harness.config.apiBaseUrl, harness.config.apiKey, {
      title: 'should-be-refused',
      content: 'sensitive ministry content',
      domain: 'ministry',
      sourceType: 'MCP_AGENT',
    });

    expect(res.status).toBe(503);
    const body = res.body as { code?: string };
    expect(body.code).toBe('MINISTRY_DEFERRED');
    await expectNoMemoriesWritten();
  });

  it('case variant "Ministry" is refused (was bypass pre-WS-6)', async () => {
    const res = await apiCreateMemory(harness.config.apiBaseUrl, harness.config.apiKey, {
      title: 'case-variant',
      content: 'sensitive ministry content via uppercase',
      domain: 'Ministry',
      sourceType: 'MCP_AGENT',
    });

    expect(res.status).toBe(503);
    const body = res.body as { code?: string };
    expect(body.code).toBe('MINISTRY_DEFERRED');
    await expectNoMemoriesWritten();
  });

  it('case variant "MINISTRY" is refused', async () => {
    const res = await apiCreateMemory(harness.config.apiBaseUrl, harness.config.apiKey, {
      title: 'all-caps',
      content: 'sensitive ministry content via all caps',
      domain: 'MINISTRY',
      sourceType: 'MCP_AGENT',
    });

    expect(res.status).toBe(503);
    await expectNoMemoriesWritten();
  });

  it('whitespace-padded " ministry " is refused (was bypass pre-WS-6)', async () => {
    const res = await apiCreateMemory(harness.config.apiBaseUrl, harness.config.apiKey, {
      title: 'whitespace',
      content: 'sensitive ministry content via padding',
      domain: ' ministry ',
      sourceType: 'MCP_AGENT',
    });

    expect(res.status).toBe(503);
    await expectNoMemoriesWritten();
  });

  it('mixed case with whitespace " Ministry\\t " is refused', async () => {
    const res = await apiCreateMemory(harness.config.apiBaseUrl, harness.config.apiKey, {
      title: 'mixed',
      content: 'sensitive ministry content via mixed',
      domain: ' Ministry\t ',
      sourceType: 'MCP_AGENT',
    });

    expect(res.status).toBe(503);
    await expectNoMemoriesWritten();
  });

  it('array-form ["ministry"] is rejected as a validation error (NOT silently bypassed)', async () => {
    // Body-level type confusion: pass domain as an array. The Zod schema is
    // `z.string()` so this must produce a 4xx — not silently accept the array
    // and write the memory without the ministry gate firing.
    const res = await apiCreateMemory(harness.config.apiBaseUrl, harness.config.apiKey, {
      title: 'array-injection',
      content: 'sensitive ministry content via array',
      domain: ['ministry'],
      sourceType: 'MCP_AGENT',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await expectNoMemoriesWritten();
  });

  it('JSON-injection in domain ("ministry\\",\\"sourceType\\":\\"X") does not bypass refusal', async () => {
    // Try to confuse the parser by embedding JSON-ish syntax. The escape gets
    // sent as a literal string (JSON.stringify above quotes it), so the
    // domain value is just a longer string that still trims+lowercases to
    // "ministry...". The boundary check must operate on the parsed string,
    // not on any re-interpretation.
    const res = await apiCreateMemory(harness.config.apiBaseUrl, harness.config.apiKey, {
      title: 'json-injection',
      content: 'sensitive ministry content via injection',
      domain: 'ministry","sourceType":"INJECTED',
      sourceType: 'MCP_AGENT',
    });

    // Two acceptable outcomes:
    //   (a) Refused with 503 (the normalize-then-equal check fires because the
    //       string after normalization starts with 'ministry' and is treated as
    //       a non-canonical domain that happens to start with ministry → safer
    //       implementations may reject any "starts with ministry" prefix). Note:
    //       the canonical-form check is strict equality, so this string is NOT
    //       'ministry' after lowercase — it remains the longer injected string.
    //       That means the API treats it as a regular (non-ministry) domain.
    //   (b) Accepted as a non-ministry domain because the literal value does
    //       NOT match 'ministry' even after normalization.
    //
    // Both are safe outcomes. The unsafe outcome we're defending against would
    // be: SOME quoted-string parser layer interprets the embedded comma+quote
    // as a JSON delimiter, splits the domain, and lets a now-bare "ministry"
    // through. That would cause a 503 OR write. Either way, the write count
    // must equal 1 only if status is 2xx, and must equal 0 if 503.

    if (res.status === 503) {
      await expectNoMemoriesWritten();
    } else {
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(400);
      const count = await harness.prisma.memoryEntry.count({
        where: { userId: TEST_USER_ID, deletedAt: null },
      });
      // EXACTLY one write — no parser-induced "ministry" split occurred.
      expect(count).toBe(1);
      // And the stored row's domain is the FULL injected string (lowercased),
      // not the prefix 'ministry'. This proves no parsing artifact bypassed.
      const stored = await harness.prisma.memoryEntry.findFirstOrThrow({
        where: { userId: TEST_USER_ID },
        select: { domain: true },
      });
      expect(stored.domain.toLowerCase()).not.toBe('ministry');
      expect(stored.domain).toContain('ministry');
    }
  });

  it('null/undefined domain is rejected as a validation error', async () => {
    // The Zod schema requires `domain: z.string().min(1)` after our transform.
    // Passing null must produce a 4xx.
    const res = await apiCreateMemory(harness.config.apiBaseUrl, harness.config.apiKey, {
      title: 'null-domain',
      content: 'sensitive',
      domain: null,
      sourceType: 'MCP_AGENT',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await expectNoMemoriesWritten();
  });
});
