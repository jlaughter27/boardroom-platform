import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as api from '../../../src/lib/api';
import type { McpConnectInfo, McpTokenOptions, McpTokenRecord } from '../../../src/lib/api';
import { ConnectedToolsPanel } from '../../../src/components/settings/ConnectedToolsPanel';

vi.mock('../../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/api')>();
  return {
    ...actual,
    listMcpTokens: vi.fn(),
    getMcpTokenOptions: vi.fn(),
    getMcpConnectInfo: vi.fn(),
    createMcpToken: vi.fn(),
    revokeMcpToken: vi.fn(),
  };
});

const options: McpTokenOptions = {
  tenants: [{ id: 'josh-business', name: 'Business' }, { id: 'josh-personal', name: 'Personal' }],
  scopes: [
    { id: 'memory:read', description: 'Read memory', write: false },
    { id: 'memory:write', description: 'Write memory', write: true },
    { id: 'task:write', description: 'Write tasks', write: true },
  ],
};
const connectInfo: McpConnectInfo = { mcpUrl: 'https://mcp.example/mcp', appUrl: 'https://app.example', oauthEnabled: false };

const record = (over: Partial<McpTokenRecord> = {}): McpTokenRecord => ({
  id: 'tok_1', userId: 'u1', tenantId: 'josh-business', name: 'Claude Code', agentName: 'claude-code-u1',
  prefix: 'omt_abcd1234', scopes: ['memory:read'], sourceWeight: 1, createdAt: '2026-10-01T00:00:00.000Z',
  lastUsedAt: null, expiresAt: null, revokedAt: null, ...over,
});

function arrange(tokens: McpTokenRecord[] = [], opts = options, info: typeof connectInfo | null = connectInfo) {
  vi.mocked(api.listMcpTokens).mockResolvedValue({ tokens });
  vi.mocked(api.getMcpTokenOptions).mockResolvedValue(opts);
  if (info) vi.mocked(api.getMcpConnectInfo).mockResolvedValue(info);
  else vi.mocked(api.getMcpConnectInfo).mockRejectedValue(new Error('nope'));
}

/**
 * "New token" is rendered disabled while tokens/options/connect-info load, so a click
 * straight after `findByRole` is a race on slow runners (CI saw the loading skeleton
 * still mounted). Wait for the enabled state, then click, then wait for the form.
 */
async function clickNewToken() {
  const btn = await screen.findByRole('button', { name: 'New token' });
  await waitFor(() => expect(btn).toBeEnabled());
  fireEvent.click(btn);
  return screen.findByTestId('mcp-token-form');
}

async function openForm() {
  render(<ConnectedToolsPanel />);
  return clickNewToken();
}

describe('<ConnectedToolsPanel />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('shows the empty state when a tenant exists but there are no tokens', async () => {
    arrange([]);
    render(<ConnectedToolsPanel />);
    expect(await screen.findByTestId('mcp-empty')).toBeInTheDocument();
    expect(screen.getByText('No tokens yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New token' })).toBeEnabled();
  });

  it('shows the no-tenant state with the operator hint and disables creation', async () => {
    arrange([], { ...options, tenants: [] });
    render(<ConnectedToolsPanel />);
    expect(await screen.findByTestId('mcp-no-tenant')).toBeInTheDocument();
    expect(screen.getByText('No tenant is assigned to your account yet')).toBeInTheDocument();
    expect(screen.getByText(/tenant owner/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New token' })).toBeDisabled();
    expect(screen.queryByTestId('mcp-empty')).not.toBeInTheDocument();
  });

  it('lists tokens with prefix, scopes, inferred client badge and revoked state', async () => {
    arrange([
      record(),
      record({ id: 'tok_2', name: 'Cursor laptop', prefix: 'omt_zzzz9999', scopes: ['memory:read', 'task:write'], revokedAt: '2026-10-05T00:00:00.000Z' }),
    ]);
    render(<ConnectedToolsPanel />);
    const row = await screen.findByTestId('mcp-token-row-tok_1');
    // Name + inferred client badge both read "Claude Code".
    expect(within(row).getAllByText('Claude Code')).toHaveLength(2);
    expect(within(row).getByText('omt_abcd1234…')).toBeInTheDocument();
    expect(within(row).getByText('memory:read')).toBeInTheDocument();
    expect(within(row).getAllByText('Never')).toHaveLength(2); // last used + expires
    // Revoked tokens are tucked under a <details>.
    fireEvent.click(screen.getByText('1 revoked token'));
    const revokedRow = screen.getByTestId('mcp-token-row-tok_2');
    expect(within(revokedRow).getByText('Revoked')).toBeInTheDocument();
    expect(within(revokedRow).getByText('Cursor')).toBeInTheDocument();
    expect(within(revokedRow).queryByRole('button', { name: /Revoke Cursor laptop/ })).not.toBeInTheDocument();
  });

  it('create flow (Claude Code, read-only, default expiry): posts the right body, shows the token once and the Claude Code snippet', async () => {
    arrange([]);
    vi.mocked(api.createMcpToken).mockResolvedValue({ token: 'omt_abcd1234_RAWSECRET', record: record() });
    const form = await openForm();

    // Defaults: client Claude Code → name "Claude Code", first tenant, read-only, 365 days (OmniMind's default).
    expect((within(form).getByLabelText('Token name') as HTMLInputElement).value).toBe('Claude Code');
    expect((within(form).getByLabelText('Expires') as HTMLSelectElement).value).toBe('365');
    expect(within(form).getByRole('option', { name: 'Never (not recommended)' })).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Create token' }));

    await waitFor(() => expect(api.createMcpToken).toHaveBeenCalledTimes(1));
    expect(api.createMcpToken).toHaveBeenCalledWith({
      tenantId: 'josh-business', name: 'Claude Code', scopes: ['memory:read'], expiresInDays: 365,
    });

    const created = await screen.findByTestId('mcp-token-created');
    expect(within(created).getByText(/shown once and cannot be retrieved again/)).toBeInTheDocument();
    // Token is masked until revealed.
    const tokenField = within(created).getByLabelText('Token value') as HTMLInputElement;
    expect(tokenField.value).not.toContain('RAWSECRET');
    fireEvent.click(within(created).getByRole('button', { name: 'Show' }));
    expect(tokenField.value).toBe('omt_abcd1234_RAWSECRET');

    // Snippet for the chosen client, with the token substituted.
    const snippet = within(created).getByTestId('mcp-snippet');
    expect(within(snippet).getByText('Connect Claude Code')).toBeInTheDocument();
    expect(within(snippet).getByText(
      'claude mcp add --transport http --scope user omnimind https://mcp.example/mcp --header "Authorization: Bearer omt_abcd1234_RAWSECRET"',
    )).toBeInTheDocument();

    // Copy button copies the command.
    fireEvent.click(within(snippet).getByRole('button', { name: 'Copy Terminal' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('claude mcp add')));

    // The new record is in the list once the one-time view is dismissed.
    fireEvent.click(within(created).getByRole('button', { name: 'Done' }));
    expect(screen.getByTestId('mcp-token-row-tok_1')).toBeInTheDocument();
    expect(screen.queryByTestId('mcp-token-created')).not.toBeInTheDocument();
    // No second fetch is needed; the form never refetches the list.
    expect(api.listMcpTokens).toHaveBeenCalledTimes(1);
  });

  it('create flow (Cursor, read & write, never expires): default name follows the client and the snippet is .cursor/mcp.json', async () => {
    arrange([]);
    vi.mocked(api.createMcpToken).mockResolvedValue({ token: 'omt_cursor_RAW', record: record({ id: 'tok_c', name: 'Cursor' }) });
    const form = await openForm();

    fireEvent.change(within(form).getByLabelText('AI client'), { target: { value: 'cursor' } });
    expect((within(form).getByLabelText('Token name') as HTMLInputElement).value).toBe('Cursor');
    fireEvent.click(within(form).getByLabelText(/Read & write/));
    fireEvent.change(within(form).getByLabelText('Expires'), { target: { value: 'never' } });
    fireEvent.change(within(form).getByLabelText('Tenant'), { target: { value: 'josh-personal' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Create token' }));

    await waitFor(() => expect(api.createMcpToken).toHaveBeenCalledTimes(1));
    // "Never" is sent explicitly as null — omitting the field would make OmniMind apply its 365-day default.
    expect(api.createMcpToken).toHaveBeenCalledWith({
      tenantId: 'josh-personal', name: 'Cursor', scopes: ['memory:read', 'memory:write', 'task:write'], expiresInDays: null,
    });

    const created = await screen.findByTestId('mcp-token-created');
    const snippet = within(created).getByTestId('mcp-snippet');
    expect(within(snippet).getByText('Connect Cursor')).toBeInTheDocument();
    const block = within(snippet).getByTestId('mcp-snippet-block-0');
    expect(within(block).getByText('.cursor/mcp.json')).toBeInTheDocument();
    const code = block.querySelector('pre')?.textContent ?? '';
    expect(JSON.parse(code)).toEqual({
      mcpServers: { omnimind: { url: 'https://mcp.example/mcp', headers: { Authorization: 'Bearer omt_cursor_RAW' } } },
    });
  });

  it('custom preset lets the founder tick individual scopes', async () => {
    arrange([]);
    vi.mocked(api.createMcpToken).mockResolvedValue({ token: 't', record: record() });
    const form = await openForm();
    fireEvent.click(within(form).getByLabelText(/Custom/));
    const custom = within(form).getByTestId('mcp-custom-scopes');
    fireEvent.click(within(custom).getByLabelText(/task:write/));
    fireEvent.click(within(form).getByRole('button', { name: 'Create token' }));
    await waitFor(() => expect(api.createMcpToken).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['memory:read', 'task:write'] })));
  });

  it('surfaces upstream 409 token_limit as readable copy and keeps the form open', async () => {
    arrange([]);
    vi.mocked(api.createMcpToken).mockRejectedValue(new api.ApiError('limit', 409, { error: 'token_limit' }));
    const form = await openForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Create token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/token limit/i);
    expect(screen.getByTestId('mcp-token-form')).toBeInTheDocument();
  });

  it('revoke asks for confirmation, then calls the api and marks the row revoked', async () => {
    arrange([record()]);
    vi.mocked(api.revokeMcpToken).mockResolvedValue(undefined);
    render(<ConnectedToolsPanel />);
    const row = await screen.findByTestId('mcp-token-row-tok_1');

    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Claude Code' }));
    expect(api.revokeMcpToken).not.toHaveBeenCalled();
    // Cancel path.
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(within(row).getByRole('button', { name: 'Revoke Claude Code' })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Claude Code' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(api.revokeMcpToken).toHaveBeenCalledWith('tok_1'));
    await waitFor(() => expect(within(screen.getByTestId('mcp-token-row-tok_1')).getByText('Revoked')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Revoke Claude Code' })).not.toBeInTheDocument();
  });

  it('MCP URL unset: warns, shows the placeholder for orientation, but never lets it be copied (M6)', async () => {
    arrange([], options, { ...connectInfo, mcpUrl: null });
    vi.mocked(api.createMcpToken).mockResolvedValue({ token: 'omt_x', record: record() });
    render(<ConnectedToolsPanel />);
    expect(await screen.findByTestId('mcp-url-unset')).toHaveTextContent(/OMNIMIND_MCP_PUBLIC_URL/);
    expect(screen.queryByTestId('mcp-connect-info-failed')).not.toBeInTheDocument();
    await clickNewToken();
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
    const created = await screen.findByTestId('mcp-token-created');
    expect(within(created).getByTestId('mcp-url-warning')).toHaveTextContent(/has not set/);
    const block = within(created).getByTestId('mcp-snippet-block-0');
    expect(within(block).getByText(/https:\/\/<your-omnimind-mcp-host>\/mcp/)).toBeInTheDocument();
    const copy = within(block).getByRole('button', { name: 'Copy Terminal' });
    expect(copy).toBeDisabled();
    fireEvent.click(copy);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(within(block).getByTestId('mcp-snippet-block-0-copy-disabled')).toHaveTextContent(/not configured/);
    // The token itself (no URL in it) is still copyable.
    fireEvent.click(within(created).getByRole('button', { name: 'Copy Token' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('omt_x'));
  });

  it('a connect-info fetch failure is reported as such, not as "operator has not set the URL" (M6)', async () => {
    arrange([], options, null);
    vi.mocked(api.createMcpToken).mockResolvedValue({ token: 'omt_x', record: record() });
    render(<ConnectedToolsPanel />);
    const note = await screen.findByTestId('mcp-connect-info-failed');
    expect(note).toHaveTextContent(/Could not load the connection details \(nope\)/);
    expect(screen.queryByTestId('mcp-url-unset')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // tokens + options loaded fine
    await clickNewToken();
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
    const created = await screen.findByTestId('mcp-token-created');
    expect(within(created).getByTestId('mcp-url-warning')).toHaveTextContent(/could not be loaded \(nope\)/);
    expect(within(created).getByTestId('mcp-url-warning')).not.toHaveTextContent(/has not set/);
    expect(within(within(created).getByTestId('mcp-snippet-block-0')).getByRole('button', { name: 'Copy Terminal' })).toBeDisabled();
  });

  it('keeps keyboard focus after Cancel (back on Revoke), after a failed revoke (the row) and after a revoke (the revoked list)', async () => {
    arrange([record()]);
    vi.mocked(api.revokeMcpToken).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render(<ConnectedToolsPanel />);
    const row = await screen.findByTestId('mcp-token-row-tok_1');
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Claude Code' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(within(row).getByRole('button', { name: 'Revoke Claude Code' }));

    // Failed revoke: the row stays, focus lands on it (not on <body>).
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Claude Code' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Revoke Claude Code' })).toBeInTheDocument());
    expect(document.activeElement).toBe(row);

    // Successful revoke: the token moves to the revoked list; focus follows it to that list's summary.
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Claude Code' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(within(screen.getByTestId('mcp-token-row-tok_1')).getByText('Revoked')).toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('mcp-revoked-summary')));
    expect(document.activeElement).toHaveTextContent('1 revoked token');
  });

  it('surfaces a clipboard failure instead of silently doing nothing (L3)', async () => {
    arrange([]);
    vi.mocked(api.createMcpToken).mockResolvedValue({ token: 'omt_x', record: record() });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const execCommand = document.execCommand;
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => false);
    try {
      render(<ConnectedToolsPanel />);
      await clickNewToken();
      fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
      const created = await screen.findByTestId('mcp-token-created');
      fireEvent.click(within(created).getByRole('button', { name: 'Copy Terminal' }));
      const copyBtn = within(created).getByRole('button', { name: 'Copy Terminal' });
      await waitFor(() => expect(copyBtn).toHaveTextContent('Copy failed'));
      expect(within(created).getByText(/Could not reach the clipboard/)).toBeInTheDocument();
      expect(within(created).getByText(/Copy failed — the value is selected/)).toBeInTheDocument();
    } finally {
      (document as unknown as { execCommand: unknown }).execCommand = execCommand;
    }
  });

  it('a lapsed subscription (402 on create) is explained, and the token list / revoke stay usable', async () => {
    arrange([record()]);
    vi.mocked(api.createMcpToken).mockRejectedValue(new api.ApiError('Request failed: 402', 402, { error: 'subscription_required', message: 'Please subscribe to continue' }));
    vi.mocked(api.revokeMcpToken).mockResolvedValue(undefined);
    render(<ConnectedToolsPanel />);
    await clickNewToken();
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/subscription is not active/);
    expect(screen.getByRole('alert')).toHaveTextContent(/can still be revoked/);
    const row = screen.getByTestId('mcp-token-row-tok_1');
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke Claude Code' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(api.revokeMcpToken).toHaveBeenCalledWith('tok_1'));
  });

  it('validation_failed details (422 / upstream 400) render as readable copy, not "Request failed: 422"', async () => {
    arrange([]);
    vi.mocked(api.createMcpToken).mockRejectedValue(new api.ApiError('Request failed: 422', 422, {
      error: 'validation_failed', details: [{ field: 'name', message: 'String must contain at most 60 character(s)' }],
    }));
    render(<ConnectedToolsPanel />);
    await clickNewToken();
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Please check: Token name: String must contain at most 60 character(s).');
    expect(alert).not.toHaveTextContent(/Request failed/);
  });

  it('shows a retryable error when the list fails', async () => {
    vi.mocked(api.listMcpTokens).mockRejectedValueOnce(new Error('OmniMind is down'));
    vi.mocked(api.getMcpTokenOptions).mockResolvedValue(options);
    vi.mocked(api.getMcpConnectInfo).mockResolvedValue(connectInfo);
    render(<ConnectedToolsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('OmniMind is down');
    vi.mocked(api.listMcpTokens).mockResolvedValue({ tokens: [record()] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('mcp-token-row-tok_1')).toBeInTheDocument();
  });
});
