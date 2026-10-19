import { describe, it, expect } from 'vitest';
import {
  MCP_CLIENTS,
  MCP_NO_REDIRECT_NOTE,
  MCP_REVOKE_NOTE,
  MCP_RUNBOOK_PATH,
  buildSnippet,
  claudeCodeCommand,
  cursorDeeplink,
  inferClientFromName,
  type McpClientId,
} from '../../../src/components/settings/mcp-snippets';
import { readWriteScopes, describeCreateError, describeValidationDetails } from '../../../src/components/settings/McpTokenCreateForm';
import { ApiError } from '../../../src/lib/api';

const input = { mcpUrl: 'https://mcp.example/mcp', token: 'omt_abc_secret' };

describe('buildSnippet', () => {
  it('every client snippet carries the URL and the bearer token at least once', () => {
    for (const { id } of MCP_CLIENTS) {
      const s = buildSnippet(id, input);
      const all = [...s.blocks.map((b) => b.code), ...s.steps, ...s.notes].join('\n');
      expect(all, id).toContain('https://mcp.example/mcp');
      // ChatGPT's connector dialog has no header field at all (OAuth or "No authentication"
      // only), so its snippet deliberately never shows the token.
      if (id === 'chatgpt') {
        expect(all).not.toContain('omt_abc_secret');
      } else {
        expect(all, id).toContain('omt_abc_secret');
      }
    }
  });

  it('every client snippet carries the shared no-redirect note (Claude drops Authorization on redirects; ChatGPT "Session terminated")', () => {
    for (const { id } of MCP_CLIENTS) {
      const s = buildSnippet(id, input);
      expect(s.notes, id).toContain(MCP_NO_REDIRECT_NOTE);
    }
    expect(MCP_NO_REDIRECT_NOTE).toMatch(/\/mcp → \/mcp\/ 307/);
    expect(MCP_NO_REDIRECT_NOTE).toMatch(/Session terminated/);
  });

  it('Claude Code is a single `claude mcp add --transport http` command', () => {
    const s = buildSnippet('claude-code', input);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0].code).toBe('claude mcp add --transport http --scope user omnimind https://mcp.example/mcp --header "Authorization: Bearer omt_abc_secret"');
    expect(s.blocks[0].code).toContain('--scope user');
    expect(s.blocks[0].code).toBe(claudeCodeCommand(input.mcpUrl, input.token));
    // Keeping the token out of a committed .mcp.json: ${VAR} interpolation.
    expect(s.notes.join(' ')).toContain('Bearer ${OMNIMIND_TOKEN}');
    expect(s.notes.join(' ')).toMatch(/\.mcp\.json/);
  });

  it('Cursor emits valid .cursor/mcp.json plus a deeplink whose config decodes to the same server', () => {
    const s = buildSnippet('cursor', input);
    const parsed = JSON.parse(s.blocks[0].code);
    expect(parsed).toEqual({ mcpServers: { omnimind: { url: input.mcpUrl, headers: { Authorization: 'Bearer omt_abc_secret' } } } });
    const link = s.blocks[1].code;
    expect(link.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=omnimind&config=')).toBe(true);
    const config = JSON.parse(atob(decodeURIComponent(link.split('config=')[1])));
    expect(config).toEqual({ url: input.mcpUrl, headers: { Authorization: 'Bearer omt_abc_secret' } });
    expect(cursorDeeplink(input.mcpUrl, input.token)).toBe(link);
    expect(s.notes.join(' ')).toContain('${env:OMNIMIND_TOKEN}');
  });

  it.each<[McpClientId, string, string, string]>([
    ['windsurf', 'mcpServers.omnimind.serverUrl', 'https://mcp.example/mcp', '"Authorization": "Bearer omt_abc_secret"'],
    ['gemini-cli', 'mcpServers.omnimind.httpUrl', 'https://mcp.example/mcp', '"Authorization": "Bearer omt_abc_secret"'],
    ['vscode-copilot', 'servers.omnimind.type', 'http', '"Authorization": "Bearer ${input:omnimind-token}"'],
    ['zed', 'context_servers.omnimind.url', 'https://mcp.example/mcp', '"Authorization": "Bearer omt_abc_secret"'],
  ])('%s JSON block has %s = %s', (id, path, expected, authLine) => {
    const s = buildSnippet(id, input);
    const block = s.blocks.find((b) => b.language === 'json');
    expect(block, id).toBeDefined();
    const obj = JSON.parse(block!.code);
    const value = path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], obj);
    expect(value).toBe(expected);
    expect(block!.code).toContain(authLine);
  });

  it('Gemini CLI leads with the `gemini mcp add` one-liner and never uses the SSE `url` key', () => {
    const s = buildSnippet('gemini-cli', input);
    expect(s.blocks[0].language).toBe('bash');
    expect(s.blocks[0].code).toBe('gemini mcp add --transport http --scope user --header "Authorization: Bearer omt_abc_secret" omnimind https://mcp.example/mcp');
    expect(JSON.parse(s.blocks[1].code).mcpServers.omnimind.url).toBeUndefined();
    expect(s.notes.join(' ')).toMatch(/httpUrl/);
  });

  it('VS Code prompts for the token via `inputs` (promptString, password) instead of storing it in the file', () => {
    const s = buildSnippet('vscode-copilot', input);
    const obj = JSON.parse(s.blocks[0].code);
    expect(obj.inputs).toEqual([
      expect.objectContaining({ id: 'omnimind-token', type: 'promptString', password: true }),
    ]);
    expect(obj.servers.omnimind).toEqual({ type: 'http', url: input.mcpUrl, headers: { Authorization: 'Bearer ${input:omnimind-token}' } });
    expect(s.blocks[0].code).not.toContain('omt_abc_secret');
    // The literal token is still available (terminal one-liner + the "paste when asked" note).
    expect(s.blocks[1].code).toContain('code --add-mcp');
    expect(s.blocks[1].code).toContain('Bearer omt_abc_secret');
  });

  it('Zed uses the native remote `context_servers` shape with url + headers and ships no mcp-remote bridge', () => {
    const s = buildSnippet('zed', input);
    expect(s.blocks).toHaveLength(1);
    expect(JSON.parse(s.blocks[0].code)).toEqual({ context_servers: { omnimind: { url: input.mcpUrl, headers: { Authorization: 'Bearer omt_abc_secret' } } } });
    expect([...s.blocks.map((b) => b.code), ...s.steps, ...s.notes].join(' ')).not.toMatch(/mcp-remote/);
  });

  it('Windsurf uses serverUrl and says the token is stored in plain text (no env interpolation, global file only)', () => {
    const s = buildSnippet('windsurf', input);
    expect(JSON.parse(s.blocks[0].code).mcpServers.omnimind.serverUrl).toBe(input.mcpUrl);
    expect(s.notes.join(' ')).toMatch(/plain text/);
    expect(s.notes.join(' ')).toMatch(/no environment-variable interpolation/);
  });

  it('ChatGPT (M7): OAuth-first when enabled; otherwise says plainly that a token may not be usable and points to the runbook', () => {
    const off = buildSnippet('chatgpt', { ...input, oauthEnabled: false });
    const offText = [...off.steps, ...off.notes].join(' ');
    expect(offText).toMatch(/OAuth is not enabled on this server yet/);
    expect(offText).toMatch(/ChatGPT cannot use this token/);
    expect(offText).toContain(MCP_RUNBOOK_PATH);
    expect(offText).toMatch(/OAuth or "No authentication"/);
    expect(offText).toMatch(/no header or API-key field/);
    expect(off.notes.join(' ')).toMatch(/`search` and `fetch`/);
    // No step tells the user to pick a header option as if it were guaranteed — and no header block ships.
    expect(off.steps.some((s) => /choose "Custom header"/.test(s))).toBe(false);
    expect(off.blocks.map((b) => b.label)).toEqual(['Server URL']);
    // Plan facts: Developer mode plans named; write access hedged for Plus/Pro.
    expect(off.steps[0]).toMatch(/Developer mode/);
    expect(off.steps[0]).toMatch(/Plus, Pro, Business, Enterprise and Edu/);
    expect(off.notes.join(' ')).toMatch(/may be read-only/);

    const on = buildSnippet('chatgpt', { ...input, oauthEnabled: true });
    expect(on.steps[2]).toMatch(/^Authentication: choose OAuth/);
    expect(on.steps.join(' ')).toMatch(/no token is needed/);
    expect(on.steps.join(' ')).toMatch(/confirmation/);
    expect(on.notes.join(' ')).toMatch(/`search` and `fetch`/);
    expect(on.blocks.map((b) => b.label)).toEqual(['Server URL']);
  });

  it('Claude.ai / Claude Desktop (H1): header steps, an explicit no-header-field fallback, OAuth first when enabled', () => {
    for (const id of ['claude-ai', 'claude-desktop'] as const) {
      const off = buildSnippet(id, { ...input, oauthEnabled: false });
      // Verified dialog vocabulary: "No sign-in" + the "Request headers" section, header name `authorization`, value verbatim.
      expect(off.steps[2]).toMatch(/^Authentication: choose "No sign-in"\. In the "Request headers" section add a header named authorization/);
      expect(off.steps[2]).toMatch(/verbatim/);
      expect(off.steps[3]).toMatch(/^If you don't see Request headers, your organization doesn't have the beta yet\./);
      expect(off.steps[4]).toMatch(/cannot be edited after creation/);
      expect(off.notes[0]).toMatch(/"Request headers" section is in beta for a limited set of organizations/);
      expect(off.notes.join(' ')).toMatch(/OAuth is not enabled/);
      // The header value block is the bare "Bearer …" (the dialog has separate name/value fields).
      const header = off.blocks.find((b) => b.label.startsWith('Request header value'));
      expect(header?.code).toBe('Bearer omt_abc_secret');
      expect(header?.label).toMatch(/header name: authorization/);
      // No unverified plan-availability claim.
      expect([...off.steps, ...off.notes].join(' ')).not.toMatch(/Pro, Max, Team, Enterprise/);

      const on = buildSnippet(id, { ...input, oauthEnabled: true });
      expect(on.steps[2]).toMatch(/^Authentication: choose "Sign in when needed"\. OAuth client: choose "Register automatically"/);
      expect(on.steps[2]).toMatch(/Use Claude's published identity/);
      expect(on.steps[2]).toMatch(/No token is needed on this path/);
      expect(on.steps[3]).toMatch(/Only if the dialog shows a "Request headers" section: choose "No sign-in"/);
      expect(on.steps[3]).toMatch(/your organization doesn't have it yet/);
      expect(on.steps[4]).toMatch(/cannot be edited after creation/);
      expect(on.notes.join(' ')).toMatch(/read-only access \(memory:read\) by default/);
    }
    // claude.ai web without the beta: plainly needs OAuth, points at runbook §9, names the two working alternatives.
    const web = buildSnippet('claude-ai', { ...input, oauthEnabled: false });
    expect(web.steps[3]).toMatch(/claude\.ai then has no way to send this token: the server needs OAuth/);
    expect(web.steps[3]).toContain(`${MCP_RUNBOOK_PATH} §9`);
    expect(web.steps[3]).toMatch(/Claude Code/);
    expect(web.steps[3]).toMatch(/Claude Desktop/);
    expect(web.blocks.some((b) => b.label.startsWith('Or claude_desktop_config.json'))).toBe(false);
    expect([...web.blocks.map((b) => b.code), ...web.steps, ...web.notes].join(' ')).not.toMatch(/mcp-remote/);

    // Desktop additionally gets a claude_desktop_config.json bridge that needs no header field at all — in both modes.
    for (const oauthEnabled of [false, true]) {
      const desktop = buildSnippet('claude-desktop', { ...input, oauthEnabled });
      const bridge = desktop.blocks.find((b) => b.label.startsWith('Or claude_desktop_config.json'));
      expect(bridge).toBeDefined();
      expect(bridge!.label).toMatch(/works whether or not your organization has the Request headers beta/);
      expect(JSON.parse(bridge!.code).mcpServers.omnimind.args).toEqual(['-y', 'mcp-remote', input.mcpUrl, '--header', 'Authorization:Bearer omt_abc_secret']);
    }
    expect(buildSnippet('claude-desktop', { ...input, oauthEnabled: false }).steps[3]).toMatch(/add the claude_desktop_config\.json entry below instead/);
    expect(buildSnippet('claude-desktop', input).steps[0]).toMatch(/same dialog and the same connector list as claude\.ai/);
  });

  it('the revoke note says access ends immediately (idle session may linger up to 30 s), on every client', () => {
    for (const { id } of MCP_CLIENTS) {
      const s = buildSnippet(id, input);
      expect(s.notes, id).toContain(MCP_REVOKE_NOTE);
      expect(s.notes.join(' '), id).toMatch(/stops working immediately/);
      expect(s.notes.join(' '), id).toMatch(/up to 30 seconds/);
      expect(s.notes.join(' '), id).not.toMatch(/within about a minute/);
    }
  });

  it('unknown ids fall back to the generic Streamable HTTP snippet', () => {
    const s = buildSnippet('nope' as McpClientId, input);
    expect(s.clientId).toBe('other');
    expect(s.blocks.some((b) => b.code.startsWith('curl'))).toBe(true);
  });
});

describe('inferClientFromName', () => {
  it.each<[string, McpClientId | null]>([
    ['Claude Code', 'claude-code'],
    ['Claude Desktop (work mac)', 'claude-desktop'],
    ['Claude.ai', 'claude-ai'],
    ['my cursor token', 'cursor'],
    ['VS Code Copilot', 'vscode-copilot'],
    ['Gemini CLI', 'gemini-cli'],
    ['ChatGPT', 'chatgpt'],
    ['Windsurf', 'windsurf'],
    ['Zed', 'zed'],
    ['laptop', null],
  ])('%s → %s', (name, expected) => {
    expect(inferClientFromName(name)).toBe(expected);
  });
});

describe('readWriteScopes', () => {
  it('is memory:read plus every non-admin write scope, de-duplicated', () => {
    const scopes = readWriteScopes({
      tenants: [],
      scopes: [
        { id: 'memory:read', description: '', write: false },
        { id: 'memory:write', description: '', write: true },
        { id: 'task:write', description: '', write: true },
        { id: 'admin:write', description: '', write: true },
        { id: 'memory:read', description: 'dupe', write: false },
      ],
    });
    expect(scopes).toEqual(['memory:read', 'memory:write', 'task:write']);
  });
});

describe('describeCreateError', () => {
  it('maps the upstream codes to founder-readable copy', () => {
    expect(describeCreateError(new ApiError('x', 403, { error: 'tenant_not_owned' }))).toMatch(/not the owner/);
    expect(describeCreateError(new ApiError('x', 409, { error: 'token_limit' }))).toMatch(/token limit/i);
    expect(describeCreateError(new ApiError('bad name', 422, { error: 'validation_failed' }))).toBe('bad name');
    expect(describeCreateError(new Error('boom'))).toBe('boom');
  });

  it('402 (lapsed subscription) explains that existing tokens still work and can be revoked', () => {
    const msg = describeCreateError(new ApiError('Request failed: 402', 402, { error: 'subscription_required', message: 'Please subscribe to continue' }));
    expect(msg).toMatch(/subscription is not active/);
    expect(msg).toMatch(/can still be revoked/);
  });

  it('validation_failed bodies with no message become readable copy — BoardRoom [{field,message}] and OmniMind details alike', () => {
    // BoardRoom's own validateBody (422) and OmniMind's /mcp 400 bodies both carry [{ field, message }].
    const br = describeCreateError(new ApiError('Request failed: 422', 422, {
      error: 'validation_failed',
      details: [{ field: 'scopes.1', message: "Invalid enum value. Expected 'memory:read' | …, received 'bogus'" }, { field: 'name', message: 'String must contain at most 60 character(s)' }],
    }));
    expect(br).toBe("Please check: Scopes: Invalid enum value. Expected 'memory:read' | …, received 'bogus'; Token name: String must contain at most 60 character(s).");
    expect(br).not.toMatch(/Request failed/);

    const om400 = describeCreateError(new ApiError('Request failed: 400', 400, {
      error: 'validation_failed',
      details: [{ field: 'expiresInDays', message: 'Expected number, received string' }],
    }));
    expect(om400).toBe('Please check: Expiry: Expected number, received string.');

    // Older zod flatten() shape is still understood.
    expect(describeValidationDetails({ details: { formErrors: [], fieldErrors: { scopes: ['scopes must not repeat'] } } }))
      .toBe('Please check: Scopes: scopes must not repeat.');
    // Nothing usable → null so the caller can fall back.
    expect(describeValidationDetails({ error: 'validation_failed' })).toBeNull();
    expect(describeCreateError(new ApiError('Request failed: 422', 422, { error: 'validation_failed' }))).toBe('Request failed: 422');
  });
});
