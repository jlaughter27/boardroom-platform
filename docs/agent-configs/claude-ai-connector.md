# Claude.ai / Claude Desktop — custom connector to the hosted OmniMind MCP

Claude.ai, Claude Desktop, Cowork and the mobile apps share one connector list — remote connectors are configured and brokered through the Claude account — so this is done once per account. `claude_desktop_config.json` is a separate, local-server mechanism; for the hosted server it is needed only as the `mcp-remote` bridge in step 4 (or for the legacy stdio path in `claude-desktop.json`).

Dialog vocabulary below is from [claude.com/docs/connectors/custom/add-unlisted](https://claude.com/docs/connectors/custom/add-unlisted) (checked 2026-10-19). The layout varies by organization — name, URL and an *Advanced settings* disclosure on one screen, or two steps — but the choices are the same.

## Which path applies to you

| Server state (BoardRoom Settings shows it) | Claude.ai web / mobile | Claude Desktop |
|---|---|---|
| OAuth enabled (`OMNIMIND_MCP_OAUTH_ISSUER` set — runbook §9) | **Sign in** (step 3a) | Sign in (3a), or the token via *Request headers* / the bridge |
| OAuth not enabled, *Request headers* section visible in your dialog (beta, limited set of organizations) | Token via *Request headers* (3b) | Token via *Request headers* (3b) |
| OAuth not enabled, no *Request headers* section | **Cannot connect** — the server needs OAuth (runbook §9). Use Claude Code or Claude Desktop meanwhile. | `claude_desktop_config.json` `mcp-remote` bridge (step 4) |

## Steps

1. BoardRoom → **Settings → Connected AI tools** → *Create token* → client *Claude.ai* (or *Claude Desktop*), tenant (`josh-business` or `josh-personal`), scopes `memory:read` to start. Copy the `omt_…` value; it is shown once. (Skip this step for the OAuth path — no token is used there.)
2. Claude.ai → **Settings → Connectors → Add custom connector**
   - Name: `OmniMind`
   - Remote MCP server URL: `https://omnimind-mcp-production.up.railway.app/mcp` — exactly this; the URL must not redirect (Claude drops the `Authorization` header on cross-host redirects). Leave *Advanced > Transport* alone (a URL ending in `/sse` would select the deprecated SSE transport).
3. Authentication settings:
   - **3a. OAuth (server advertises an issuer):** Authentication **Sign in when needed**; OAuth client **Register automatically** (Dynamic Client Registration). Choose **Use Claude's published identity** only if the operator's identity provider supports Client ID Metadata Documents — Claude uses CIMD only when the authorization-server metadata advertises `client_id_metadata_document_supported: true` and `none` in `token_endpoint_auth_methods_supported`, and falls back to DCR otherwise. **Use your own OAuth client** is for a client ID the operator pre-registered (secret blank unless the issuer requires one). No token is needed: Claude reads `/.well-known/oauth-protected-resource`, finds the issuer and asks you to sign in when you first use the connector. OAuth sign-in is read-only (`memory:read`) until an admin widens the identity (`PATCH /mcp/identities/:id`, runbook §9.4); an `omt_` token carries exactly the scopes picked at minting.
   - **3b. Token via Request headers:** Authentication **No sign-in**. In the **Request headers** section choose header name `authorization` and enter the value `Bearer omt_…` — Claude sends the value exactly as entered and adds no scheme, so the `Bearer ` prefix is yours to type. Up to four headers; on an OAuth connection `authorization` cannot be a request header. **Request header authentication is in beta and available to a limited set of organizations: if you don't see the Request headers section in the Add custom connector dialog, your organization doesn't have access yet.** No plan guarantees it.
   - **Authentication settings cannot be edited after creation** (OAuth client and request headers alike). To change them, remove the connector and add it again.
4. **Claude Desktop without the beta and without OAuth:** skip the connector and merge this into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/claude/claude_desktop_config.json` (Linux). It bridges the hosted URL through `mcp-remote` as a local stdio server, so no dialog field is involved and the token carries its exact scopes:
   ```json
   { "mcpServers": { "omnimind": { "command": "npx", "args": ["-y", "mcp-remote", "https://omnimind-mcp-production.up.railway.app/mcp", "--header", "Authorization:Bearer omt_…"] } } }
   ```
   claude.ai web and mobile have no equivalent: without *Request headers* they need OAuth (runbook §9).
5. Add, then enable **OmniMind** in a chat via the tools (⚙/+) menu. The first call shows the tool list (20 tools; `search`/`fetch` are read-only and never prompt; writes prompt unless you allow them for the chat).
6. Verify: ask *"Call OmniMind status_get"* — you should get the composite snapshot for your user. Ask *"Search OmniMind for <a recent topic>"* — `memory_search` (or `search` in Research mode) returns your memories.

Claude Code on the same machine always works with a token, regardless of the connector dialog: `claude mcp add --transport http --scope user omnimind https://omnimind-mcp-production.up.railway.app/mcp --header "Authorization: Bearer omt_…"` (`claude-code.json`).

## Keeping it fresh

There is no push to Claude.ai. Put this in a **Project instruction** (or the start of a chat):

> Before answering anything about my plans, decisions, people, tasks or commitments, call OmniMind `status_get`, then `memory_search` for the topic. Log any decision we reach with `decision_log` (use an `idempotencyKey` if you retry). Do not rely on memory from earlier in the conversation when the question is about current state.

Research mode calls connector tools on its own without further approval — which is why the recommended first token is read-only.

## Network

Connections originate from Anthropic's cloud, not from your machine, and connectors are IPv4-only. The MCP host must be publicly reachable; if you front it with an allowlist, allow Anthropic's published egress ranges. `OMNIMIND_MCP_ALLOWED_HOSTS` on the server must contain the exact public host or every call returns `403 Invalid Host header` (the `/health` probe still passes, which is the tell). Claude follows the 2025-03-26, 2025-06-18 and 2025-11-25 authorization specs; a `401` is what starts sign-in (a `WWW-Authenticate` header on a `200` is ignored).

## Revoking

BoardRoom → Settings → Connected AI tools → *Revoke*. The token stops working immediately: OmniMind evicts its delegation cache synchronously and the MCP service fails the in-flight call, closes the session and answers `401` from then on (an idle client may keep an open session for up to 30 seconds, but every call on it fails). Remove or re-create the connector with a new token — a connector's request headers cannot be edited in place. Tokens also expire 365 days after minting unless created with `expiresInDays: null`. OAuth identities are revoked by the operator with `DELETE /mcp/identities/:id`.
