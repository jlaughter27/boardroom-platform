# Phase 5b — Testing and Rollback

## Verification per task

| Task | Verification |
|---|---|
| 5b.1 worker pickup | Force a PENDING_REVIEW event; tick worker; event status APPLIED; payload contains the LLM action |
| 5b.2 Haiku call + Zod | Mocked valid tool response → service returns parsed action; mocked invalid → retries; mocked all-invalid → NOOP fallback |
| 5b.3 prompt | `docs/prompts/mem0-consolidation.system.md` exists and `loadSystemPrompt('mem0-consolidation')` succeeds; prompt covers all 4 actions explicitly |
| 5b.4 retry | Test asserts 3rd attempt wins after 2 failures; all-3-fail returns fallback |
| 5b.5 cost cap | Mock budget cap fail → no Anthropic call made; NOOP returned |
| 5b.6 tests | All branches green; integration test with real worker tick passes |
| 5b.7 eval + monitor | Eval within 3% of baseline; PENDING_REVIEW backlog drains within 48h staging soak |

## Smoke test after deploy (flag OFF)

1. `/health` on OmniMind → 200.
2. Wait 24h. Verify zero new `LLMCostUsage` rows with `purpose: consolidation`.
3. Verify PENDING_REVIEW events do not transition (worker skips them when flag OFF).
4. No errors in Better Stack related to `consolidateWithLLM`.

## Smoke test after flag flip ON (staging first)

1. Set `LLM_CONSOLIDATION_ENABLED=true` in staging, restart.
2. Verify worker picks up existing PENDING_REVIEW events within next tick.
3. Verify some events transition with `payload.action` recorded.
4. Verify `LLMCostUsage` rows with `purpose: consolidation` appear; cost is small (boundary cases are infrequent).
5. Run eval — within 3% of baseline.
6. After 48h staging-stable, flip in production.

## Rollback per task

| Task | Rollback procedure | Time |
|---|---|---|
| 5b.1 worker pickup | `git revert`. PENDING_REVIEW events sit unprocessed (visible in monitor); pattern-only behavior continues. | 5 min |
| 5b.2 Haiku call | `git revert`. Worker can't call LLM but won't crash (logic just doesn't process PENDING_REVIEW). Combine with flag OFF. | 5 min |
| 5b.3 prompt | `git revert` removes the markdown file. Service throws on `loadSystemPrompt` (no silent fallback). Combine with flag OFF. | 2 min |
| 5b.4 retry helper | `git revert`. Phase 5a-style inline retry returns. Tests should still pass. | 5 min |
| 5b.5 cost cap | n/a — reuses Phase 5a infrastructure. | n/a |
| 5b.6 tests | n/a. | n/a |
| 5b.7 monitor | n/a — observational. Set flag OFF if needed. | n/a |

## The "safe rollback" path for the entire phase

`LLM_CONSOLIDATION_ENABLED=false` in Railway env, restart. Done. PENDING_REVIEW events sit as pattern-only artifacts; no data drift; worker continues processing other event types as before.

## Special concerns

### Trigger metric: <5 PENDING_REVIEW per user per month

Per validator §2 row 5b: if Phase 2 produces fewer than 5 boundary cases per user per month over 4 weeks, skip Phase 5b entirely. Measure with:

```sql
SELECT
  user_id,
  count(*) FILTER (WHERE payload->>'consolidationDecision' = 'PENDING_REVIEW') AS pending_count,
  date_trunc('month', created_at) AS month
FROM memory_write_events
WHERE created_at > now() - interval '90 days'
GROUP BY user_id, month
ORDER BY month DESC, pending_count DESC;
```

If max(pending_count) < 5/month across all active users, document the decision in `09-changelog/` and close out 5b without shipping. Phase 6+7a still ship as planned.

### LLM consolidation produces wrong DELETE

DELETE is the highest-blast-radius action — it marks the existing memory as deleted. The prompt explicitly instructs "Never DELETE unless the contradiction is obvious from the text alone," but LLMs can be over-confident.

Mitigation: log every DELETE decision to a separate audit table or saved Better Stack query: `purpose:consolidation AND action:DELETE`. Spot-check the first 50 DELETEs. If precision <80%, raise the prompt's caution further or remove DELETE from the allowed actions and accept living with duplicates.

### LLM can't reach a valid Zod parse

Symptom: every consolidation falls back to NOOP. Causes:

1. Tool schema mismatch. Verify `MemoryConsolidationActionSchema` JSON-Schema mirror is exact.
2. Prompt too short / under-specified. Add few-shot examples.
3. Model outputs prose instead of tool_use. The `tool_choice: { type: 'tool', name: 'submit_consolidation' }` should force tool use; verify it's present in the SDK call.
4. If still bad, log the raw responses for analysis: `logger.error({ raw: response.content }, 'parse failed')` — useful for prompt iteration.

### Cost spike

Same as Phase 5a — `LLMCostUsage` shows unexpected cost. Same response: flag OFF, investigate.

Boundary-case volume is low (< 1% of memories typically); cost should be negligible compared to entity-extraction cost. If it's high, it means too many memories are landing in PENDING_REVIEW — Phase 2 trigram thresholds are too narrow. Widen them.

## Don't ship unless

- All 7 verification items pass
- Trigger metric (>5 PENDING_REVIEW/user/month) verified — if not, document skip
- Eval within 3% of baseline with flag ON
- 48h staging-stable before prod flag flip
- Cost dashboard shows boundary-case calls are infrequent (<5% of total LLM cost)
- DELETE precision spot-check planned for first 50 in production
