# Eval Harness Usage — How to Use the Retrieval Eval Gate

**Audience:** Claude (or human) about to ship retrieval/memory changes once Phase 0.5 is live.
**Purpose:** Operational guide for the hand-labeled eval harness — how to add queries, run locally, interpret deltas, decide when a regression blocks a phase.

**Status:** This doc assumes Phase 0.5 (eval harness) has shipped. Until then, the harness commands below will not exist; this is the spec for use once they do. See [`04-roadmap/PHASE-0.5-eval-harness/README.md`](../04-roadmap/PHASE-0.5-eval-harness/README.md) for the build-out.

---

## Why the eval harness exists

Memory and retrieval changes look fine in unit tests but silently degrade real-world quality. The harness is a **35-query hand-labeled gold set** that runs MRR / nDCG / P@5 against a known answer set. Every change to retrieval, indexing, ranking, or extraction must run the harness and report the delta.

Without this gate, Phase 3 (HNSW + RRF), Phase 6 (entity ranker boost), and Phase 7a (recency/access boost) would each ship "improvements" that we couldn't actually measure. The harness turns retrieval from vibes into numbers.

---

## Adding new query labels

Hand-labeled queries live in `eval/scenarios/retrieval-gold-set.json` (path subject to Phase 0.5 implementation).

To add a query:

1. Pick a query that represents a real user intent. Don't synthesize edge cases — pull from real session transcripts (with the user's permission).
2. Run the query against the current production retrieval to get a candidate set.
3. Hand-label each candidate as `relevant: true | false`. For ranking metrics, also assign a graded relevance score (0-3): 0 = irrelevant, 1 = tangential, 2 = relevant, 3 = perfect.
4. Add to the gold set with: `{ query, expected: [{ memoryId, relevance }], notes }`. The `notes` field captures *why* each memory was labeled — future Claude needs this when the labeler is gone.
5. Re-run the harness baseline so the new query is in the rolling MRR.

**Don't:**
- Add queries you can't answer yourself confidently. Ambiguous gold = unstable metric.
- Add queries against memories that may be soft-deleted soon. Gold sets must be stable.
- Add more than 5 queries per session. Labeling fatigue produces noise.

**Target gold set size:** 35 queries (Phase 0.5 baseline). Grow to ~75 by Phase 6. Beyond ~100, the labor cost of maintaining labels exceeds the marginal signal — at that point, switch to a held-out auto-labeled set with periodic human spot-checks.

---

## Running locally

```bash
# Run the full retrieval eval against current `main` retrieval implementation
npm run eval:retrieval

# Run against a specific retrieval branch (e.g., to A/B HNSW vs IVFFlat)
EVAL_VARIANT=hnsw npm run eval:retrieval

# Run a single query for debugging
npm run eval:retrieval -- --query "what did I decide about pricing"

# Run all evals (retrieval + personas + e2e)
npm run eval:all
```

Output goes to `eval/results/{date}-{variant}.json` plus a console summary table. The summary shows MRR, nDCG@5, P@5, recall@10 — and the per-query breakdown so you can see *which* queries regressed.

**Run before every retrieval-touching commit.** If your diff touches `packages/omnimind-api/src/retrieval/`, `ranker.ts`, `embedding.service.ts`, or `prisma/schema.prisma` (specifically index changes), you must run the eval and include the delta in your commit message or PR description.

---

## Running in pre-deploy check

The eval harness is wired into `scripts/pre-deploy-check.sh` (Phase 0.5 deliverable). The script:

1. Runs `npm run typecheck`
2. Runs `npm run test`
3. Runs `npm run eval:retrieval` against current branch
4. Compares results against the last committed baseline at `eval/baselines/main.json`
5. **Fails the pre-deploy check** if MRR drops more than the regression threshold (default: 5%)

Run it before any push to `main` that touches retrieval:

```bash
npm run pre-deploy
```

The pre-deploy script is **not** a CI gate (this repo has no CI). It's a local pre-push ritual. Treat it as binding anyway.

---

## Interpreting MRR / nDCG / P@5 deltas

| Metric | What it measures | When to care |
|---|---|---|
| **MRR (Mean Reciprocal Rank)** | How high the *first* relevant result lands on average | Top-1 user experience — search UI, persona context-packing |
| **nDCG@5** | How well-ordered the top-5 are by graded relevance | Ranking quality across the visible window |
| **P@5 (Precision@5)** | Of the top-5 results, how many are relevant | Hit rate within the visible window |
| **Recall@10** | Of all relevant docs, how many made it into the top-10 | Whether the right docs are even reachable |

**Reading deltas:**

- **MRR up, nDCG@5 up, P@5 up** → unambiguous win. Ship.
- **MRR up, P@5 down** → you got the top-1 better but added noise to positions 2-5. Often a tradeoff worth taking; flag in PR.
- **MRR down, recall@10 up** → you're surfacing more relevant docs but pushing the best one further down. Usually a regression — investigate ranker.
- **All metrics flat (±2%)** → no measurable change. Either your change had no effect, or the gold set isn't sensitive to it. Check per-query breakdown before concluding either.
- **All metrics down** → revert.

Always look at the **per-query breakdown**, not just the aggregate. A 5% MRR drop driven by 2 queries is a localized regression; a 5% drop spread across all 35 queries is a systemic problem.

---

## When a regression blocks a phase from shipping

**Hard block (do not ship, fix or revert):**
- Aggregate MRR drops >5%
- Any single query drops from MRR ≥0.5 to MRR <0.3
- P@5 drops >10% on aggregate
- Recall@10 drops >10% on aggregate (means relevant docs are no longer reachable)

**Soft block (fix or document the tradeoff in the PR):**
- Aggregate MRR drops 2-5% but a specific feature requirement justifies it (e.g., the change adds a new memory type at the cost of small ranking churn — document it)
- nDCG@5 drops while MRR holds (ordering churn within top-5; user-visible but not top-1 broken)

**Not a block:**
- Aggregate metrics flat ±2% (within noise)
- Per-query swings of ±0.1 MRR on individual queries when aggregate holds (gold set noise)

When in doubt, default to "this is a block" and let the user explicitly accept the tradeoff. Silent regressions are how retrieval quality decays month over month.

---

## When to skip the eval gate (rare)

Skipping the eval gate is appropriate **only** when:

1. **Your change provably can't affect retrieval.** Pure UI changes, billing service edits, persona prompt tweaks that don't touch retrieval, docs-only diffs.
2. **The harness itself is broken** and you're fixing it. Document in CHANGELOG.
3. **An emergency hotfix** (production data loss, security CVE) where waiting 5 minutes to run the eval would extend user-visible impact. **Run the eval immediately after** and include the delta in a follow-up commit.

**Never skip because:**
- "It's a small change." Small retrieval changes have shipped large regressions historically.
- "I'm in a hurry." The harness takes <5 minutes to run locally.
- "I'll run it after committing." You won't. Run it before.

---

## Where the harness lives in the roadmap

- **Phase 0.5** (2 weeks) — builds the harness from scratch. 35-query gold set, runners, CI integration, baseline.
- **Phase 3** (HNSW + RRF) — first major change gated by the harness.
- **Phase 6** (entity ranker boost) — second gated change.
- **Phase 7a** (recency + access boost) — third gated change.
- **Phase 8** (cross-encoder reranker, DEFERRED) — trigger to resume is *literally* "eval shows top-5 MRR <0.6". The harness is the trigger.

Without the harness, Phases 3, 6, 7a are flying blind. That's why Phase 0.5 sits first in the dependency graph after foundation cleanup. Don't skip ahead.