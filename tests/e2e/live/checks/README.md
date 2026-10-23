# Journey checks

Every `*.mjs` file in this directory runs as one step of the live-stack journey
(`pnpm e2e:live`, which is `node tests/e2e/live/journey.mjs`). Lanes that need a journey
assertion add a **new file here**; they don't edit `journey.mjs` (Phase 8 file-ownership rules).

## Contract

A check default-exports an object:

```js
export default {
  name: 'what this asserts, in a few words',   // shown in the step line and results.json
  browsers: ['chromium'],                       // optional; default: every engine (chromium, webkit)
  async run({ page, browser, user, api, mcp, metrics }) {
    // throw to fail; the return value (if any) is logged as the step's detail
  },
};
```

| Field | What it is |
|---|---|
| `page` | A **fresh** Playwright page in the journey's browser context, so it is signed in as the journey user. Closed after the check. Its console errors and API requests feed the journey's shared logs. |
| `browser` | `'chromium'` or `'webkit'`, from `--browser`. |
| `user` | `{ id, email }` of the journey user. |
| `api` | `{ app, omnimind, request }`: the BoardRoom origin, the OmniMind origin, and `page.request` (it sends the journey's auth cookie). |
| `mcp` | `{ url, sessionId, call(method, params, opts?) }`. `call` sends JSON-RPC on the journey's open MCP session with the minted `omt_` token, and resolves `{ status, body, sessionId }`. |
| `metrics` | `{ out, shot(name), results, fanout(sinceMs), refused(sinceMs), consoleErrors }`. `shot` writes `<out>/<name>.png`. `fanout`/`refused` list BoardRoom API requests and 429s since a `Date.now()` timestamp. |

## When checks run

The journey runs the checks in file-name order after the MCP golden path and the
cross-client visibility steps, and **before** the token is revoked. The `omt_` token and
the MCP session are live while checks run. After the checks, the journey revokes the
token and then asserts that the run had no uncaught page errors.

- A failing check is recorded as `×` and the next check still runs. The journey exits 1.
- If a module fails to import, or its default export has no `run` function, it is a
  **failed** step. It is never silently dropped.
- If a check's `browsers` list excludes the current engine, the check is recorded as
  `skipped` in the output and in `results.json` (`ok: null, skipped: true`). A skipped
  check never counts as passed.

## Rules

- Keep the check independent. Create the data it needs through `api.request`, don't rely
  on another check's leftovers, and don't revoke the journey token.
- Never print a secret. Redact `omt_`/`omk_` values (`token.slice(0, 8)` is the
  convention).
- A check that needs an LLM must work without one by default (see `cls.mjs`, which replays
  a recorded stream; `E2E_REAL_DISPATCH=1` opts into the live server).
- A check may also run on its own. `cls.mjs --standalone` serves `client/dist` with the
  visual-preview mock API.

## Running

```bash
node tests/e2e/live/journey.mjs --dry-run                    # lists and validates every check; launches nothing
node tests/e2e/live/journey.mjs --browser webkit --dry-run   # same, for WebKit (says if the engine is installed)
pnpm e2e:live                                                # the full journey (stack setup: ../README.md)
pnpm e2e:live -- --browser webkit                            # WebKit (pnpm exec playwright install webkit first)
```

`playwright` is a root devDependency, pinned to the version whose Chromium build the
sandbox ships. `PLAYWRIGHT_MODULE_PATH` overrides where it is resolved from.

| File | Owner | Asserts |
|---|---|---|
| `smoke.mjs` | Lane A (M1-A3) | The sample check: BoardRoom `/health` and `/ready`, the signed-in page renders, MCP `ping` works. |
| `cls.mjs` | Lane C (M1-C1) | CLS ≤ 0.05 during a persona dispatch. |
| `vault-import.mjs` | Tooling lane (RD-7) | The vault flow on the synthetic vault in `tests/fixtures/vault/` (answer key `expected.json`): the importer CLI puts every importable note in `josh-business` exactly once (ministry + plumbing absent), writes the wikilinks, `GET /graph` draws them as memory→memory edges with only the unlinked notes orphaned, a keyword and a natural-language question each find their note in the top 3 (and MCP `memory_search` in the journey), and a second run writes nothing. Needs `OMNIMIND_API_KEY` (the importer's service key). CI runs it with `--standalone` in the `e2e` job (OmniMind + BoardRoom only, ~2 min). |

`vault-import.mjs --standalone` registers its own user through BoardRoom and needs only
OmniMind and BoardRoom (`BOARDROOM_URL`, `OMNIMIND_URL`, `OMNIMIND_API_KEY`); see the
"Vault flow" steps of the `e2e` job in `.github/workflows/ci.yml` for the exact bring-up.
