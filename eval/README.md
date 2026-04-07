# Evaluation Suite

Golden test scenarios for retrieval quality, persona differentiation,
and end-to-end session quality.

## Running Evals

```bash
# Individual runners
npm run eval:retrieval    # Retrieval quality (seeds memories, queries, scores)
npm run eval:personas     # Persona uniqueness + structural compliance
npm run eval:e2e          # Full session lifecycle

# All evals
npm run eval:all
```

## Prerequisites

- **eval:retrieval** — Requires OmniMind API running (`localhost:3333`)
- **eval:personas** — Requires both services + `ANTHROPIC_API_KEY`
- **eval:e2e** — Requires both services + `ANTHROPIC_API_KEY`

Environment variables:
- `OMNIMIND_API_URL` (default: `http://localhost:3333`)
- `OMNIMIND_API_KEY` (default: `dev-api-key-change-in-production`)
- `BOARDROOM_URL` (default: `http://localhost:3001`)
- `ANTHROPIC_API_KEY` (required for persona and e2e evals)

## Directory Structure

```
eval/
  scenarios/          # Test scenarios as JSON arrays
    cold-start.json           # No prior memories — tests baseline behavior
    ambiguous-queries.json    # Underspecified questions — tests clarification
    overlapping-projects.json # Resource conflicts — tests retrieval + reasoning
    contradictory-memory.json # Conflicting memories — tests recency handling
    context-explosion.json    # Many memories — tests ranking + item limits
    stress-*.json             # Additional stress test stubs
  rubrics/            # Scoring criteria (markdown)
    retrieval-relevance.md
    persona-uniqueness.md
    ambiguity-handling.md
    synthesis-quality.md
  runners/            # TypeScript evaluation runners
    eval-retrieval.ts   # Seeds memories, queries context, scores precision
    eval-personas.ts    # Dispatches personas, checks uniqueness + structure
    eval-e2e.ts         # Full session lifecycle test
  results/            # Auto-generated JSON result files (gitignored)
  baselines/          # Baseline snapshots for regression detection
```

## Scenario Format

Each scenario JSON file is an array of test cases:

```json
{
  "name": "unique-scenario-id",
  "description": "What this tests",
  "seedMemories": [],
  "seedEntities": {},
  "query": "The user's question",
  "mode": "decide | clarify",
  "expectedBehavior": {
    "shouldRetrieve": ["memory titles that must appear"],
    "shouldNotRetrieve": ["memory titles that must NOT appear"],
    "personaChecks": {
      "optimist": { "mustMention": ["keyword1", "keyword2"] }
    },
    "sufficiencyScore": { "minScore": 0.0, "maxScore": 1.0 },
    "maxRetrievedItems": 10
  }
}
```

## Scoring

- **Retrieval precision**: What fraction of expected memories were retrieved. Pass threshold: >= 0.5.
- **Persona uniqueness**: Jaccard overlap between persona outputs must be < 0.3 (less than 30% shared words).
- **Structural compliance**: Each persona must include required fields (situationReading, keyAssumptions, etc.).
- **Synthesis novelty**: Synthesis report must contain > 40% novel content vs raw persona outputs.
- **E2E pass**: All session lifecycle steps complete without error.

## Results

Results are saved to `eval/results/` as timestamped JSON files. Each contains:
- `timestamp` — When the eval ran
- `results` — Array of per-scenario results with pass/fail and metrics
