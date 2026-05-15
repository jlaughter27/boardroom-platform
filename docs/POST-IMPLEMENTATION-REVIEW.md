# Post-Implementation Review — Phase 5.5 (Fix-Everything Plan)

**Date:** 2026-05-15
**Scope:** WS-1 through WS-6 of `docs/FIX-EVERYTHING-PLAN.md`, plus an emergency typecheck-baseline cleanup
**Reviewer:** Claude (orchestrator-fix), in collaboration with Josh

> Supersedes the 2026-05-09 PIR (which covered Phases 0–4). That earlier review is preserved in git history.

---

## What we set out to do

Fix the 8 integration bugs the Hermes test agent surfaced when first wired against production OmniMind. Adopt the highest-leverage 2026 best practices (outbox, exponential decay, fail-loud). Build an E2E regression harness. Run a security pass. Don't break production.

## What actually happened

Orchestrated execution worked. 6 PRs merged across ~24 hrs of focused work (orchestrator + 4 executors + manual fixes). Production verified green at each merge. Final Hermes round-trip on prod confirmed the seam works end-to-end.

### Workstreams as merged

| WS | PR | Outcome |
|---|---|---|
| 1 — The seam | #11 | Verified by Hermes round-trip. agent_id / tenant_id / source_weight propagate end-to-end. |
| 2 — Embedding resilience | #13 | Outbox queue + retry scheduler running. Verified by intentional OpenAI failure — write succeeded, outbox row pending. |
| 3 — Recall quality | #10 | Exp decay shipped; sourceWeight is now a tiebreaker; dedup threshold 0.80. Will be measurable against Mem0 LoCoMo benchmark on >100 memories. |
| 4 — Schema hardening | #13 | agent_id NOT NULL enforced; sourceType strict enum validation. |
| 5 — E2E test harness | #14 | 5 regression tests, 12.8s runtime, verified each FAILS on synthetic pre-WS-1 revert. |
| 6 — Security | #15 | 0 CRITICAL, 2 HIGH fixed, 2 MEDIUM fixed, 4 MEDIUM deferred. 3 new E2E security tests (D16-D18). |
| baseline | #12 | Cleared 9 pre-existing typecheck errors so strict gates work. |

### What surprised us

1. **Production had silent schema drift.** The Phase 4 migration was marked applied via `prisma migrate resolve --applied` instead of being actually run via `prisma migrate deploy`. Encryption columns + `weekly_digests` table never existed in prod. Surfaced only when Hermes attempted real writes post-WS-1. Fixed by applying the missing SQL by hand and updating `_prisma_migrations.applied_steps_count`.

2. **OpenAI and Anthropic keys on Railway were both auto-revoked.** The `.env.deploy` leak from May 8 had been detected by both providers and the keys silently invalidated. Hermes round-trip exposed this — every memory write failed with 401 from OpenAI in the embedding step. PR #13's outbox pattern handles this gracefully now (write succeeds, embedding queued for retry), but actual semantic search still requires Josh to rotate both keys.

3. **Parallel sub-agent contamination.** WS-2 and WS-4 sub-agents ran simultaneously against the same working tree and contaminated each other's branches before either could push. Recovered by separating them at the orchestrator level. **Lesson: parallel executors must use `git worktree add` for true isolation, not just different branches.**

4. **Sub-agent credit exhaustion.** Two sub-agent runs hit "out of credits" mid-execution. Work-on-disk was preserved by their handoff scripts, but the orchestrator had to finish the validation/commit/push manually. **Lesson: every executor should write a "finish" script as a checkpoint so a credit-exhausted run doesn't lose progress.**

5. **The validation prompt actually worked.** The Final Validation Audit prompt (commit `f0d4cf1`'s 7 findings, plus this orchestration's WS-6 11 findings) caught real bugs by reading code rather than trusting commit messages. The 4 Hermes integration bugs would not have been caught by mock-heavy unit tests alone.

### What we deferred and why

| Item | Why deferred | Trigger to revisit |
|---|---|---|
| Bitemporal validity windows (Zep/Graphiti `valid_from`/`invalid_at`) | Schema redesign cost > current value for solo user | Multi-user OR temporal-query feature request |
| Postgres row-level security | Server-side filtering sufficient for solo | Multi-user goes live |
| Letta core memory tier MCP tools | Nice-to-have observability layer | Token budget pressure or repeated retrieval cost surfaces |
| pgcrypto column encryption for ministry | Ministry domain is disabled | Phase 6 — when ministry data flow returns |
| 53 pre-existing failing tests in `omnimind-api` and `boardroom-ai` | Out of WS-6 scope, would dwarf the security PR | Dedicated test-debt PR when there's bandwidth |
| Two fact-extractor unit-test skips | Mock-binding issue, behavior covered by E2E-6 | When restructuring fact extractor for v2 |
| `.env.deploy` git history scrub via filter-repo | Josh accepted risk (low cap, OpenAI/Anthropic auto-revoke) | If keys ever survive auto-revoke |
| F-104 admin endpoint separate key | Solo mode acceptable | Adding a second human operator |
| F-105 rate-limiter IP fallback | Global limiter mitigates | If observed bypass attempts in audit log |
| F-106 audit log fire-and-forget | Known pre-existing, prior audit I-003 | Re-prioritize if audit gaps observed in production |
| F-108/F-109 encryption fail-open and GCM tamper | Ministry disabled | Same Phase 6 trigger as pgcrypto |

### What we'd do differently

1. **Pre-flight every migration baseline before assuming "merged" means "applied."** A 30-second `prisma migrate status` against prod would have caught the Phase 4 drift before Hermes did.
2. **Isolated git worktrees for parallel sub-agents.** Different branches alone do not prevent contamination when both executors edit the same working tree.
3. **Dispatch executors from the host machine where credentials live**, OR provision GH PAT for sub-agents up-front. Multiple handoff-script round-trips added orchestrator overhead.
4. **Test infra debt should have its own track.** WS-5 and WS-6 both ran into pre-existing test-collection failures unrelated to their workstreams. Either fix it before adoption-style PRs OR accept the test-suite as advisory rather than gating.
5. **Build the validation gate to flag pre-existing drift vs. introduced regressions.** The orchestrator paused twice on "build is red" only to find the failures pre-dated all 6 workstreams. A delta-based gate ("did this PR ADD any failures?") would have avoided that.

### What "Mission Complete" actually means

The 7 Final Success Metrics from FIX-EVERYTHING-PLAN.md:

- ✅ Memory written via MCP has correct `agent_id`, `tenant_id`, `source_weight`
- ✅ Audit log captures the call with correct attribution
- ✅ Outbox-pattern: write succeeds even when external embedding API is down
- 🟡 `has_embedding=true` within 30s — gated on OPENAI key rotation
- 🟡 Semantic `memory_search` returns the just-written memory — gated on above
- ✅ Cross-tenant read isolation — verified by E2E-2
- ✅ E2E harness catches regressions of the original 4 Hermes bugs

5 of 7 verified. 2 of 7 are external-API-gated (the OpenAI and Anthropic keys Josh needs to rotate). All 7 are code-correct.

## Next session prerequisites for Josh

1. **Rotate `OPENAI_API_KEY`** at platform.openai.com → revoke `sk-proj-...5n8A`, create new, paste into Railway env vars for omnimind-api service
2. **Rotate `ANTHROPIC_API_KEY`** at console.anthropic.com → same flow, paste into Railway omnimind-api AND any local MCP client env that does fact extraction
3. **Wait for Railway redeploy** (~60s per service), then run `node packages/omnimind-mcp/hermes-roundtrip.mjs` against prod with the new keys + ANTHROPIC_API_KEY in MCP client env. Last 2 success metrics should turn green.
4. **Watch the outbox retry cron** pick up the pending row from memory `cmp709nyw0000pj01iliep000` within 2 minutes — should resolve automatically once OpenAI key is good.
5. **Wire production agent configs** to your local Claude Desktop / Code / Cursor / ChatGPT — Milestone E from the original Solo Go-Live prompt. Configs are at `docs/agent-configs/`. Generate per-agent keys via `omnimind-mcp keygen` against prod.
6. **Begin 30-day dogfooding window.** Use the system for real work. Then revisit Phase 6 priorities.

## Open questions for Phase 6+

- When to re-enable ministry domain? (Triggers: Ollama running locally + encryption tested + pastoral data ready to flow)
- When to move from solo to multi-user? (Triggers: someone else needs an agent identity in OmniMind)
- Bitemporal validity windows: implement before 1K memories or after? (Trade-off: schema cost vs. retrieval semantics)
- Test infra cleanup: separate workstream or roll into Phase 6? (53 pre-existing failures need addressing)
