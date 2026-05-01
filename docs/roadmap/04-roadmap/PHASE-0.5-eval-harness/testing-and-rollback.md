# Phase 0.5 — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 0.5.1 35 scenarios | `cat eval/scenarios/retrieval-set.json | jq 'length'` returns 35; per-category counts are 20/10/5; every entry has all required fields including non-empty `expectedTopK` |
| 0.5.2 runner + metrics | `npm run eval:retrieval` runs without error; produces sensible numbers (single-hop MRR > 0.5 expected, multi-entity MRR > 0.2 expected — if much lower, retrieval may have a real bug to fix before snapshotting); unit tests for metrics pass |
| 0.5.3 baseline + docs | `eval/baselines/2026-04.json` exists with `commit` field matching current HEAD; `eval/README.md` documents all three metrics |
| 0.5.4 pre-deploy gate | Run `scripts/pre-deploy-check.sh` against current state — passes. Edit baseline to artificially raise a metric by 5% — gate fails. Restore baseline. |
| 0.5.5 persona smoke | `npm run eval:persona-smoke` exits 0 with all 5 queries producing 7 distinct outputs and CEO synthesis referencing other personas |
| 0.5.6 JSON output | `npm run eval:retrieval -- --json` produces valid JSON (test with `jq .`); `npm run eval:retrieval -- --baseline eval/baselines/2026-04.json` shows colored deltas |

## Acceptance criterion for the harness itself

The harness is "good enough" when:

1. Three back-to-back runs produce metrics within ±2% of each other (deterministic enough)
2. The per-category breakdown shows expected patterns (single-hop > multi-entity > temporal in MRR; if not, the labels themselves may be wrong)
3. The pre-deploy gate adds <60 seconds to total deploy time
4. Joshua can read the output and answer "did retrieval get better or worse?" without needing to consult docs

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 0.5.1-0.5.6 (entire phase) | `git revert <range>`. The phase is read-only — no production code touched, no schema changes, no deployed services affected. Reverting only loses the eval harness; existing app keeps running. | 5 min |
| Pre-deploy gate causing false positives | Comment out the gate lines in `scripts/pre-deploy-check.sh` while debugging. Don't delete — the goal is to fix the underlying issue, not silence the alarm. | 1 min |
| Baseline drift after Phase 1 | Re-run `eval:retrieval`, save new baseline as `eval/baselines/2026-05-post-phase-1.json`, update the gate script to point at the new file. Retain old baselines for historical comparison. | 10 min |

## What "good baseline numbers" look like

There's no magic threshold — Joshua's session history is the universe. Rough expectations:

| Metric | Single-hop | Multi-entity | Temporal | Overall |
|---|---|---|---|---|
| MRR | 0.55-0.75 | 0.25-0.45 | 0.30-0.50 | 0.40-0.60 |
| nDCG@10 | 0.50-0.70 | 0.30-0.50 | 0.30-0.50 | 0.40-0.60 |
| P@5 | 0.30-0.50 | 0.15-0.30 | 0.15-0.30 | 0.20-0.40 |

If the actual baseline is way below this band, retrieval has a real bug. Investigate before snapshotting — a baseline taken on a broken system institutionalizes brokenness.

If the actual baseline is way above this band, the labels may be too easy. Sample 5 queries by hand and confirm the `expectedTopK` lists are not just "things that happen to embed well."

## Don't ship unless

- All 35 scenarios labeled and committed
- Three back-to-back runs are within ±2%
- Baseline file committed alongside `eval/README.md`
- Pre-deploy gate verified to fire on synthetic regression
- Persona smoke runner exits 0 against current production
- Total harness runtime < 5 min on local laptop (otherwise the gate becomes too painful to run)
