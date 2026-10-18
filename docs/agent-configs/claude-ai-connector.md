# Claude.ai / Claude Desktop — custom connector to the hosted OmniMind MCP

Claude.ai and Claude Desktop share one connector list, so this is done once per account. No `claude_desktop_config.json` edit is needed for the hosted server (that file is only for the legacy stdio path in `claude-desktop.json`).

## Steps

1. BoardRoom → **Settings → Connected AI tools** → *Create token* → label `claude-ai`, tenant (`josh-business` or `josh-personal`), scopes `memory:read` to start. Copy the `omt_…` value; it is shown once.
2. Claude.ai → **Settings → Connectors → Add custom connector**
   - Name: `OmniMind`
   - Remote MCP server URL: `https://omnimind-mcp-production.up.railway.app/mcp`
   - *Advanced settings*:
     - **Token mode:** header `Authorization: Bearer omt_…` (fixed header credential; no OAuth client ID or secret). Needs a plan that allows custom connectors (Pro, Max, Team, Enterprise).
     - **OAuth mode** (server has `OMNIMIND_MCP_OAUTH_*` set — runbook §6): leave the credential fields empty. Claude reads `/.well-known/oauth-protected-resource`, finds the issuer and registers itself with a **Client ID Metadata Document** (Claude prefers CIMD; it only falls back to dynamic registration when the issuer does not advertise `client_id_metadata_document_supported`). Pre-registered client id/secret can be pasted here when the issuer only supports static clients.
3. Save, then enable **OmniMind** in a chat via the tools (⚙/+) menu. The first call shows the tool list (20 tools; `search`/`fetch` are read-only and never prompt; writes prompt unless you allow them for the chat).
4. Verify: ask *"Call OmniMind status_get"* — you should get the composite snapshot for your user. Ask *"Search OmniMind for <a recent topic>"* — `memory_search` (or `search` in Research mode) returns your memories.

## Keeping it fresh

There is no push to Claude.ai. Put this in a **Project instruction** (or the start of a chat):

> Before answering anything about my plans, decisions, people, tasks or commitments, call OmniMind `status_get`, then `memory_search` for the topic. Log any decision we reach with `decision_log` (use an `idempotencyKey` if you retry). Do not rely on memory from earlier in the conversation when the question is about current state.

Research mode calls connector tools on its own without further approval — which is why the recommended first token is read-only.

## Network

Connections originate from Anthropic's cloud, not from your machine. The MCP host must be publicly reachable; if you front it with an allowlist, allow Anthropic's published egress ranges. `OMNIMIND_MCP_ALLOWED_HOSTS` on the server must contain the exact public host or every call returns `403 Invalid Host header` (the `/health` probe still passes, which is the tell).

## Revoking

BoardRoom → Settings → Connected AI tools → *Revoke*. Claude's next new session gets `401` within about a minute (the MCP service caches a positive token check for 60 s); remove or re-create the connector with a new token.
