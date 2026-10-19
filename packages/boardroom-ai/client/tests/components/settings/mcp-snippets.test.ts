import { describe, it, expect } from 'vitest';
import {
  MCP_CLIENTS,
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
      expect(all, id).toContain('Bearer omt_abc_secret');
    }
  });

  it('Claude Code is a single `claude mcp add --transport http` command', () => {
    const s = buildSnippet('claude-code', input);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0].code).toBe('claude mcp add --transport http omnimind https://mcp.example/mcp --header "Authorization: Bearer omt_abc_secret"');
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
  });

  it.each<[McpClientId, string, string]>([
    ['windsurf', 'mcpServers.omnimind.serverUrl', 'https://mcp.example/mcp'],
    ['gemini-cli', 'mcpServers.omnimind.httpUrl', 'https://mcp.example/mcp'],
    ['vscode-copilot', 'servers.omnimind.type', 'http'],
    ['zed', 'context_servers.omnimind.url', 'https://mcp.example/mcp'],
  ])('%s JSON block has %s = %s', (id, path, expected) => {
    const s = buildSnippet(id, input);
    const obj = JSON.parse(s.blocks[0].code);
    const value = path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], obj);
    expect(value).toBe(expected);
    expect(s.blocks[0].code).toContain('"Authorization": "Bearer omt_abc_secret"');
  });

  it('ChatGPT (M7): OAuth-first when enabled; otherwise says plainly that a token may not be usable and points to the runbook', () => {
    const off = buildSnippet('chatgpt', { ...input, oauthEnabled: false });
    const offText = [...off.steps, ...off.notes].join(' ');
    expect(offText).toMatch(/OAuth is not enabled on this server yet/);
    expect(offText).toMatch(/ChatGPT cannot use this token/);
    expect(offText).toContain(MCP_RUNBOOK_PATH);
    expect(offText).toMatch(/OAuth or "No authentication"/);
    expect(off.notes.join(' ')).toMatch(/`search` and `fetch`/);
    // No step tells the user to pick a header option as if it were guaranteed.
    expect(off.steps.some((s) => /choose "Custom header"/.test(s))).toBe(false);

    const on = buildSnippet('chatgpt', { ...input, oauthEnabled: true });
    expect(on.steps[2]).toMatch(/^Authentication: choose OAuth/);
    expect(on.steps.join(' ')).toMatch(/no token is needed/);
    expect(on.notes.join(' ')).toMatch(/`search` and `fetch`/);
  });

  it('Claude.ai / Claude Desktop (H1): header steps, an explicit no-header-field fallback, OAuth first when enabled', () => {
    for (const id of ['claude-ai', 'claude-desktop'] as const) {
      const off = buildSnippet(id, { ...input, oauthEnabled: false });
      expect(off.steps[2]).toMatch(/Advanced settings\. If it shows a header field/);
      expect(off.notes[0]).toBe(
        "If your plan's Add custom connector dialog has no header field, this server needs OAuth (operator sets OMNIMIND_MCP_OAUTH_ISSUER) — until then use Claude Code or Claude Desktop with the Claude Code MCP config below.",
      );
      expect(off.notes.join(' ')).toMatch(/OAuth is not enabled/);
      // The fallback is actionable: the Claude Code one-liner ships as a block.
      expect(off.blocks.some((b) => b.code === claudeCodeCommand(input.mcpUrl, input.token))).toBe(true);
      // No unverified plan-availability claim.
      expect([...off.steps, ...off.notes].join(' ')).not.toMatch(/Pro, Max, Team, Enterprise/);

      const on = buildSnippet(id, { ...input, oauthEnabled: true });
      expect(on.steps[1]).toMatch(/advertises OAuth/);
      expect(on.steps[1]).toMatch(/No token is needed on this path/);
      expect(on.steps[2]).toMatch(/if a header field is offered/);
      expect(on.notes.join(' ')).toMatch(/no header field/);
    }
    // Desktop additionally gets a claude_desktop_config.json bridge that needs no header field at all.
    const desktop = buildSnippet('claude-desktop', { ...input, oauthEnabled: false });
    const bridge = desktop.blocks.find((b) => b.label.startsWith('Or claude_desktop_config.json'));
    expect(bridge).toBeDefined();
    expect(JSON.parse(bridge!.code).mcpServers.omnimind.args).toEqual(['-y', 'mcp-remote', input.mcpUrl, '--header', 'Authorization:Bearer omt_abc_secret']);
    expect(buildSnippet('claude-ai', input).blocks.some((b) => b.label.startsWith('Or claude_desktop_config.json'))).toBe(false);
  });

  it('the revoke note says access ends within about a minute (60 s token cache), on every client', () => {
    for (const { id } of MCP_CLIENTS) {
      const s = buildSnippet(id, input);
      expect(s.notes, id).toContain(MCP_REVOKE_NOTE);
      expect(s.notes.join(' '), id).toMatch(/within about a minute/);
      expect(s.notes.join(' '), id).not.toMatch(/immediately/);
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
