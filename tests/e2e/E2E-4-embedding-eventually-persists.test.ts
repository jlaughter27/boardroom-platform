/**
 * E2E-4 — Embedding outbox: memory writes survive an unavailable embedding
 * provider and become recoverable via the retry queue.
 *
 * Catches Hermes Bug #4: when OpenAI was unreachable, `createMemory` succeeded
 * but the row had `embedding IS NULL` forever with no retry path. WS-2 added
 * the EmbeddingOutbox table — every createMemory call now upserts an outbox
 * row, attempts the embed once, and on failure leaves the outbox row pending
 * for the retry scheduler.
 *
 * The harness intentionally starts the API with OPENAI_API_KEY='' so the embed
 * path always fails — this is exactly the failure mode that should leave a
 * durable trail in the outbox.
 *
 * Pre-WS-2 behavior: memory row exists, embedding NULL, no retry trace.
 * Post-WS-2 behavior: memory row exists, embedding NULL, outbox row exists
 *                     with succeededAt=NULL and attempts >= 1.
 *
 * We don't try to test the success path here — that requires a real
 * OpenAI key, which we can't guarantee in CI / dev. The outbox row being
 * present is the regression gate; the actual retry success is exercised by
 * the unit tests for processEmbeddingOutboxEntry.
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
  waitForOutboxRow,
  hasEmbedding,
  type Harness,
} from './harness';

describe('E2E-4: Embedding outbox captures pending work when provider is unavailable', () => {
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

  it('creates an outbox row when OpenAI is unavailable and leaves it pending', async () => {
    const agent = getAgent('test-code');
    const mcp = await startMcpClient({
      agent,
      apiBaseUrl: harness.config.apiBaseUrl,
    });

    try {
      const marker = `E2E-4-${Date.now()}`;
      const writeResult = await mcp.callTool<{ created: string[] }>('memory_write', {
        userId: TEST_USER_ID,
        content: `Marker ${marker}: testing embedding outbox under provider outage`,
        domain: 'business',
        skipExtraction: true,
      });

      expect(writeResult.created).toHaveLength(1);
      const memoryId = writeResult.created[0]!;

      // 1. Memory row exists (write succeeded despite no embedding provider).
      const rows = await findMemoriesByContentMarker(harness.prisma, marker);
      expect(rows).toHaveLength(1);

      // 2. Embedding did NOT land — the API has no OPENAI_API_KEY in the
      //    test environment, so generateEmbeddingWithRetry returns null.
      expect(await hasEmbedding(harness.prisma, memoryId)).toBe(false);

      // 3. The outbox row was created and is in the pending state
      //    (succeededAt IS NULL). attempts >= 1 because createMemory tries
      //    to embed once synchronously.
      const outbox = await waitForOutboxRow(harness.prisma, memoryId, 5000);
      expect(outbox.memoryId).toBe(memoryId);
      expect(outbox.succeededAt).toBeNull();
      expect(outbox.attempts).toBeGreaterThanOrEqual(1);
      // lastError or lastAttemptAt should be set so an operator can debug.
      expect(outbox.lastAttemptAt).not.toBeNull();
    } finally {
      await mcp.close();
    }
  });

  it('every write enqueues an outbox row even when many writes happen back-to-back', async () => {
    // Regression guard: it would be tempting to gate outbox enqueue behind
    // "embedding failed once" — but the contract is "every write gets a
    // durable retry record up front." Otherwise a crash mid-attempt loses
    // the row.
    const agent = getAgent('test-code');
    const mcp = await startMcpClient({
      agent,
      apiBaseUrl: harness.config.apiBaseUrl,
    });

    try {
      const baseMarker = `E2E-4-BATCH-${Date.now()}`;
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await mcp.callTool<{ created: string[] }>('memory_write', {
          userId: TEST_USER_ID,
          content: `${baseMarker}-${i}: batch write under embedding outage`,
          domain: 'business',
          skipExtraction: true,
        });
        expect(res.created).toHaveLength(1);
        ids.push(res.created[0]!);
      }

      // Every one of them should now have an outbox row.
      for (const id of ids) {
        const outbox = await waitForOutboxRow(harness.prisma, id, 5000);
        expect(outbox.succeededAt).toBeNull();
      }
    } finally {
      await mcp.close();
    }
  });
});
