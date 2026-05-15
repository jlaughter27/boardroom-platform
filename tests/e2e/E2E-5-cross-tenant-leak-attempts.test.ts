/**
 * E2E-5 — Tenant injection attack surface.
 *
 * Goes beyond the happy-path of E2E-2 (which uses two well-behaved MCP
 * agents). Here we hit the API directly with crafted headers to probe what
 * happens when a caller tries to circumvent tenant scoping via:
 *
 *   1. Array-form `x-tenant-id` header (e.g. `['ministry']`) — would a
 *      naive `String(v)` accept the array's joined form?
 *   2. Case-variant tenant id (e.g. 'JOSH-BUSINESS') — does the system
 *      treat it as the same tenant or a different one?
 *   3. Leading/trailing whitespace (e.g. ' josh-business ')  — must be
 *      normalized so a cosmetic typo doesn't fragment the tenant.
 *   4. Empty / null tenant id — should fall through to the Agent table
 *      lookup, not surface results from "no tenant filter at all".
 *
 * The defense bar is: either refuse via 4xx (preferred) OR normalize safely
 * such that the request scope is unambiguously the intended tenant. The
 * EXPLICIT failure mode we're guarding against is "reads cross the tenant
 * boundary because the filter coerced the bad header into 'no filter'."
 *
 * Why we hit the API not MCP: env vars can't carry array values, and we want
 * to exercise the exact attack surface a misconfigured / hostile client
 * could send over the wire.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  setupHarness,
  teardownHarness,
  resetDatabase,
  seedTestAgents,
  TEST_USER_ID,
  countMemoriesByTenant,
  type Harness,
} from './harness';

interface SearchResponse {
  items: Array<{ id: string; tenantId: string; content: string }>;
  total: number;
}

/**
 * Hit the API directly so we have full control over header values.
 * Bypasses the MCP server — necessary because env vars can't carry
 * non-string forms (arrays, etc.).
 */
async function apiSearch(
  baseUrl: string,
  apiKey: string,
  headers: Record<string, string | string[]>,
  query?: string
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`${baseUrl}/memories`);
  if (query) url.searchParams.set('q', query);

  // Node's fetch doesn't allow array headers via the standard API. We use the
  // raw `Headers` object and call append() to emit duplicate headers — which
  // is the on-wire equivalent of passing an array (and exactly what Express's
  // `req.headers[name]` would surface as a string[]).
  const h = new Headers();
  h.set('Content-Type', 'application/json');
  h.set('x-api-key', apiKey);
  h.set('x-user-id', TEST_USER_ID);
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) {
      for (const each of v) h.append(k, each);
    } else {
      h.set(k, v);
    }
  }

  const res = await fetch(url.toString(), { method: 'GET', headers: h });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { status: res.status, body };
}

async function apiCreateRaw(
  baseUrl: string,
  apiKey: string,
  headers: Record<string, string | string[]>,
  payload: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const h = new Headers();
  h.set('Content-Type', 'application/json');
  h.set('x-api-key', apiKey);
  h.set('x-user-id', TEST_USER_ID);
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) {
      for (const each of v) h.append(k, each);
    } else {
      h.set(k, v);
    }
  }
  const res = await fetch(`${baseUrl}/memories`, {
    method: 'POST',
    headers: h,
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

describe('E2E-5: tenantId header injection attempts are refused or safely normalized', () => {
  let harness: Harness;
  const BUSINESS_MARKER = 'E2E-5-BUSINESS-SECRET';
  const PERSONAL_MARKER = 'E2E-5-PERSONAL-SECRET';

  beforeAll(async () => {
    harness = await setupHarness();
  }, 60_000);

  afterAll(async () => {
    await teardownHarness();
  });

  beforeEach(async () => {
    await resetDatabase(harness);
    await seedTestAgents(harness.prisma);

    // Seed one memory per tenant so isolation is something we can prove
    // empirically (counts mismatch → leak).
    await harness.prisma.memoryEntry.create({
      data: {
        userId: TEST_USER_ID,
        title: 'Business secret',
        content: `${BUSINESS_MARKER}: Q4 deal pipeline`,
        domain: 'business',
        sourceType: 'MCP_AGENT',
        agentId: 'seed-business',
        tenantId: 'josh-business',
        sourceWeight: 1.0,
      },
    });
    await harness.prisma.memoryEntry.create({
      data: {
        userId: TEST_USER_ID,
        title: 'Personal note',
        content: `${PERSONAL_MARKER}: dentist appointment`,
        domain: 'personal',
        sourceType: 'MCP_AGENT',
        agentId: 'seed-personal',
        tenantId: 'josh-personal',
        sourceWeight: 1.0,
      },
    });
    expect(await countMemoriesByTenant(harness.prisma, 'josh-business')).toBe(1);
    expect(await countMemoriesByTenant(harness.prisma, 'josh-personal')).toBe(1);
  });

  it('array-form x-tenant-id does not bypass the filter', async () => {
    // Two duplicate `x-tenant-id` headers — Express parses as a string[].
    // The middleware's `readHeader` requires `typeof === 'string'`, so it
    // returns null on arrays → falls through to the Agent table lookup (which
    // also won't match without x-api-key matching a registered agent).
    // The end state must be: search does NOT return memories from BOTH tenants.
    const res = await apiSearch(
      harness.config.apiBaseUrl,
      harness.config.apiKey,
      {
        'x-agent-id': 'test-attacker',
        'x-tenant-id': ['josh-business', 'josh-personal'],
        'x-source-weight': '1.0',
      },
      // Query both markers — if the array bypassed the filter we'd see both.
      BUSINESS_MARKER
    );

    expect(res.status).toBe(200);
    const body = res.body as SearchResponse;

    // The unsafe outcome would be: array coerced to a string that matches
    // neither tenant, BUT the filter dropped → all tenants returned. Defend
    // against that: the response must not contain memories from BOTH tenants.
    const tenants = new Set(body.items.map(i => i.tenantId));
    expect(tenants.has('josh-business') && tenants.has('josh-personal')).toBe(false);
  });

  it('whitespace-padded x-tenant-id is trimmed (scoped to the intended tenant)', async () => {
    const res = await apiSearch(
      harness.config.apiBaseUrl,
      harness.config.apiKey,
      {
        'x-agent-id': 'test-trimmer',
        'x-tenant-id': '  josh-business  ',
        'x-source-weight': '1.0',
      },
      BUSINESS_MARKER
    );

    expect(res.status).toBe(200);
    const body = res.body as SearchResponse;

    // Whitespace must be normalized: we should see the business memory and
    // ONLY the business memory.
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    for (const item of body.items) {
      expect(item.tenantId).toBe('josh-business');
    }
  });

  it('case-variant x-tenant-id is treated literally (does NOT match different case)', async () => {
    // Two reasonable behaviors here: (a) refuse with 4xx, (b) treat 'JOSH-BUSINESS'
    // as a distinct (empty) tenant. The unsafe outcome would be "case-insensitive
    // match leaks into josh-business" — that we MUST defend against.
    const res = await apiSearch(
      harness.config.apiBaseUrl,
      harness.config.apiKey,
      {
        'x-agent-id': 'test-caser',
        'x-tenant-id': 'JOSH-BUSINESS',
        'x-source-weight': '1.0',
      },
      BUSINESS_MARKER
    );

    // If we 4xx, that's fine. If we 200, must return zero business results.
    if (res.status === 200) {
      const body = res.body as SearchResponse;
      const businessHit = body.items.some(i => i.tenantId === 'josh-business');
      expect(businessHit).toBe(false);
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it('completely missing x-tenant-id does not return memories from arbitrary tenants', async () => {
    // No tenant header at all, no matching Agent row, just a valid API key.
    // Pre-WS-1 behavior would return all tenants (unfiltered query).
    // Post-WS-1 behavior: BoardRoom AI-style fallthrough is allowed in the
    // service layer, BUT only when no agentContext is attached. The defense:
    // a query that returns rows from BOTH seeded tenants is the failure mode.
    const res = await apiSearch(
      harness.config.apiBaseUrl,
      harness.config.apiKey,
      {
        'x-agent-id': 'test-no-tenant',
        // intentionally NO x-tenant-id
        'x-source-weight': '1.0',
      },
      // Query just enough to maybe match BOTH seeds.
      'E2E-5'
    );

    expect(res.status).toBe(200);
    const body = res.body as SearchResponse;

    // Capture explicit failure mode: we can tolerate "0 results" or
    // "results from a single tenant", but NEVER "results from both tenants
    // at once." That's the cross-tenant leak we're guarding against.
    const tenants = new Set(body.items.map(i => i.tenantId));
    expect(tenants.has('josh-business') && tenants.has('josh-personal')).toBe(false);
  });

  it('invalid sourceType in a write is refused with 4xx (WS-4 hardening)', async () => {
    // Bonus tenant-adjacent injection: send an invalid `sourceType`. Pre-WS-4
    // this silently coerced to MANUAL (hiding the typo); post-WS-4 it throws
    // INVALID_SOURCE_TYPE with a 400.
    const res = await apiCreateRaw(
      harness.config.apiBaseUrl,
      harness.config.apiKey,
      {
        'x-agent-id': 'test-bad-source',
        'x-tenant-id': 'josh-business',
        'x-source-weight': '1.0',
      },
      {
        title: 'attempted-bad-source',
        content: 'attempted-bad-source-content',
        domain: 'business',
        sourceType: 'TOTALLY_INVALID_TYPE',
      }
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
