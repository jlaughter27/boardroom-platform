# Prompt Templates

**Audience:** Claude (or human) about to spawn a subagent or kick off a focused task.
**Purpose:** Reusable prompt scaffolds so we don't reinvent prompts every session.

---

## Template: Pick up a phase

```
You are picking up Phase {N} of the omnimind roadmap.

Read these files first:
1. /docs/STATUS/CURRENT-PHASE.md
2. /docs/roadmap/04-roadmap/PHASE-{N}-{name}/README.md
3. /docs/roadmap/04-roadmap/PHASE-{N}-{name}/tasks-and-prompts.md

Constraints (non-negotiable):
- ADR-001: no agent frameworks
- ADR-002: Anthropic-only LLM
- ADR-003: pgvector in Postgres only
- ADR-009: node-cron for background, no Redis
- CLAUDE.md rule 5: prompts live in docs/prompts/*.system.md
- CLAUDE.md rule 10: Zod schemas required for all LLM outputs

After completing each task:
- Run `npm run typecheck` and `npm run test`
- Update STATUS/CHANGELOG.md per the handoff template
- Move to the next task only when current is committed

If you hit a blocker, add it to STATUS/BLOCKERS.md and stop. Don't improvise.
```

## Template: Run a focused audit

```
You are auditing {scope} of the omnimind codebase.

Working directory: /Users/Joshua/windsurf boradroom test/boardroom-platform edit

Read these files first:
1. /docs/roadmap/02-current-state/CAPABILITIES-INVENTORY.md
2. /docs/roadmap/02-current-state/{relevant section}.md
3. The specific code files for {scope}

Deliver a report at /docs/STATUS/audit-{date}-{scope}.md with:
- Findings (severity-ranked)
- Concrete fixes (file paths + line numbers)
- Risks if not addressed (timeline)
- Cross-references to existing roadmap items where relevant

Do not modify code. This is audit-only.

Length: under 1500 words.
```

## Template: Spec a new feature

```
You are designing a feature for omnimind: {feature name}.

Context: {1-2 sentences on why}.

Read these files first:
1. /docs/roadmap/PROJECT-CONTEXT.md
2. /docs/roadmap/01-foundations/CONSTRAINTS.md
3. /docs/roadmap/05-features-to-10/FEATURE-INDEX.md (check no overlap)
4. {any existing related spec}

Deliver a feature spec at /docs/roadmap/05-features-to-10/{feature-slug}.md with:
- Problem (what user pain it solves)
- Approach (high-level design)
- Schema changes (if any)
- API surface
- Phases (if multi-step)
- Risks
- Success metrics
- Dependencies on other roadmap items

Length: 600-1200 words.
```

## Template: Multi-agent research wave

When you need depth on a question and have time/budget for multiple parallel agents:

```
Wave structure:
1. Researchers (3-5 agents, parallel) — each takes a different angle
2. Auditors (1-3 agents, parallel) — each audits a different aspect of current state
3. Synthesizers (1-2 agents, sequential) — combine findings
4. Reviewers (1-2 agents, parallel) — stress-test the synthesis
5. Final validator (1 agent) — produce operator-ready output

Each agent writes to a specific file path so subsequent agents can read prior work.
Each agent's prompt is self-contained (they don't see your conversation history).

Storage convention: docs/research/{topic-slug}/stage{N}-{stage-name}/{file}.md

See `docs/research/mem0-memory-architectures/` for a worked example.
```

## Template: End-of-session handoff (you, the calling Claude, write this)

```
Session summary:

Worked on: {phase / task}
Delivered: {bulleted list}
Tests: {green / failing / not run}
Commits: {list of commit hashes or "uncommitted"}
Open: {what's blocked or next}

Updated STATUS/:
- CHANGELOG.md (entry added)
- CURRENT-PHASE.md (if changed)
- DECISIONS-LOG.md (if any decisions made)
- BLOCKERS.md (if blockers added/removed)

Next session should: {1-2 sentence direction}
```
