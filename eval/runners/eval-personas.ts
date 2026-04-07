/**
 * Persona Quality Evaluation Runner
 *
 * Dispatches personas for test scenarios and scores quality against rubrics.
 *
 * Requires: Both services running + ANTHROPIC_API_KEY set.
 * Run: npx tsx eval/runners/eval-personas.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BOARDROOM_URL = process.env.BOARDROOM_URL ?? 'http://localhost:3001';

interface PersonaEvalResult {
  scenario: string;
  personaCount: number;
  uniquenessScores: Record<string, number>;
  structuralCompliance: Record<string, boolean>;
  synthesisNovelty: number | null;
  pass: boolean;
}

function calculateOverlap(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

async function main() {
  console.log('=== Persona Quality Evaluation ===\n');
  console.log('NOTE: This runner requires both services running + ANTHROPIC_API_KEY.');
  console.log('Skipping actual LLM calls in offline mode.\n');

  // Placeholder — actual implementation requires live LLM calls
  const results: PersonaEvalResult[] = [
    {
      scenario: 'placeholder',
      personaCount: 0,
      uniquenessScores: {},
      structuralCompliance: {},
      synthesisNovelty: null,
      pass: false,
    },
  ];

  mkdirSync(join(__dirname, '../results'), { recursive: true });
  writeFileSync(
    join(__dirname, `../results/personas-${Date.now()}.json`),
    JSON.stringify(
      { timestamp: new Date().toISOString(), results, note: 'Requires live services for real evaluation' },
      null,
      2,
    ),
  );

  console.log('Persona eval saved (placeholder — run with live services for real results).');
}

// Export calculateOverlap for testing
export { calculateOverlap };

main().catch(console.error);
