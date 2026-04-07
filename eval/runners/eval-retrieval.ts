/**
 * Retrieval Quality Evaluation Runner
 *
 * Seeds test memories via OmniMind API, runs retrieval queries,
 * and scores results against expected behavior.
 *
 * Requires: Both OmniMind and BoardRoom services running.
 * Run: npx tsx eval/runners/eval-retrieval.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const OMNIMIND_URL = process.env.OMNIMIND_API_URL ?? 'http://localhost:3333';
const API_KEY = process.env.OMNIMIND_API_KEY ?? 'dev-api-key-change-in-production';
const TEST_USER_ID = 'eval-user-retrieval';

interface Scenario {
  name: string;
  description: string;
  seedMemories: Record<string, unknown>[];
  query: string;
  mode: string;
  expectedBehavior: {
    shouldRetrieve: string[];
    shouldNotRetrieve: string[];
    maxRetrievedItems?: number;
  };
}

interface RetrievalResult {
  scenario: string;
  query: string;
  retrievedItems: number;
  expectedFound: number;
  expectedTotal: number;
  precision: number;
  unexpectedItems: string[];
  pass: boolean;
}

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${OMNIMIND_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'x-user-id': TEST_USER_ID },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function seedMemories(memories: Record<string, unknown>[]): Promise<string[]> {
  const ids: string[] = [];
  for (const mem of memories) {
    const result = (await request('POST', '/memories', mem)) as { id: string };
    ids.push(result.id);
  }
  return ids;
}

async function queryContext(
  query: string,
  persona: string,
): Promise<{ items: { content: string; id: string }[] }> {
  return request('POST', '/context/for-persona', {
    query,
    persona,
    userId: TEST_USER_ID,
  }) as Promise<{ items: { content: string; id: string }[] }>;
}

async function cleanup(memoryIds: string[]): Promise<void> {
  for (const id of memoryIds) {
    await request('DELETE', `/memories/${id}`);
  }
}

async function runScenario(scenario: Scenario): Promise<RetrievalResult> {
  // Seed
  const ids = await seedMemories(scenario.seedMemories);

  // Query
  const context = await queryContext(scenario.query, 'ceo');
  const retrievedTitles = context.items.map((i) => i.content);

  // Score
  let expectedFound = 0;
  for (const expected of scenario.expectedBehavior.shouldRetrieve) {
    if (retrievedTitles.some((t) => t.includes(expected))) expectedFound++;
  }

  const unexpectedItems: string[] = [];
  for (const unexpected of scenario.expectedBehavior.shouldNotRetrieve) {
    if (retrievedTitles.some((t) => t.includes(unexpected))) unexpectedItems.push(unexpected);
  }

  const expectedTotal = scenario.expectedBehavior.shouldRetrieve.length;
  const precision = expectedTotal > 0 ? expectedFound / expectedTotal : 1;
  const itemLimitOk =
    !scenario.expectedBehavior.maxRetrievedItems ||
    context.items.length <= scenario.expectedBehavior.maxRetrievedItems;

  // Cleanup
  await cleanup(ids);

  return {
    scenario: scenario.name,
    query: scenario.query,
    retrievedItems: context.items.length,
    expectedFound,
    expectedTotal,
    precision,
    unexpectedItems,
    pass: precision >= 0.5 && unexpectedItems.length === 0 && itemLimitOk,
  };
}

async function main() {
  console.log('=== Retrieval Quality Evaluation ===\n');

  const scenarioFiles = ['overlapping-projects.json', 'contradictory-memory.json', 'context-explosion.json'];
  const allResults: RetrievalResult[] = [];

  for (const file of scenarioFiles) {
    const scenarios: Scenario[] = JSON.parse(readFileSync(join(__dirname, '../scenarios', file), 'utf-8'));
    for (const scenario of scenarios) {
      if (scenario.seedMemories.length === 0) continue;
      try {
        const result = await runScenario(scenario);
        allResults.push(result);
        console.log(
          `${result.pass ? 'PASS' : 'FAIL'} ${result.scenario}: precision=${result.precision.toFixed(2)}, items=${result.retrievedItems}`,
        );
      } catch (err) {
        console.error(`ERROR ${scenario.name}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // Save results
  mkdirSync(join(__dirname, '../results'), { recursive: true });
  const output = { timestamp: new Date().toISOString(), results: allResults };
  writeFileSync(join(__dirname, `../results/retrieval-${Date.now()}.json`), JSON.stringify(output, null, 2));
  console.log(`\nResults saved. ${allResults.filter((r) => r.pass).length}/${allResults.length} passed.`);
}

main().catch(console.error);
