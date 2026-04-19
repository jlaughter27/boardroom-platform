# Success Metrics

**Audience:** Claude or human deciding whether a phase is "done" or whether to advance to the next phase.
**Purpose:** Quantify "done" so we don't ship vibes.

---

## Per-phase exit criteria summary

Full criteria live in each `04-roadmap/PHASE-*/README.md`. This is the dashboard view.

| Phase | Single-line exit criterion | Hard metric |
|---|---|---|
| 0. Foundation cleanup | Clean `git status`, dead code dropped, log drain wired | typecheck + 708 tests green |
| 0.5. Eval harness | 35 hand-labeled queries with MRR/nDCG/P@5 baseline committed | non-regression check in `pre-deploy-check.sh` |
| 1. Schema alignment | 4 new entity tables, bi-temporal-lite cols on 6 link tables, `memoryType` enum | 708+ tests still green; new Zod schemas in shared |
| 2. Pattern extraction + write loop | Pattern extractor running async post-write; ADD/UPDATE/DELETE/NOOP deterministic; `MemoryWriteEvent` durability | Eval harness unchanged when flag off |
| 3. HNSW + RRF | HNSW index live; RRF A/B-tested vs. weighted fusion | Winner documented in `docs/eval-results/phase-3.md` |
| 4. Graph traversal | `findRelatedEntities(id, hops=2)` working over existing typed link tables | New endpoint test green; query <500ms p95 |
| 5a. LLM augmentation | Nightly cortex job produces extracted entities + relationships under cost cap | $/user/month within $2 cap; per-100-pair precision ≥0.6 |
| 5b. LLM consolidation | Boundary-case Haiku check on UPDATE/NOOP; idempotent replay | Replay key prevents double-write |
| 6. Entity ranker boost | 5th signal added to `ranker.ts` behind flag | Eval harness shows ≥3% lift on multi-entity slice OR no regression overall |
| 7a. Recency/access refinement | Exp-decay recency + log access count in ranker | Eval harness validates |
| 7b. Outcome feedback (DEFERRED) | Resume when `Decision.outcome` populated on ≥200 decisions AND `MemoryCitation` exists | Trigger named |
| 8. Reranker (DEFERRED) | Resume when eval MRR <0.6 AND Railway ≥4GB RAM AND 24h soak passes | Trigger named |
| 9. Purge `_disabled/` | Three ADRs written (014, 015, 016); `_disabled/` deleted | `rg -l _disabled` returns nothing |
| 10. MCP server | Memory MCP exposing read/write per `05-features-to-10/memory-mcp-server.md` | Working from Claude Desktop end-to-end |
| 11. Markdown export | `.md` files generated per Decision/Project/Goal/Memory in synced git repo | Round-trip (export → reimport) preserves data |
| 12. Webhooks + event bus | `MemoryWriteEvent` + entity events POSTed to user-registered URLs with HMAC + retries | Test webhook receiver gets event within 5s of write; signature verifies |
| 13. SDK | Public TS SDK around HTTP API | Published to npm, integration test green |
| 14. Observability | Metrics + tracing + alerting beyond health checks | p50/p99 latency dashboards live; alert on queue lag |
| 15. Migration history | Baseline migration + `prisma migrate deploy` | `--accept-data-loss` removed from entrypoint |
| 16. Cortex isolation | Cortex moves to separate Railway service | API event loop unaffected by cortex spikes |
| 17. Persona marketplace (optional) | Git-installable signed personas; install endpoint + sigstore | Test persona installs from a public repo; tool-allowlist enforced |
| 18. Resilience + multitenant fairness | Per-tenant token budget, Postgres-backed rate limiter, real RLS on user-scoped tables | Synthetic abuse user blocked at cap; rate limit survives redeploy |
| 19. Horizontal API scale | API runs N replicas safely (cron isolated, sticky SSE, shared breaker, PgBouncer in path) | Two replicas serve traffic; cron does not double-fire; SSE survives replica swap |

## Cross-cutting quality gates

These apply to every phase:

| Gate | Threshold |
|---|---|
| Typecheck | All packages green (`npm run typecheck`) |
| Test pass rate | ≥99% (currently 708/708) |
| Coverage | ≥80% per CLAUDE.md |
| Eval harness regression | None on standard queries; lift OR neutrality on phase-specific slice |
| LLM cost | Within phase-specific cap; global $50/day max during rollout |
| p95 retrieval latency | ≤300ms (current ~200ms; Phase 8 reranker would target +50ms) |
| Memory queue lag | <5 minutes p95 |
| Deploy success | Auto-deploy to Railway green; health check 200 within 60s |

## Product-level metrics (for the user, not for individual phases)

| Metric | Today | 6mo target | 12mo target |
|---|---|---|---|
| Active users | <100 | 500 | 2000 |
| Memories per user (p50) | ~50? unknown | 500 | 2000 |
| Persona response satisfaction (eval-based proxy) | unmeasured | establish baseline | +10% |
| LLM spend per user per month | unmeasured | <$5 | <$3 (efficiency wins) |
| Retrieval p95 | unmeasured | <300ms | <200ms with reranker on |
| Cortex job success rate | unmeasured | >99% | >99.5% |
| Uptime | unmeasured | 99.5% | 99.9% |

The first action of Phase 0.5 is to start measuring these. Until then, every "did we improve?" claim is vibes.
