# Current Phase

**Phase in flight:** MCP Phase 2 — Wire Agents (NEXT)
**Active task (within current phase):** Phase 1 complete — awaiting Phase 2 kickoff
**Last update:** 2026-05-09
**Updated by:** Claude (MCP Phase 1 execution session)

---

## What's actively being worked on

MCP Phase 1 (core tools + fact extractor) shipped. Branch `claude/build-memory-layer-IftGo` contains:
- `packages/omnimind-mcp` — new package with 15 MCP tools, stdio + HTTP transports, keygen CLI
- Schema: `Tenant`, `Agent`, `McpAuditLog` models; `MemoryEntry` extended with `agentId`, `tenantId`, `embeddingModel`
- Hybrid embeddings: Ollama for `domain=ministry`, OpenAI for everything else
- Forgetting curve in structured-filter; sourceWeight multiplier in ranker
- 43 tests passing, full monorepo typecheck + build green

**Dev plan:** `docs/MEMORY-LAYER-DEV-PLAN.md`

## Next 5 actions for Phase 2 (Wire Agents)

1. **Run `keygen` for all 6 agents** — store keys in 1Password, update Agent table
2. **Write `docs/MEMORY-PROTOCOL.md`** — how agents should use each tool, when to write vs. search
3. **Write `docs/agent-configs/claude-desktop.json`** — MCP config block for Claude Desktop
4. **Write `docs/agent-configs/SMOKE-TESTS.md`** — manual verification checklist per agent
5. **Update `.claude/CLAUDE.md`** — add Memory Layer section with dogfooding rules

Gate for Phase 2: all 6 agents authenticate + cross-agent read verified + scope enforcement verified.

**Wait for 1 week of real usage before Phase 3** (tool descriptions will need tuning from actual behavior).


