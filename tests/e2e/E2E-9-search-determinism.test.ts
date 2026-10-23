/**
 * E2E-9 — RD-2: `POST /memories/search` returns the same order for the same
 * query on the same rows, and an exact title match ranks first.
 *
 * Found by the 2026-10-23 real-data run: a single-keyword query scored ~0.42
 * flat across the top 10, and the note whose title WAS the keyword ranked #2
 * in one run and outside the top 20 in an identical run on the same data.
 * Causes (all fixed): the ranker's tie comparator was not transitive, so flat
 * scores came back in input order — i.e. Postgres heap order of tied rows,
 * which moves whenever a row is updated; no layer had an `id` tie-break, so a
 * LIMIT on ties could return a different SET; and the recency boost read
 * `last_accessed_at`, which `/context/for-persona` writes (recall
 * reinforcement), so any persona call between two searches reordered them.
 *
 * Real Postgres, real API, no embeddings (the semantic layer is empty, as in
 * the run): the lexical layers alone must be deterministic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupHarness, teardownHarness, resetDatabase, TEST_USER_ID, type Harness } from './harness';

interface SearchItem { id: string; title: string; score: number }

describe('E2E-9: /memories/search is deterministic and title-first (RD-2)', () => {
  let harness: Harness;
  const ids: Record<string, string> = {};

  const call = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${harness.config.apiBaseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': harness.config.apiKey, 'x-user-id': TEST_USER_ID },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const search = async (query: string): Promise<SearchItem[]> => {
    const r = await call<{ items: SearchItem[] }>('POST', '/memories/search', { query, limit: 20 });
    expect(r.status).toBe(200);
    return r.body.items;
  };

  beforeAll(async () => {
    harness = await setupHarness();
    await resetDatabase(harness);
    // 15 daily-note-shaped memories that each mention "pricing" exactly once
    // (identical full-text rank, identical importance → a 15-way tie), and the
    // note titled "Pricing" created in the MIDDLE, so heap order does not
    // favour it. 16 writes stay under the 20/min write budget.
    const bodies = Array.from({ length: 15 }, (_, i) =>
      `Daily ${i + 1}: calls, admin and one pricing question from a trial account about crew seats.`);
    for (let i = 0; i < bodies.length; i++) {
      if (i === 7) {
        const r = await call<{ id: string }>('POST', '/memories', {
          title: 'Pricing', content: 'Per crew per month. Crew Basic, Crew Plus and Crew Pro plans; grandfather existing accounts for one renewal.',
          domain: 'business', sourceType: 'MANUAL', importance: 0.5,
        });
        expect([200, 201]).toContain(r.status);
        ids.title = r.body.id;
      }
      const r = await call<{ id: string }>('POST', '/memories', {
        title: `2026-09-${String(i + 1).padStart(2, '0')}`, content: bodies[i], domain: 'business', sourceType: 'MANUAL', importance: 0.5,
      });
      expect([200, 201]).toContain(r.status);
      ids[`daily-${i}`] = r.body.id;
    }
  }, 120_000);

  afterAll(async () => {
    await teardownHarness();
  });

  it('the exact title match ranks #1 and clearly above body-only mentions', async () => {
    const items = await search('pricing');
    expect(items.length).toBe(16);
    expect(items[0].id).toBe(ids.title);
    expect(items[0].score - items[1].score).toBeGreaterThan(0.1);
  });

  it('same query, same rows → same order, also after heap order changes and a persona read in between', async () => {
    const first = (await search('pricing')).map(i => i.id);
    expect((await search('pricing')).map(i => i.id)).toEqual(first);

    // Rewrite half the tuples (new heap positions, same values) — tied rows
    // used to come back in a different physical order after this.
    await harness.prisma.$executeRawUnsafe(
      `UPDATE memory_entries SET importance = importance WHERE user_id = $1 AND title LIKE '2026-09-0%'`, TEST_USER_ID);
    expect((await search('pricing')).map(i => i.id)).toEqual(first);

    // A persona read reinforces recall (writes last_accessed_at) on what it surfaced.
    const fp = await call<{ items: unknown[] }>('POST', '/context/for-persona', { query: 'pricing', persona: 'ceo' });
    expect(fp.status).toBe(200);
    await new Promise(r => setTimeout(r, 300)); // reinforcement is fire-and-forget
    const touched = await harness.prisma.memoryEntry.count({ where: { userId: TEST_USER_ID, lastAccessedAt: { not: null } } });
    expect(touched).toBeGreaterThan(0);
    expect((await search('pricing')).map(i => i.id)).toEqual(first);
  });

  it('the search itself writes nothing (no recall reinforcement, no last_accessed_at)', async () => {
    await harness.prisma.memoryEntry.updateMany({ where: { userId: TEST_USER_ID }, data: { lastAccessedAt: null, recallCount: 0 } });
    await search('pricing');
    await search('crew seats');
    const touched = await harness.prisma.memoryEntry.count({
      where: { userId: TEST_USER_ID, OR: [{ lastAccessedAt: { not: null } }, { recallCount: { gt: 0 } }] },
    });
    expect(touched).toBe(0);
  });
});
