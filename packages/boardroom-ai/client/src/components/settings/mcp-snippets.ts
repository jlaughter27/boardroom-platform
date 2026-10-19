// Lane C — install snippets for every supported AI client.
//
// Single source of truth for the "Connected AI tools" panel. Lane E's docs
// mirror these templates, so keep each client's config format here, not in the
// React components. Pure functions only — no React, no I/O.
//
// Two clients are written defensively because their "add connector" dialogs
// differ by plan / workspace and may not offer a header field at all:
//   * claude.ai / Claude Desktop — header under Advanced settings on some plans;
//     otherwise OAuth (when the operator enables it) or the Claude Code config.
//   * ChatGPT — developer-mode connectors offer OAuth or no auth; a header /
//     API-key field is not guaranteed.
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
  { id: 'claude-ai', label: 'Claude.ai', defaultName: 'Claude.ai', hint: 'Custom connector in claude.ai Settings (header field depends on your plan)' },
  { id: 'claude-desktop', label: 'Claude Desktop', defaultName: 'Claude Desktop', hint: 'Custom connector in the desktop app, or claude_desktop_config.json' },
  { id: 'claude-code', label: 'Claude Code', defaultName: 'Claude Code', hint: 'One terminal command' },
  { id: 'chatgpt', label: 'ChatGPT', defaultName: 'ChatGPT', hint: 'Developer-mode connector (OAuth or no auth; header only if offered)' },
  { id: 'cursor', label: 'Cursor', defaultName: 'Cursor', hint: '.cursor/mcp.json or one-click deeplink' },
  { id: 'windsurf', label: 'Windsurf', defaultName: 'Windsurf', hint: 'mcp_config.json' },
  { id: 'gemini-cli', label: 'Gemini CLI', defaultName: 'Gemini CLI', hint: '~/.gemini/settings.json' },
  { id: 'vscode-copilot', label: 'GitHub Copilot (VS Code)', defaultName: 'VS Code Copilot', hint: '.vscode/mcp.json' },
  { id: 'zed', label: 'Zed', defaultName: 'Zed', hint: 'settings.json context_servers' },
  { id: 'other', label: 'Other (Streamable HTTP)', defaultName: 'MCP client', hint: 'Any client that speaks Streamable HTTP' },
] as const;

export const MCP_SERVER_NAME = 'omnimind';

/** Placeholder used when the operator has not configured OMNIMIND_MCP_PUBLIC_URL. */
export const MCP_URL_PLACEHOLDER = 'https://<your-omnimind-mcp-host>/mcp';

/** Operator runbook for the MCP server (OAuth issuer, public URL, gateway). */
export const MCP_RUNBOOK_PATH = 'docs/runbooks/omnimind-mcp.md';

/** Revocation takes effect once the gateway's token cache (60 s) expires. */
export const MCP_REVOKE_NOTE = 'Revoke the token from this page at any time; the client loses access within about a minute.';

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

/** The Claude Code one-liner; reused as the fallback for claude.ai / Desktop. */
export function claudeCodeCommand(mcpUrl: string, token: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpUrl} --header "Authorization: ${bearer(token)}"`;
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

  switch (clientId) {
    case 'claude-code':
      return {
        clientId,
        title: 'Claude Code',
        steps: ['Run this in a terminal (add --scope user to make it available in every project):'],
        blocks: [
          {
            label: 'Terminal',
            language: 'bash',
            code: claudeCodeCommand(mcpUrl, token),
          },
        ],
        notes: ['Check with `claude mcp list`; the server should report as connected.', revokeNote],
      };

    case 'claude-ai':
    case 'claude-desktop': {
      const where = clientId === 'claude-ai' ? 'claude.ai' : 'Claude Desktop';
      const fallbackBlock: SnippetBlock = {
        label: 'Fallback — Claude Code MCP config (works everywhere)',
        language: 'bash',
        code: claudeCodeCommand(mcpUrl, token),
      };
      const desktopConfigBlock: SnippetBlock = {
        label: 'Or claude_desktop_config.json (bridged with mcp-remote, no header field needed)',
        language: 'json',
        code: json({
          mcpServers: {
            [MCP_SERVER_NAME]: {
              command: 'npx',
              args: ['-y', 'mcp-remote', mcpUrl, '--header', `Authorization:${auth}`],
            },
          },
        }),
      };
      const noHeaderFallback =
        `If your plan's Add custom connector dialog has no header field, this server needs OAuth (operator sets OMNIMIND_MCP_OAUTH_ISSUER) — until then use Claude Code or Claude Desktop with the Claude Code MCP config below.`;

      if (oauthEnabled) {
        return {
          clientId,
          title: where,
          steps: [
            `Open ${where} → Settings → Connectors → Add custom connector.`,
            'Name it "OmniMind" and paste the server URL below. Leave Advanced settings empty: this server advertises OAuth, so you will be asked to sign in when you enable the connector. No token is needed on this path.',
            'Prefer the token (or your dialog skips the sign-in)? Expand Advanced settings and, if a header field is offered, paste the header below into it. Leave OAuth Client ID / Client Secret empty.',
            'Add, then enable the connector in a chat from the tools menu.',
          ],
          blocks: clientId === 'claude-desktop' ? [urlBlock, headerBlock, desktopConfigBlock, fallbackBlock] : [urlBlock, headerBlock, fallbackBlock],
          notes: [
            'OAuth sign-in grants read-only access by default; this token carries exactly the scopes you picked.',
            noHeaderFallback,
            revokeNote,
          ],
        };
      }

      return {
        clientId,
        title: where,
        steps: [
          `Open ${where} → Settings → Connectors → Add custom connector.`,
          'Name it "OmniMind" and paste the server URL below.',
          'Expand Advanced settings. If it shows a header field (for example "Authorization" or a custom header), paste the header below into it. Leave OAuth Client ID and Client Secret empty.',
          'Add, then enable the connector in a chat from the tools menu.',
        ],
        blocks: clientId === 'claude-desktop' ? [urlBlock, headerBlock, desktopConfigBlock, fallbackBlock] : [urlBlock, headerBlock, fallbackBlock],
        notes: [
          noHeaderFallback,
          'OAuth is not enabled on this server yet.',
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
        notes: ['Cursor → Settings → MCP shows the server; toggle it on if it is listed as disabled.', revokeNote],
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
        notes: ['Click Refresh in the MCP panel after saving.', revokeNote],
      };

    case 'gemini-cli':
      return {
        clientId,
        title: 'Gemini CLI',
        steps: ['Add this to ~/.gemini/settings.json (or .gemini/settings.json inside a project):'],
        blocks: [
          {
            label: '~/.gemini/settings.json',
            language: 'json',
            code: json({ mcpServers: { [MCP_SERVER_NAME]: { httpUrl: mcpUrl, headers: { Authorization: auth } } } }),
          },
        ],
        notes: ['Run /mcp inside Gemini CLI to confirm the server and its tools are listed.', revokeNote],
      };

    case 'vscode-copilot':
      return {
        clientId,
        title: 'GitHub Copilot (VS Code)',
        steps: ['Add this to .vscode/mcp.json in your workspace (or run "MCP: Add Server" from the Command Palette):'],
        blocks: [
          {
            label: '.vscode/mcp.json',
            language: 'json',
            code: json({ servers: { [MCP_SERVER_NAME]: { type: 'http', url: mcpUrl, headers: { Authorization: auth } } } }),
          },
          {
            label: 'Or from a terminal',
            language: 'bash',
            code: `code --add-mcp '${JSON.stringify({ name: MCP_SERVER_NAME, type: 'http', url: mcpUrl, headers: { Authorization: auth } })}'`,
          },
        ],
        notes: ['Copilot Chat must be in Agent mode to use MCP tools.', revokeNote],
      };

    case 'zed':
      return {
        clientId,
        title: 'Zed',
        steps: ['Add this to your Zed settings.json (zed: open settings):'],
        blocks: [
          {
            label: 'settings.json',
            language: 'json',
            code: json({ context_servers: { [MCP_SERVER_NAME]: { source: 'custom', url: mcpUrl, headers: { Authorization: auth } } } }),
          },
          {
            label: 'If your Zed build only supports stdio servers, bridge with mcp-remote instead',
            language: 'json',
            code: json({
              context_servers: {
                [MCP_SERVER_NAME]: {
                  source: 'custom',
                  command: 'npx',
                  args: ['-y', 'mcp-remote', mcpUrl, '--header', `Authorization:${auth}`],
                },
              },
            }),
          },
        ],
        notes: [revokeNote],
      };

    case 'chatgpt': {
      const searchFetchNote = 'The server exposes the `search` and `fetch` tools ChatGPT requires, alongside the full OmniMind tool set.';
      if (oauthEnabled) {
        return {
          clientId,
          title: 'ChatGPT',
          steps: [
            'Open ChatGPT → Settings → Connectors → Advanced → enable Developer mode.',
            'Click Create, name it "OmniMind" and paste the server URL below.',
            'Authentication: choose OAuth. This server advertises an OAuth issuer, so ChatGPT completes the sign-in itself — no token is needed on this path.',
            'Only if your dialog offers a custom header / API-key option and you prefer the token: paste the header below there instead.',
            'Create, then enable the connector in a new chat (Developer mode tools).',
          ],
          blocks: [urlBlock, headerBlock],
          notes: [
            'OAuth sign-in grants read-only access by default; this token carries exactly the scopes you picked.',
            searchFetchNote,
            revokeNote,
          ],
        };
      }
      return {
        clientId,
        title: 'ChatGPT',
        steps: [
          'Open ChatGPT → Settings → Connectors → Advanced → enable Developer mode.',
          'Click Create, name it "OmniMind" and paste the server URL below.',
          'Authentication: ChatGPT developer-mode connectors normally offer OAuth or "No authentication". A personal token only works if your dialog also shows a custom header / API-key field — if it does, paste the header below there.',
          'Create, then enable the connector in a new chat (Developer mode tools).',
        ],
        blocks: [urlBlock, headerBlock],
        notes: [
          `OAuth is not enabled on this server yet. If your Create connector dialog offers only OAuth or "No authentication", ChatGPT cannot use this token until your operator sets OMNIMIND_MCP_OAUTH_ISSUER — see ${MCP_RUNBOOK_PATH}.`,
          searchFetchNote,
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
        notes: [revokeNote],
      };
  }
}
