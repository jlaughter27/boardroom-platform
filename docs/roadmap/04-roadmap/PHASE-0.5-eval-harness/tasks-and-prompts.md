# Phase 0.5 — Tasks and Prompts

Six atomic tasks; ~23 hours over 2 weeks calendar.

| # | Task | File paths touched | Success criterion | Time |
|---|---|---|---|---|
| 0.5.1 | Expand 10 → 35 hand-labeled queries | `eval/scenarios/retrieval-set.json` (rename from `seed-queries.json`) | 20 single-hop, 10 multi-entity, 5 temporal — all with `expectedTopK` | 8h |
| 0.5.2 | Build retrieval runner with MRR/nDCG/P@5 | `eval/runners/retrieval-eval.ts`, `eval/lib/metrics.ts` (new) | `npm run eval:retrieval` outputs metrics overall + per slice | 6h |
| 0.5.3 | Capture baseline and document | `eval/baselines/2026-04.json`, `eval/README.md` | Baseline file exists; README explains MRR/nDCG/P@5 | 2h |
| 0.5.4 | Wire pre-deploy regression gate | `scripts/pre-deploy-check.sh` | Gate fails when synthetic regression injected | 2h |
| 0.5.5 | Persona smoke runner | `eval/runners/persona-smoke.ts` | 5 queries; 7 distinct persona outputs; no errors | 3h |
| 0.5.6 | CI-friendly JSON output | `eval/runners/retrieval-eval.ts` (extend) | `--json` flag produces machine-readable output | 2h |

---

## Task 0.5.1 — Expand seed queries to 35 labeled scenarios

**Prompt:**

> Build out the eval scenario set. Start by renaming `eval/scenarios/seed-queries.json` to `eval/scenarios/retrieval-set.json`.
>
> The 10 seed queries from Phase 0 are presumably all `single-hop`. Add 25 more, distributed as:
>
> - **10 more single-hop** (total 20). Plain "what did I decide about X" / "find my note on Y" queries. Should retrieve a single salient memory or a small cluster.
> - **10 multi-entity.** Queries that require linking across two or more entities. Examples:
>   - "what's the connection between my pricing decision and the Q2 launch goal"
>   - "show me everything about the conversation with Alex on the API redesign project"
>   - "when did the technical debt task come up and what blocked it"
> - **5 temporal.** Queries that depend on time. Examples:
>   - "what was I worried about three weeks ago"
>   - "decisions I made before the customer call last Tuesday"
>   - "memories from the onboarding period"
>
> Each entry has the shape:
>
> ```json
> {
>   "id": "q-011",
>   "query": "what's the connection between my pricing decision and the Q2 launch goal",
>   "userId": "<Joshua's userId>",
>   "category": "multi-entity",
>   "expectedTopK": ["mem_pricing_decision_id", "mem_q2_launch_goal_id", "mem_pricing_objection_id"],
>   "notes": "Order matters — the pricing decision is the most direct answer; the goal context comes second; the objection memory third for context"
> }
> ```
>
> To label `expectedTopK`, hit the production OmniMind retrieval endpoint AND scroll the BoardRoom UI for each query. Pick the IDs Joshua judges as the right answer in the right order. If fewer than 3 memories exist for a query, that query is too sparse — replace it with a different one.
>
> Commit the file. Sanity-check counts: `cat eval/scenarios/retrieval-set.json | jq 'group_by(.category) | map({k: .[0].category, n: length})'` must show `{single-hop: 20, multi-entity: 10, temporal: 5}`.

---

## Task 0.5.2 — Build the retrieval runner with metrics

**Prompt:**

> Create `eval/lib/metrics.ts` with three functions:
>
> ```ts
> export function meanReciprocalRank(retrieved: string[], expected: string[]): number;
> export function ndcgAt(retrieved: string[], expected: string[], k: number): number;
> export function precisionAt(retrieved: string[], expected: string[], k: number): number;
> ```
>
> - **MRR**: `1 / (rank of first expected hit)`, or 0 if no hit. Mean across queries.
> - **nDCG@k**: standard binary-relevance nDCG. DCG = sum over i of `rel_i / log2(i+2)` where `rel_i = 1` if `retrieved[i] ∈ expected`. IDCG = ideal DCG with all relevant items at top.
> - **P@k**: `|retrieved[:k] ∩ expected| / k`.
>
> Add unit tests in `eval/lib/metrics.test.ts` covering: perfect retrieval (all metrics 1.0), no hits (all 0.0), partial hits with known expected values.
>
> Create `eval/runners/retrieval-eval.ts`:
>
> ```ts
> import { readFileSync } from 'fs';
> import { meanReciprocalRank, ndcgAt, precisionAt } from '../lib/metrics';
>
> async function main() {
>   const scenarios = JSON.parse(readFileSync('eval/scenarios/retrieval-set.json', 'utf8'));
>   const results = [];
>   for (const s of scenarios) {
>     // Hit OmniMind retrieval. Use the same code path as a real persona call would.
>     const retrieved = await callRetrieval(s.userId, s.query, /* topK */ 10);
>     results.push({
>       id: s.id,
>       category: s.category,
>       mrr: meanReciprocalRank(retrieved, s.expectedTopK),
>       ndcg10: ndcgAt(retrieved, s.expectedTopK, 10),
>       p5: precisionAt(retrieved, s.expectedTopK, 5),
>     });
>   }
>   // Aggregate overall + per slice
>   const summarize = (rs: typeof results) => ({
>     mrr: avg(rs.map(r => r.mrr)),
>     ndcg10: avg(rs.map(r => r.ndcg10)),
>     p5: avg(rs.map(r => r.p5)),
>   });
>   const overall = summarize(results);
>   const byCategory = ['single-hop', 'multi-entity', 'temporal'].map(cat => ({
>     category: cat,
>     ...summarize(results.filter(r => r.category === cat)),
>   }));
>   console.log(JSON.stringify({ overall, byCategory, perQuery: results }, null, 2));
> }
> ```
>
> The `callRetrieval` helper should hit the same internal pipeline a persona call would — `retrieval/context-packager.ts` is the canonical entry point. Build a minimal harness that bypasses BoardRoom and calls OmniMind retrieval directly with a service-level API key.
>
> Add `npm run eval:retrieval` script to root `package.json`. Run it; verify it produces sensible numbers (MRR > 0 for at least the single-hop slice — if not, retrieval itself is broken).

---

## Task 0.5.3 — Capture baseline and document

**Prompt:**

> Run the retrieval eval three times back-to-back. Confirm metrics are stable within ±2% (if not, there's nondeterminism — chase it before snapshotting). Average the three runs.
>
> Save the average to `eval/baselines/2026-04.json`:
>
> ```json
> {
>   "capturedAt": "2026-04-XX",
>   "commit": "<git rev-parse HEAD>",
>   "scenarios": 35,
>   "overall": { "mrr": 0.XX, "ndcg10": 0.XX, "p5": 0.XX },
>   "byCategory": [
>     { "category": "single-hop", "mrr": ..., "ndcg10": ..., "p5": ... },
>     { "category": "multi-entity", ... },
>     { "category": "temporal", ... }
>   ]
> }
> ```
>
> Create `eval/README.md`:
>
> - What MRR / nDCG@10 / P@5 mean (one paragraph each)
> - How to add a new scenario (file format, where to put it)
> - How to update the baseline (when intentional improvement, when to refuse)
> - How to debug a regression (drill into per-query results)
> - The 3% regression threshold and why
>
> Commit baseline and README together.

---

## Task 0.5.4 — Wire the pre-deploy gate

**Prompt:**

> Open `scripts/pre-deploy-check.sh`. Add a new step BEFORE the existing typecheck/test:
>
> ```bash
> echo "Running retrieval eval gate..."
> npm run eval:retrieval -- --json > /tmp/eval-current.json
> node scripts/eval-regression-gate.js eval/baselines/2026-04.json /tmp/eval-current.json
> if [ $? -ne 0 ]; then
>   echo "BLOCKED: retrieval regression > 3% vs baseline"
>   exit 1
> fi
> ```
>
> Create `scripts/eval-regression-gate.js`:
>
> ```js
> // Usage: node eval-regression-gate.js <baseline.json> <current.json>
> const fs = require('fs');
> const [, , baselineFile, currentFile] = process.argv;
> const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
> const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
> const THRESHOLD = 0.03;
> const checks = [
>   ['overall.mrr', baseline.overall.mrr, current.overall.mrr],
>   ['overall.ndcg10', baseline.overall.ndcg10, current.overall.ndcg10],
>   ['overall.p5', baseline.overall.p5, current.overall.p5],
> ];
> let failed = false;
> for (const [name, b, c] of checks) {
>   const delta = (c - b) / b;
>   const status = delta < -THRESHOLD ? 'FAIL' : 'OK';
>   console.log(`${status} ${name}: baseline=${b.toFixed(3)} current=${c.toFixed(3)} delta=${(delta*100).toFixed(1)}%`);
>   if (delta < -THRESHOLD) failed = true;
> }
> process.exit(failed ? 1 : 0);
> ```
>
> Test the gate by manually setting one of the baseline metrics 5% higher than current — confirm the gate exits 1. Restore the baseline.

---

## Task 0.5.5 — Persona smoke runner

**Prompt:**

> Create `eval/runners/persona-smoke.ts`. Goal: catch gross persona regressions (a persona returns the same text as another, or errors out) without becoming a heavyweight LLM-judge.
>
> Pick 5 canned queries that should produce meaningfully different responses across the 7 personas. Examples:
>
> - "Should I raise prices to $39/mo?"
> - "What are the risks of skipping the eval harness?"
> - "How do I debug the embedding queue if it stalls?"
> - "What's blocking the Q2 launch?"
> - "Should I delete the cortex feature?"
>
> For each query, call the BoardRoom orchestrator (or hit the local server at `/sessions/test-mode`) and capture all 7 persona responses.
>
> Assertions:
>
> 1. **No persona errors** — every persona returns a non-empty response.
> 2. **No two personas return identical text** — string-equality after trimming whitespace.
> 3. **CEO synthesis runs last and references at least 3 of the other personas** — substring match on persona names.
> 4. **Response time per persona < 30s** — soft assertion, log warning.
>
> If any assertion fails, exit 1.
>
> Add `npm run eval:persona-smoke` script. This DOES NOT need to be in the pre-deploy gate (too slow, requires LLM credits) — run it manually before any persona-touching commit.

---

## Task 0.5.6 — JSON output mode

**Prompt:**

> Extend `eval/runners/retrieval-eval.ts` to accept `--json` flag. When set, output ONLY the metrics JSON (no human-readable preamble) — for piping to `eval-regression-gate.js` and future CI consumption.
>
> When `--json` is NOT set, keep the human-readable summary table at the top showing overall metrics with deltas vs baseline.
>
> Add `--baseline <path>` flag that takes the baseline file and prints colored deltas (green for ≥0, red for <-3%, yellow in between). Use ANSI color codes; respect `NO_COLOR` env var.
>
> No new tests required — this is a UX wrapper around existing code. Manually verify both modes work.
>
> Commit. The eval harness is now production-ready as a non-regression gate for every subsequent phase.
