// Lane C — install snippets for every supported AI client.
//
// Single source of truth for the "Connected AI tools" panel. Lane E's docs
// (docs/runbooks/omnimind-mcp.md §6, docs/agent-configs/*) mirror these
// templates, so keep each client's config format here, not in the React
// components. Pure functions only — no React, no I/O.
//
// What each client's connector dialog accepts was verified against the
// vendors' own documentation on 2026-10-19 (claude.com/docs/connectors,
// code.claude.com, the gemini-cli / vscode-docs / zed source repos; ChatGPT,
// Cursor and Windsurf from vendor pages quoted by third parties):
//   * claude.ai / Claude Desktop — one shared "Add custom connector" dialog.
//     Authentication: "Sign in now" / "Sign in when needed" / "No sign-in";
//     OAuth client: "Use Claude's published identity" (CIMD) / "Register
//     automatically" (DCR) / "Use your own OAuth client". A "Request headers"
//     section (header name `authorization`, value sent verbatim, up to four
//     headers) exists but is a beta for a limited set of organizations.
//     Authentication settings cannot be edited after creation.
//   * ChatGPT — developer-mode connectors offer OAuth or "No authentication"
//     only. There is no header / API-key field, so a personal token is never
//     usable from ChatGPT; only the OAuth resource-server mode works.
// Both branch on `oauthEnabled` (from /mcp/tokens/connect-info) and show the
// OAuth path first when the server advertises an issuer.

export type McpClientId =
  | 'claude-ai'
  | 'claude-desktop'
  | 'claude-code'
  | 'chatgpt'
  | 'cursor'
  | 'windsurf'
  | 'gemini-cli'
  | 'vscode-copilot'
  | 'zed'
  | 'other';

export interface McpClientMeta {
  id: McpClientId;
  label: string;
  /** Default token name offered in the create form. */
  defaultName: string;
  /** Short hint rendered under the client picker. */
  hint: string;
}

export const MCP_CLIENTS: readonly McpClientMeta[] = [
  { id: 'claude-ai', label: 'Claude.ai', defaultName: 'Claude.ai', hint: 'Custom connector in claude.ai Settings — OAuth sign-in, or a Request header where your organization has that beta' },
  { id: 'claude-desktop', label: 'Claude Desktop', defaultName: 'Claude Desktop', hint: 'Same connector dialog as claude.ai, or a claude_desktop_config.json bridge' },
  { id: 'claude-code', label: 'Claude Code', defaultName: 'Claude Code', hint: 'One terminal command' },
  { id: 'chatgpt', label: 'ChatGPT', defaultName: 'ChatGPT', hint: 'Developer-mode connector — OAuth only (the dialog has no header field)' },
  { id: 'cursor', label: 'Cursor', defaultName: 'Cursor', hint: '.cursor/mcp.json or one-click deeplink' },
  { id: 'windsurf', label: 'Windsurf', defaultName: 'Windsurf', hint: 'mcp_config.json' },
  { id: 'gemini-cli', label: 'Gemini CLI', defaultName: 'Gemini CLI', hint: 'gemini mcp add, or ~/.gemini/settings.json' },
  { id: 'vscode-copilot', label: 'GitHub Copilot (VS Code)', defaultName: 'VS Code Copilot', hint: '.vscode/mcp.json (token prompted, not stored in the file)' },
  { id: 'zed', label: 'Zed', defaultName: 'Zed', hint: 'settings.json context_servers (native remote server)' },
  { id: 'other', label: 'Other (Streamable HTTP)', defaultName: 'MCP client', hint: 'Any client that speaks Streamable HTTP' },
] as const;

export const MCP_SERVER_NAME = 'omnimind';

/** Placeholder used when the operator has not configured OMNIMIND_MCP_PUBLIC_URL. */
export const MCP_URL_PLACEHOLDER = 'https://<your-omnimind-mcp-host>/mcp';

/** Operator runbook for the MCP server (OAuth issuer, public URL, gateway). */
export const MCP_RUNBOOK_PATH = 'docs/runbooks/omnimind-mcp.md';

/** Where the OAuth recipe lives; quoted in every "this needs OAuth" sentence. */
export const MCP_OAUTH_RUNBOOK_REF = `${MCP_RUNBOOK_PATH} §9`;

/**
 * Revocation is immediate for data access: OmniMind evicts its delegation cache
 * synchronously and the MCP server fails the in-flight call (PRINCIPAL_REVOKED),
 * evicts the credential and closes the session. Only an idle client that makes
 * no calls keeps a session for up to OMNIMIND_MCP_PRINCIPAL_CACHE_MS (30 s).
 */
export const MCP_REVOKE_NOTE = 'Revoke the token from this page at any time; it stops working immediately (an idle client may keep an open session for up to 30 seconds, but every call on it fails).';

/**
 * Shared on every client: the MCP URL must be the final URL. Claude drops the
 * Authorization header when a redirect crosses hosts, and ChatGPT reports
 * "Session terminated" on a /mcp → /mcp/ 307. Our server answers both spellings
 * directly, so no proxy or custom domain in front of it may add a redirect.
 */
export const MCP_NO_REDIRECT_NOTE =
  'Use the server URL exactly as shown and make sure nothing redirects it (no /mcp → /mcp/ 307): Claude drops the Authorization header on cross-host redirects and ChatGPT reports "Session terminated". This server answers both /mcp and /mcp/ directly.';

/** Environment variable name used in the "keep the token out of the file" examples. */
export const MCP_TOKEN_ENV_VAR = 'OMNIMIND_TOKEN';

export interface SnippetInput {
  mcpUrl: string;
  token: string;
  /** True when the server advertises an OAuth issuer (OMNIMIND_MCP_OAUTH_ISSUER). */
  oauthEnabled?: boolean;
}

export interface SnippetBlock {
  label: string;
  language: 'bash' | 'json' | 'text';
  code: string;
}

export interface McpSnippet {
  clientId: McpClientId;
  title: string;
  /** Numbered steps to show above the code blocks (for GUI clients). */
  steps: string[];
  blocks: SnippetBlock[];
  /** Footnotes under the blocks. */
  notes: string[];
}

export function getClientMeta(id: McpClientId): McpClientMeta {
  return MCP_CLIENTS.find((c) => c.id === id) ?? MCP_CLIENTS[MCP_CLIENTS.length - 1];
}

/**
 * Best-effort client inference for existing tokens (the record has no client
 * field — the client only drives the snippet + default name at create time).
 * Longer labels are tested first so "Claude Desktop" wins over "Claude".
 */
export function inferClientFromName(name: string): McpClientId | null {
  const n = name.toLowerCase();
  const ordered: Array<[McpClientId, string[]]> = [
    ['vscode-copilot', ['vs code', 'vscode', 'copilot']],
    ['claude-desktop', ['claude desktop']],
    ['claude-code', ['claude code']],
    ['claude-ai', ['claude.ai', 'claude ai', 'claude']],
    ['gemini-cli', ['gemini']],
    ['chatgpt', ['chatgpt', 'openai']],
    ['windsurf', ['windsurf', 'codeium']],
    ['cursor', ['cursor']],
    ['zed', ['zed']],
  ];
  for (const [id, needles] of ordered) {
    if (needles.some((needle) => n.includes(needle))) return id;
  }
  return null;
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

function json(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

function base64Utf8(s: string): string {
  // btoa only handles Latin-1; tokens and URLs are ASCII but be defensive.
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

/** Cursor's one-click install deeplink (config = base64 of the server object). */
export function cursorDeeplink(mcpUrl: string, token: string): string {
  const config = base64Utf8(JSON.stringify({ url: mcpUrl, headers: { Authorization: bearer(token) } }));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(MCP_SERVER_NAME)}&config=${encodeURIComponent(config)}`;
}

/**
 * The Claude Code one-liner. `--scope user` stores it in ~/.claude.json for
 * every project; the default (local) scope would load it in one project only.
 */
export function claudeCodeCommand(mcpUrl: string, token: string): string {
  return `claude mcp add --transport http --scope user ${MCP_SERVER_NAME} ${mcpUrl} --header "Authorization: ${bearer(token)}"`;
}

/** Gemini CLI's one-liner (`--scope user` → ~/.gemini/settings.json; the default is the project). */
export function geminiCliCommand(mcpUrl: string, token: string): string {
  return `gemini mcp add --transport http --scope user --header "Authorization: ${bearer(token)}" ${MCP_SERVER_NAME} ${mcpUrl}`;
}

/** claude_desktop_config.json entry that bridges the hosted URL through mcp-remote (no connector dialog involved). */
export function claudeDesktopBridgeConfig(mcpUrl: string, token: string): string {
  return json({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: 'npx',
        args: ['-y', 'mcp-remote', mcpUrl, '--header', `Authorization:${bearer(token)}`],
      },
    },
  });
}

export function buildSnippet(clientId: McpClientId, input: SnippetInput): McpSnippet {
  const { mcpUrl, token } = input;
  const oauthEnabled = input.oauthEnabled === true;
  const auth = bearer(token);
  const headerBlock: SnippetBlock = {
    label: 'Header',
    language: 'text',
    code: `Authorization: ${auth}`,
  };
  const urlBlock: SnippetBlock = { label: 'Server URL', language: 'text', code: mcpUrl };
  const revokeNote = MCP_REVOKE_NOTE;
  const redirectNote = MCP_NO_REDIRECT_NOTE;
  const oauthReadOnlyNote = 'OAuth sign-in grants read-only access (memory:read) by default; this token carries exactly the scopes you picked.';

  switch (clientId) {
    case 'claude-code':
      return {
        clientId,
        title: 'Claude Code',
        steps: ['Run this in a terminal. --scope user stores the server in ~/.claude.json for every project; without it the default local scope loads it in the current project only.'],
        blocks: [
          {
            label: 'Terminal',
            language: 'bash',
            code: claudeCodeCommand(mcpUrl, token),
          },
        ],
        notes: [
          'Check with `claude mcp list`; the server should report as connected.',
          `To keep the token out of a committed .mcp.json, write "headers": { "Authorization": "Bearer \${${MCP_TOKEN_ENV_VAR}}" } with "type": "http" and export ${MCP_TOKEN_ENV_VAR} in your shell — Claude Code expands \${VAR} in url and headers (pick a name like ${MCP_TOKEN_ENV_VAR}; credential-looking names such as ANTHROPIC_AUTH_TOKEN are read as empty there).`,
          redirectNote,
          revokeNote,
        ],
      };

    case 'claude-ai':
    case 'claude-desktop': {
      const isDesktop = clientId === 'claude-desktop';
      const where = isDesktop ? 'Claude Desktop' : 'claude.ai';
      const requestHeaderBlock: SnippetBlock = {
        label: 'Request header value (header name: authorization — Claude sends the value verbatim, so include "Bearer ")',
        language: 'text',
        code: auth,
      };
      const desktopConfigBlock: SnippetBlock = {
        label: 'Or claude_desktop_config.json — mcp-remote bridge, works whether or not your organization has the Request headers beta',
        language: 'json',
        code: claudeDesktopBridgeConfig(mcpUrl, token),
      };
      const openStep = isDesktop
        ? 'Open Claude Desktop → Settings → Connectors → Add custom connector. Remote connectors are configured through your Claude account, so this is the same dialog and the same connector list as claude.ai.'
        : 'Open claude.ai → Settings → Connectors → Add custom connector.';
      const nameStep = 'Name it "OmniMind" and paste the server URL below. The dialog layout varies by organization: either name, URL and an "Advanced settings" disclosure on one screen, or two steps that ask for the settings below.';
      const requestHeadersBeta = 'The "Request headers" section is in beta for a limited set of organizations: if you don\'t see Request headers in the Add custom connector dialog, your organization doesn\'t have it yet.';
      const cannotEditStep = 'Add the connector, then enable it in a chat from the tools menu. Authentication settings (OAuth client and request headers) cannot be edited after creation — to change them, remove the connector and add it again.';

      if (oauthEnabled) {
        return {
          clientId,
          title: where,
          steps: [
            openStep,
            nameStep,
            'Authentication: choose "Sign in when needed". OAuth client: choose "Register automatically" (Dynamic Client Registration); choose "Use Claude\'s published identity" only if the operator\'s identity provider supports Client ID Metadata Documents (see the runbook). Leave "Use your own OAuth client" alone unless the operator gave you a client ID. No token is needed on this path — this server advertises OAuth and Claude asks you to sign in when you first use the connector.',
            'Prefer this token instead? Only if the dialog shows a "Request headers" section: choose "No sign-in", add a header named authorization and paste the value below (up to four headers; on an OAuth connection authorization cannot be a request header). ' + requestHeadersBeta,
            cannotEditStep,
          ],
          blocks: isDesktop ? [urlBlock, requestHeaderBlock, desktopConfigBlock] : [urlBlock, requestHeaderBlock],
          notes: [
            oauthReadOnlyNote,
            ...(isDesktop ? ['The claude_desktop_config.json entry bypasses the connector dialog entirely (stdio bridge via mcp-remote) and carries this token with its exact scopes.'] : []),
            redirectNote,
            revokeNote,
          ],
        };
      }

      const noBetaStep = isDesktop
        ? `If you don't see Request headers, your organization doesn't have the beta yet. Skip the connector and add the claude_desktop_config.json entry below instead — it bridges the hosted URL through mcp-remote and works regardless of the beta.`
        : `If you don't see Request headers, your organization doesn't have the beta yet. claude.ai then has no way to send this token: the server needs OAuth, which the operator enables with OMNIMIND_MCP_OAUTH_ISSUER (${MCP_OAUTH_RUNBOOK_REF}); this page switches to the sign-in steps once that is live. Until then use Claude Code (claude mcp add) or Claude Desktop (claude_desktop_config.json bridge) with this token.`;

      return {
        clientId,
        title: where,
        steps: [
          openStep,
          nameStep,
          'Authentication: choose "No sign-in". In the "Request headers" section add a header named authorization and paste the value below (Claude sends it verbatim, so it must start with "Bearer "). Leave the OAuth client options alone.',
          noBetaStep,
          cannotEditStep,
        ],
        blocks: isDesktop ? [urlBlock, requestHeaderBlock, desktopConfigBlock] : [urlBlock, requestHeaderBlock],
        notes: [
          requestHeadersBeta,
          'OAuth is not enabled on this server yet.',
          redirectNote,
          revokeNote,
        ],
      };
    }

    case 'cursor':
      return {
        clientId,
        title: 'Cursor',
        steps: [
          'Add this to .cursor/mcp.json in your project (or ~/.cursor/mcp.json for all projects):',
        ],
        blocks: [
          {
            label: '.cursor/mcp.json',
            language: 'json',
            code: json({ mcpServers: { [MCP_SERVER_NAME]: { url: mcpUrl, headers: { Authorization: auth } } } }),
          },
          { label: 'Or open this one-click install link', language: 'text', code: cursorDeeplink(mcpUrl, token) },
        ],
        notes: [
          'Cursor → Settings → MCP shows the server; toggle it on if it is listed as disabled.',
          `To keep the token out of the file, write "Authorization": "Bearer \${env:${MCP_TOKEN_ENV_VAR}}" and export ${MCP_TOKEN_ENV_VAR} — Cursor resolves \${env:NAME} in url and headers.`,
          redirectNote,
          revokeNote,
        ],
      };

    case 'windsurf':
      return {
        clientId,
        title: 'Windsurf',
        steps: ['Add this to ~/.codeium/windsurf/mcp_config.json (Windsurf → Settings → Cascade → MCP → Configure):'],
        blocks: [
          {
            label: '~/.codeium/windsurf/mcp_config.json',
            language: 'json',
            code: json({ mcpServers: { [MCP_SERVER_NAME]: { serverUrl: mcpUrl, headers: { Authorization: auth } } } }),
          },
        ],
        notes: [
          'Click Refresh in the MCP panel after saving. Use serverUrl (not url) for a remote server.',
          'This file is global (no per-project config) and has no environment-variable interpolation, so the token sits in it in plain text — prefer a read-mostly token here.',
          redirectNote,
          revokeNote,
        ],
      };

    case 'gemini-cli':
      return {
        clientId,
        title: 'Gemini CLI',
        steps: ['Run this in a terminal (--scope user writes ~/.gemini/settings.json; the default scope is the current project), or merge the JSON into ~/.gemini/settings.json yourself:'],
        blocks: [
          {
            label: 'Terminal',
            language: 'bash',
            code: geminiCliCommand(mcpUrl, token),
          },
          {
            label: '~/.gemini/settings.json',
            language: 'json',
            code: json({ mcpServers: { [MCP_SERVER_NAME]: { httpUrl: mcpUrl, headers: { Authorization: auth } } } }),
          },
        ],
        notes: [
          'Run /mcp inside Gemini CLI to confirm the server and its tools are listed.',
          `Use httpUrl (Streamable HTTP), never url (legacy SSE, which this server does not serve). Gemini CLI expands $VAR / \${VAR} anywhere in settings.json, so "Bearer $${MCP_TOKEN_ENV_VAR}" keeps the token out of the file.`,
          redirectNote,
          revokeNote,
        ],
      };

    case 'vscode-copilot': {
      const inputId = 'omnimind-token';
      return {
        clientId,
        title: 'GitHub Copilot (VS Code)',
        steps: ['Add this to .vscode/mcp.json in your workspace (or run "MCP: Add Server" from the Command Palette). VS Code prompts for the token the first time the server starts and keeps it in its secret store, so no token lands in the file:'],
        blocks: [
          {
            label: '.vscode/mcp.json',
            language: 'json',
            code: json({
              inputs: [
                { id: inputId, type: 'promptString', password: true, description: 'OmniMind personal token (omt_…) from BoardRoom Settings → Connected AI tools' },
              ],
              servers: { [MCP_SERVER_NAME]: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer \${input:${inputId}}` } } },
            }),
          },
          {
            label: 'Or from a terminal (token stored in the user-level config as plain text)',
            language: 'bash',
            code: `code --add-mcp '${JSON.stringify({ name: MCP_SERVER_NAME, type: 'http', url: mcpUrl, headers: { Authorization: auth } })}'`,
          },
        ],
        notes: [
          'Copilot Chat must be in Agent mode to use MCP tools. Paste the token value when VS Code asks for it: ' + auth.replace(/^Bearer /, ''),
          redirectNote,
          revokeNote,
        ],
      };
    }

    case 'zed':
      return {
        clientId,
        title: 'Zed',
        steps: ['Add this to your Zed settings.json (zed: open settings), or use Settings → AI → MCP Servers → Add Remote Server. Zed connects to remote servers natively — no bridge is needed:'],
        blocks: [
          {
            label: 'settings.json',
            language: 'json',
            code: json({ context_servers: { [MCP_SERVER_NAME]: { url: mcpUrl, headers: { Authorization: auth } } } }),
          },
        ],
        notes: [
          'The header is stored in plain text in settings.json. Without an Authorization header Zed would start the OAuth sign-in flow instead (only works once the operator enables OAuth mode).',
          redirectNote,
          revokeNote,
        ],
      };

    case 'chatgpt': {
      const searchFetchNote = 'The server exposes the read-only `search` and `fetch` tools ChatGPT uses for Deep Research and company knowledge, alongside the full OmniMind tool set.';
      const developerModeStep = 'Open ChatGPT → Settings → Apps & Connectors (older builds: Connectors) → Advanced → turn on Developer mode. Available on Plus, Pro, Business, Enterprise and Edu; on Business/Enterprise an admin enables it under Workspace Settings → Permissions & Roles.';
      const planNote = 'Write tools are confirmed on Business, Enterprise and Edu; on Plus and Pro the connector may be read-only (search/fetch only).';
      if (oauthEnabled) {
        return {
          clientId,
          title: 'ChatGPT',
          steps: [
            developerModeStep,
            'Click Create, name it "OmniMind" and paste the server URL below.',
            'Authentication: choose OAuth. ChatGPT registers itself with the operator\'s identity provider and signs you in — no token is needed, and the dialog has no header or API-key field, so this token is not used from ChatGPT at all.',
            'Create, then enable the connector in a new chat (Developer mode tools). Write tools ask for confirmation before they run; `search` and `fetch` are read-only and never prompt.',
          ],
          blocks: [urlBlock],
          notes: [
            'OAuth sign-in grants read-only access (memory:read) by default; the operator widens it per identity.',
            planNote,
            searchFetchNote,
            redirectNote,
            revokeNote,
          ],
        };
      }
      return {
        clientId,
        title: 'ChatGPT',
        steps: [
          developerModeStep,
          'Click Create, name it "OmniMind" and paste the server URL below.',
          `Authentication: the dialog offers only OAuth or "No authentication" — there is no header or API-key field, so ChatGPT cannot use this token. OAuth is not enabled on this server yet: ask your operator to enable it (OMNIMIND_MCP_OAUTH_ISSUER — ${MCP_OAUTH_RUNBOOK_REF}), then come back to this page, which will show the OAuth steps.`,
        ],
        blocks: [urlBlock],
        notes: [
          `OAuth is not enabled on this server yet, and ChatGPT cannot use this token — the operator's recipe is in ${MCP_RUNBOOK_PATH} §9.`,
          planNote,
          searchFetchNote,
          redirectNote,
          revokeNote,
        ],
      };
    }

    case 'other':
    default:
      return {
        clientId: 'other',
        title: 'Any Streamable HTTP MCP client',
        steps: ['Point your client at the URL below using the Streamable HTTP transport and send the header on every request.'],
        blocks: [
          urlBlock,
          headerBlock,
          {
            label: 'Smoke test with curl (initialize)',
            language: 'bash',
            code: `curl -sS ${mcpUrl} \\\n  -H "Authorization: ${auth}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'`,
          },
        ],
        notes: [redirectNote, revokeNote],
      };
  }
}
