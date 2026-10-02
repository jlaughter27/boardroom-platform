# _disabled — quarantined (not compiled, not tested)

Modules that were dead/unwired at audit time (AUDIT-2026-10-02, B-114). Kept
rather than deleted per CLAUDE.md rule 1 ("never delete working code to
simplify — add alongside, deprecate later"). This directory is excluded from
`server/tsconfig.json` and the vitest `include` glob does not reach it.

| Module | Why quarantined |
|---|---|
| `services/streaming-quality.service.ts` | Never imported. |
| `services/llm-quality-scorer.service.ts` | Never imported; hardcodes `claude-3-haiku-20240307` + inline prompt (would violate rules 5/8 if wired). |
| `services/cost-tracker.ts` | Never imported. |
| `services/prompt-cache.ts` | Never imported; its test fixture uses a pre-Phase-1 `PersonaResponse` shape. |
| `services/commitment-tracker.ts` | Never imported. |
| `transcription/deepgram-proxy.ts` | Never imported (the live path is `services/transcription.service.ts`). |
| `tests/*.test.ts` | Unit tests for the above, moved with them (import paths adjusted). |

To revive one: move it back, wire it, re-add its test under `server/tests/`.
