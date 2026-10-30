# Launch — one command from your machine

`scripts/launch.sh` (`pnpm launch -- …`) runs the Phase 8 M0 founder items and the existing go-live tooling in the only safe order, with a gate before every write. It is resumable: fix whatever stopped it and re-run with `--from <step>`.

| # | Step | What it does | Gate |
|---|---|---|---|
| 1 | `preflight` | tools present (railway, gh, docker, pg_dump 16+, psql, node, openssl), `railway whoami`, `gh auth status`, launch PR checks green | — |
| 2 | `backup` | **M0-F1** prod `pg_dump -Fc` → `backups/prod-<ts>.dump.gz` (gitignored, off-Railway) + sha256; `services/backup/restore-drill.sh` into a throwaway `pgvector/pgvector:pg16` container; drill row appended to `BACKUP-DRILLS.md`; read-only case-duplicate e-mail check (stops the launch if any) | confirm |
| 3 | `rotate` | **M0-F2** new `OMNIMIND_API_KEY` (api + app + mcp in one window), `JWT_SECRET` (logs everyone out), the new Anthropic/OpenAI keys you paste (hidden input or `NEW_ANTHROPIC_API_KEY` / `NEW_OPENAI_API_KEY`), `ENCRYPTION_KEY` only with `--rotate-encryption-key` (stored Google tokens become unreadable → reconnect Google). Verifies the old service key gets 401. | backup < 24 h, confirm |
| 4 | `protect` | **M0-F3** branch protection on `main` requiring the six CI checks; reads it back | confirm |
| 5 | `merge` | merges the launch PR (default #30, two additive migrations: `commitment_owed_by`, `decision_session_state`); Railway deploys it and runs them at boot | backup < 24 h, confirm |
| 6 | `verify` | **M0-F4** waits until `/health` on omnimind-api and boardroom-ai reports the merge sha | — |
| 7 | `mcp` | `scripts/mcp-go-live.sh` — third Railway service, gateway agent, tenant owners, first token, §7 checks | backup < 24 h |
| 8 | `prod-check` | `scripts/verify-prod.sh` against all three services | — |

```bash
railway login && gh auth login          # once
pnpm launch -- --project <railway project id> --owner-email <your login e-mail> --dry-run   # read the plan
pnpm launch -- --project <railway project id> --owner-email <your login e-mail>             # do it
```

The script prints a summary table and a **Still yours** list (revoke the old model keys at the providers, Railway "wait for CI", `OMNIMIND_REQUIRE_AGENT_KEY=true` once the gateway is the only MCP writer, …). Paste the table into `docs/STATUS/CHANGELOG.md` and commit the `BACKUP-DRILLS.md` row.

## From an assistant on your machine (Desktop Commander, Claude Desktop, `claude remote-control`)

An assistant can run steps 1, 2 and 4–8 for you: `pnpm launch -- --project … --owner-email … --yes --from preflight` (non-interactive needs `--yes`). **Run step 3 (`--only rotate`) in your own terminal**, so the new API keys are typed into a hidden prompt and never pass through a chat transcript. Without a terminal and without `NEW_*` variables the script rotates only the generated secrets and lists the model keys under *Still yours*.

## Safety

- Nothing is written to production before a successful dump **and** restore drill (steps 3, 5 and 7 refuse without one from the last 24 h).
- Secrets are never printed: values are redacted in every log line; the dump holds personal data — keep a second, encrypted, off-Railway copy.
- `--dry-run` calls nothing (the go-live and verify scripts run in their own dry-run modes).
