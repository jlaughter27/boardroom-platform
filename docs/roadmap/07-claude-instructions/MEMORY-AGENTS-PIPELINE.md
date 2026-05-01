# Memory Agents Pipeline — How to Re-run the Audit

**Audience:** Claude (or human) considering re-running the multi-agent research/audit pipeline that produced this roadmap.
**Purpose:** Step-by-step instructions to reproduce or extend the original 18-agent pipeline.

---

## When to re-run the pipeline

| Trigger | Re-run scope |
|---|---|
| Major architectural shift (new ADR) | Full pipeline |
| New AI memory tech worth evaluating (e.g., new mem0 release) | Just researchers (Wave 1) |
| Suspected security vulnerability | Just security auditor (Wave 1, Auditor 1) |
| Phase exit criteria not met after attempted execution | Just one specific reviewer (Wave 3) |
| Quarterly health check | Audit agents (Wave 1, Auditors 1-4) |

---

## The original 18-agent structure

### Wave 1 (PARALLEL, ~10 min) — Research + Audit

| # | Agent | Output |
|---|---|---|
| R1 | Vector/embedding memory researcher | `docs/research/{topic}/stage1-research/01-vector-embeddings.md` |
| R2 | Graph-based memory researcher | `docs/research/{topic}/stage1-research/02-graph-memory.md` |
| R3 | Hierarchical/temporal memory researcher | `docs/research/{topic}/stage1-research/03-hierarchical-temporal.md` |
| R4 | Hybrid retrieval researcher | `docs/research/{topic}/stage1-research/04-hybrid-retrieval.md` |
| R5 | Agent framework patterns researcher | `docs/research/{topic}/stage1-research/05-agent-framework-patterns.md` |
| A1 | Current memory stack auditor | `docs/research/{topic}/stage2-audit/current-memory-stack-audit.md` |

For roadmap rebuild, ADD:
| A2 | Security auditor | `docs/research/{topic}/stage2-audit/security-audit.md` |
| A3 | Scalability auditor | `docs/research/{topic}/stage2-audit/scalability-audit.md` |
| A4 | Data integrity auditor | `docs/research/{topic}/stage2-audit/data-integrity-audit.md` |
| A5 | Code quality auditor | `docs/research/{topic}/stage2-audit/code-quality-audit.md` |

### Wave 2 (PARALLEL, ~10 min) — Builders

Each builder reads Wave 1 outputs + writes one section of the roadmap:

| # | Builder | Output folder |
|---|---|---|
| B1 | Current-state synthesizer | `docs/roadmap/02-current-state/` |
| B2 | Phase-folder builder | `docs/roadmap/04-roadmap/PHASE-*/` |
| B3 | Make-it-10 features specker | `docs/roadmap/05-features-to-10/` |
| B4 | Risk register builder | `docs/roadmap/06-risks-and-mitigations/` |
| B5 | Claude-instructions builder | `docs/_meta/` |
| B6 | References + research index builder | `docs/roadmap/03-research/` + `docs/roadmap/08-references/` |

### Wave 3 (PARALLEL, ~5 min) — Reviewers

| # | Reviewer | Checks |
|---|---|---|
| Rev1 | Completeness | Every known issue, landmine, mem0 need, eventual issue covered? |
| Rev2 | Consistency | Roadmap doesn't conflict with itself? Phases ordered correctly? Triggers measurable? |
| Rev3 | Executor-feasibility | Can future Claude actually execute from these docs cold? |

### Wave 4 (1 agent, ~5 min) — Final validator

Stitches inconsistencies, produces final master index, updates CLAUDE.md to point at the new roadmap.

---

## Tool-type pitfalls (learned the hard way)

- **Explore agents can't Write.** Use general-purpose for any agent that produces an artifact file. Save Explore for reads-only audits where the parent will save the output.
- **Plan agents can't Write either.** Same workaround.
- **Parallel agents racing on the same file.** Each agent must own a distinct path; use `stage{N}-{name}/` namespacing.
- **WebSearch/WebFetch can be permission-blocked.** Always include a fallback instruction: "if WebSearch is denied, fall back to training-cutoff knowledge but flag claims as unverified."
- **Synthesizer racing with the things it needs to synthesize.** Either run synthesizers sequentially, or have them poll for prerequisite files with a timeout.

---

## Cost estimate

Per Wave 1 agent: ~50-150k tokens (research + write).
Per Wave 2 agent: ~80-200k tokens (read multiple inputs + write).
Per Wave 3 agent: ~60-100k tokens.
Per Wave 4 agent: ~100-150k tokens.

Total for full pipeline: ~1.5-3M tokens. At 2026 Sonnet pricing ≈ $5-12.

---

## How to invoke

The parent Claude session orchestrates. Sample invocation pattern (pseudo-code):

```
1. Mark chapter
2. Update todos (one per wave)
3. Create directory structure for outputs
4. Wave 1: spawn 8-10 agents in single message, each with `run_in_background: true`
5. Wait for all completions (notifications come in)
6. Wave 2: spawn 6 builders in single message, references Wave 1 outputs
7. Wait for completions
8. Wave 3: spawn 3 reviewers in single message
9. Wait for completions
10. Wave 4: spawn final validator
11. Manual synthesis: present findings + update CLAUDE.md
```

See `../../_meta/PROMPT-TEMPLATES.md` for the per-agent prompt scaffolds.
