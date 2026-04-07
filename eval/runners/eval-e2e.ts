/**
 * End-to-End Decision Flow Evaluation Runner
 *
 * Tests the full session lifecycle: create -> ambiguity check -> dispatch -> synthesize -> extract.
 *
 * Requires: Both services running + ANTHROPIC_API_KEY set.
 * Run: npx tsx eval/runners/eval-e2e.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOARDROOM_URL = process.env.BOARDROOM_URL ?? 'http://localhost:3001';

interface E2EResult {
  scenario: string;
  steps: {
    name: string;
    status: 'pass' | 'fail' | 'skip';
    durationMs: number;
    error?: string;
  }[];
  totalDurationMs: number;
  pass: boolean;
}

async function main() {
  console.log('=== End-to-End Decision Flow Evaluation ===\n');
  console.log('NOTE: This runner requires both services running + ANTHROPIC_API_KEY.\n');

  const results: E2EResult[] = [
    {
      scenario: 'full-decision-flow',
      steps: [
        { name: 'create-session', status: 'skip', durationMs: 0 },
        { name: 'check-ambiguity', status: 'skip', durationMs: 0 },
        { name: 'dispatch-personas', status: 'skip', durationMs: 0 },
        { name: 'synthesize', status: 'skip', durationMs: 0 },
        { name: 'extract-memories', status: 'skip', durationMs: 0 },
      ],
      totalDurationMs: 0,
      pass: false,
    },
  ];

  mkdirSync(join(__dirname, '../results'), { recursive: true });
  writeFileSync(
    join(__dirname, `../results/e2e-${Date.now()}.json`),
    JSON.stringify(
      { timestamp: new Date().toISOString(), results, note: 'Requires live services for real evaluation' },
      null,
      2,
    ),
  );

  console.log('E2E eval saved (placeholder — run with live services for real results).');
}

main().catch(console.error);
