# E2E Test Patterns — Why and How

> The 4 Hermes integration bugs all lived in the SEAM. Mocks at any single
> layer made that layer look healthy while the wiring between layers was
> broken. This doc explains why we built a real-stack harness and how to
> add the next test.

## Why mocks failed to catch the Hermes bugs

Each Hermes bug had a passing unit test on at least one side of the seam:

| Bug | Layer with passing test | What the mock hid |
|-----|-------------------------|---------------------|
| #1 — agent_id NULL | MCP tool unit tests passed (`agentId` set in returned object) | Mocked Prisma didn't actually write `agent_id`; the column went out as NULL |
| #2 — cross-tenant leak | Retrieval unit tests passed (filter logic correct given a `tenantId` arg) | API middleware wasn't reading `x-tenant-id` header, so retrieval received `undefined` and dropped the WHERE clause |
| #3 — sourceWeight 0.85 fallback | Service unit tests passed (used the static fallback by design when no context) | The `agentContext` parameter was being silently swallowed by an old signature shim |
| #4 — embedding never persists | embedding.service unit tests passed (OpenAI mock returned vectors) | Real OpenAI was down; the path treated `null` as success-with-empty and moved on |

In every case the bug was real attribution data going into a real
Postgres row vs. what mocked layers said the data was. The only way
to catch it: write to a real DB through the real stack, then SELECT
from the real DB and assert on the real values.

## Architecture of the harness

```
test file
  │
  ├─ setupHarness()
  │     ├─ TCP probe localhost:5433 (test Postgres)
  │     ├─ prisma db push --schema packages/omnimind-api/prisma/schema.prisma
  │     ├─ spawn npx tsx packages/omnimind-api/src/index.ts (binds :3399)
  │     ├─ wait for /health 200
  │     └─ open Prisma client pointed at test DB (for direct assertions)
  │
  ├─ seedTestAgents()           — upsert one `users` row + N `agents` rows
  ├─ startMcpClient({ agent })  — spawn dist/index.js with that agent's env
  │     │
  │     └─ StdioClientTransport → MCP server (in subprocess)
  │            │
  │            └─ HTTP → http://localhost:3399 (API subprocess)
  │                       │
  │                       └─ Prisma → test Postgres
  │
  └─ assert via harness.prisma.memoryEntry.findUnique({...})
```

Every test exercises:

1. **Real MCP server** — same code Claude Desktop spawns, same env vars
2. **Real API middleware** — `apiKeyAuth` + `agentContextMiddleware` + Express routing
3. **Real Prisma client** — same migrations, same schema, same indexes
4. **Real Postgres** — pgvector + pg_trgm extensions, same SQL types

The only thing stubbed: OpenAI (no API key) and Anthropic (no API key).
Those stubs are intentional — the failure paths (`null` embedding,
fail-loud fact extractor) are part of what we're testing.

## When to add an E2E test

Add one when:

- A bug only surfaces with all layers cooperating (seam bug)
- A new column / header / env var must propagate through 2+ layers
- A new tool is added to the MCP server (verify it actually writes to the right place)
- A security boundary is tightened (e.g. new admin endpoint must reject non-admins)

Don't add one when:

- The behavior is testable in a single layer (pure function, schema validation, etc.)
  — use the unit suite (`pnpm test`)
- The test requires real OpenAI/Anthropic — those go in eval runners, not E2E

## Template — adding a 6th test

```typescript
// tests/e2e/E2E-6-<bug-name>.test.ts

/**
 * E2E-6 — <one-line description of the failure mode this guards>.
 *
 * Catches <Hermes bug N or new bug>: <2-3 sentence summary of how the bug
 * manifested in production / staging, and which workstream fixed it>.
 *
 * Pre-fix behavior: <what the broken stack does>.
 * Post-fix behavior: <what the fixed stack does>.
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
  // pull in the assertion helpers you need from harness/db-assertions
  getMemoryRow,
  findMemoriesByContentMarker,
  type Harness,
} from './harness';

describe('E2E-6: <description>', () => {
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

  it('<exact behavior under test>', async () => {
    const agent = getAgent('test-code');
    const mcp = await startMcpClient({
      agent,
      apiBaseUrl: harness.config.apiBaseUrl,
    });

    try {
      const marker = `E2E-6-${Date.now()}`;
      await mcp.callTool('memory_write', {
        userId: TEST_USER_ID,
        content: `Marker ${marker}: ...`,
        domain: 'business',
        skipExtraction: true, // unless the test is specifically about extraction
      });

      // Assert on the DB row, NOT on the MCP response.
      const rows = await findMemoriesByContentMarker(harness.prisma, marker);
      expect(rows).toHaveLength(1);
      expect(rows[0]!./* field */).toBe(/* expected value */);
    } finally {
      await mcp.close();
    }
  });
});
```

## Test design rules

1. **Assert on the DB, not the API response.** The whole point of E2E
   is that the response could lie while the DB tells the truth.
2. **Use markers, not generated IDs, for content lookup.** A unique marker
   like `E2E-N-${Date.now()}` survives dedup/extraction transforms and
   makes lookup deterministic.
3. **Always `skipExtraction: true` unless the test is about extraction.**
   The fact-extractor depends on Anthropic and rewrites the content in
   non-deterministic ways. Skipping makes tests reliable.
4. **Always close the MCP client in a `finally`.** A leaked subprocess
   hangs the test suite for 30 s while vitest waits to exit.
5. **Have a positive control AND a negative control.** Bug #2 (cross-tenant
   leak) is the canonical example: write as A, assert B sees zero (negative
   control), then assert A still sees its own write (positive control).
   Without the positive, a stack that returns `[]` to everyone looks fine.
6. **Use `getAgent('test-X')` fixtures for distinct sourceWeights.**
   Each preset has a known weight; coincidental matches to the fallback
   (0.85) are impossible to mistake.

## Recommended invocation frequency

| Change touches… | Run E2E? |
|-----------------|:--:|
| `packages/omnimind-api/src/services/memory.service.ts` | yes |
| `packages/omnimind-api/src/routes/memories.routes.ts` | yes |
| `packages/omnimind-api/src/middleware/agent-context.ts` | yes |
| `packages/omnimind-api/src/retrieval/*` | yes |
| `packages/omnimind-mcp/src/lib/client.ts` | yes |
| `packages/omnimind-mcp/src/tools/memory.tool.ts` | yes |
| `packages/omnimind-api/prisma/schema.prisma` | yes |
| Adding a new MCP tool | yes — add an E2E for the tool's data path |
| UI work in `packages/boardroom-ai/client/` | no |
| Adding shared types | no |

## Cost budget

- Per-test cap: 30 s (enforced via vitest `testTimeout: 30_000`)
- Suite cap: 3 min — measured locally on dev hardware. If a new test
  pushes past this, it's probably doing too much in one case and should
  be split.
