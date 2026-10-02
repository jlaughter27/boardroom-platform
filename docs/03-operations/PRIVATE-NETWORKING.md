# Railway private networking — BoardRoom → OmniMind

Today `OMNIMIND_API_URL` points at OmniMind's **public** domain, so every
persona call leaves Railway, crosses the internet and comes back through the
proxy (TLS + an extra hop), and the API has a public surface it does not need.
Railway's private network removes both.

## Target state

| Setting | Value |
|---|---|
| BoardRoom `OMNIMIND_API_URL` | `http://omnimind-api.railway.internal:3333` (**http**, not https — the private network is unencrypted-by-design inside the project) |
| OmniMind bind address | `::` (IPv6 — Railway's private network is IPv6-only; `app.listen(port, '::')` in `index.ts`, Phase 6 A1) |
| OmniMind port | the injected `PORT`; the hostname above uses `3333` only if `PORT` is 3333 — check *Settings → Networking → Private* for the real port, or set `PORT=3333` explicitly on the service |
| Both services | same Railway project + environment (private DNS is per environment) |

`omnimind-api.railway.internal` is derived from the service name; rename the
service and the hostname changes.

## Rollout (5 minutes, zero downtime)

1. Confirm OmniMind binds `::` — Railway deploy log shows `OmniMind API running on port …`; from BoardRoom's shell (`railway shell` / service terminal) run
   `curl -s http://omnimind-api.railway.internal:3333/health` and expect `{"status":"ok",…}`.
   If this times out the bind is still `0.0.0.0` (IPv4 only) or the port differs.
2. On the BoardRoom service set `OMNIMIND_API_URL=http://omnimind-api.railway.internal:3333`.
   Railway redeploys BoardRoom; OmniMind is untouched.
3. Open the app, run one session; check BoardRoom logs for `omnimind` request
   latencies (they should drop by ~20–60 ms per call) and no `ECONNREFUSED`/`ENOTFOUND`.
4. Optional hardening once stable for a week: remove OmniMind's public domain
   (*Settings → Networking → Public*). Keep it until the MCP server
   (`packages/omnimind-mcp`) is also running inside Railway or has another path
   in — external MCP clients (Claude Desktop, Cursor) reach OmniMind over the
   public URL today.

## Rollback

Set `OMNIMIND_API_URL` back to `https://omnimind-api-production.up.railway.app`
on BoardRoom and redeploy. Nothing else changed. The circuit breaker in
`omnimind-client.ts` (`OMNIMIND_BREAKER_*`) will already have opened if the
private host was unreachable; it closes itself after the cooldown.

## Gotchas
- `https://…railway.internal` will fail the TLS handshake: use `http`.
- `localhost`/`127.0.0.1` inside a service never reaches another service.
- Health checks from Railway itself still use the public port; keep `/health` public and unauthenticated.
- The e2e harness and docker-compose files use container names, not `railway.internal`; nothing to change there.
