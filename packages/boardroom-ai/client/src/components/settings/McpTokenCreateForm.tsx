import { useMemo, useState, type FormEvent } from 'react';
import { Button, Input, Badge } from '../ui';
import { ApiError, createMcpToken } from '../../lib/api';
import type { McpConnectInfo, McpTokenCreateResponse, McpTokenOptions } from '../../lib/api';
import { CopyField } from './CopyField';
import { McpSnippetView } from './McpSnippetView';
import { MCP_CLIENTS, MCP_URL_PLACEHOLDER, buildSnippet, getClientMeta, type McpClientId } from './mcp-snippets';

type AccessPreset = 'read' | 'write' | 'custom';
type Expiry = '30' | '90' | '365' | 'never';

const EXPIRY_OPTIONS: Array<{ value: Expiry; label: string }> = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'Never expires' },
];

const READ_SCOPE = 'memory:read';

/** Scopes for the "Read & write" preset: every non-admin write scope the catalog offers, plus memory:read. */
export function readWriteScopes(options: McpTokenOptions): string[] {
  const ids = options.scopes
    .filter((s) => s.write && !s.id.toLowerCase().startsWith('admin'))
    .map((s) => s.id);
  return Array.from(new Set([READ_SCOPE, ...ids]));
}

export function describeCreateError(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.body && typeof err.body === 'object' && 'error' in err.body ? String((err.body as { error: unknown }).error) : '';
    if (code === 'tenant_not_owned' || err.status === 403) return 'You are not the owner of that tenant, so a token cannot be issued for it.';
    if (code === 'token_limit' || err.status === 409) return 'You have reached the token limit. Revoke a token you no longer use, then try again.';
    if (err.status === 422 || err.status === 400) return err.message || 'Some fields are invalid.';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Could not create the token.';
}

interface McpTokenCreateFormProps {
  options: McpTokenOptions;
  connectInfo: McpConnectInfo | null;
  /** Fires as soon as OmniMind returns the record (so the list can refresh). */
  onCreated: (result: McpTokenCreateResponse) => void;
  /** Fires when the user dismisses the form or the one-time token view. */
  onDone: () => void;
}

const selectClass = 'bg-card border border-border rounded-xl px-3 h-10 text-sm text-foreground outline-none focus:border-primary/40 focus:ring-2 focus:ring-ring transition-all duration-fast w-full';

export function McpTokenCreateForm({ options, connectInfo, onCreated, onDone }: McpTokenCreateFormProps) {
  const [clientId, setClientId] = useState<McpClientId>('claude-code');
  const [name, setName] = useState(getClientMeta('claude-code').defaultName);
  const [nameTouched, setNameTouched] = useState(false);
  const [tenantId, setTenantId] = useState(options.tenants[0]?.id ?? '');
  const [preset, setPreset] = useState<AccessPreset>('read');
  const [customScopes, setCustomScopes] = useState<string[]>([READ_SCOPE]);
  const [expiry, setExpiry] = useState<Expiry>('90');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<McpTokenCreateResponse | null>(null);

  const writeScopes = useMemo(() => readWriteScopes(options), [options]);
  const scopes = preset === 'read' ? [READ_SCOPE] : preset === 'write' ? writeScopes : customScopes;
  const mcpUrl = connectInfo?.mcpUrl ?? MCP_URL_PLACEHOLDER;

  function pickClient(next: McpClientId) {
    setClientId(next);
    if (!nameTouched) setName(getClientMeta(next).defaultName);
  }

  function toggleScope(id: string) {
    setCustomScopes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Give the token a name.'); return; }
    if (!tenantId) { setError('Pick a tenant.'); return; }
    if (scopes.length === 0) { setError('Select at least one scope.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createMcpToken({
        tenantId,
        name: trimmed,
        scopes,
        ...(expiry === 'never' ? {} : { expiresInDays: Number(expiry) }),
      });
      setCreated(result);
      onCreated(result);
    } catch (err) {
      setError(describeCreateError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    const snippet = buildSnippet(clientId, {
      mcpUrl,
      token: created.token,
      appUrl: connectInfo?.appUrl,
      oauthEnabled: connectInfo?.oauthEnabled,
    });
    return (
      <div className="space-y-5" data-testid="mcp-token-created">
        <div className="rounded-xl border border-warning/40 bg-warning-muted p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">
            Copy your token now. For security it is shown once and cannot be retrieved again.
          </p>
          <CopyField label="Token" value={created.token} secret data-testid="mcp-raw-token" />
          <p className="text-xs text-muted-foreground">
            Named <span className="font-medium text-foreground">{created.record.name}</span>, agent{' '}
            <code className="font-mono">{created.record.agentName}</code>. If you lose it, revoke it and create a new one.
          </p>
        </div>
        {!connectInfo?.mcpUrl && (
          <p className="text-xs text-warning" role="note">
            The server URL below is a placeholder: the operator has not set OMNIMIND_MCP_PUBLIC_URL on BoardRoom.
          </p>
        )}
        <McpSnippetView snippet={snippet} />
        <div className="flex justify-end">
          <Button type="button" variant="primary" onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-label="New MCP token" data-testid="mcp-token-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mcp-client" className="text-sm font-medium text-muted-foreground">AI client</label>
          <select id="mcp-client" value={clientId} onChange={(e) => pickClient(e.target.value as McpClientId)} className={selectClass}>
            {MCP_CLIENTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">{getClientMeta(clientId).hint}. This only shapes the install snippet.</p>
        </div>

        <Input
          id="mcp-token-name"
          label="Token name"
          value={name}
          maxLength={60}
          onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
          placeholder="e.g. Claude Code on my laptop"
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="mcp-tenant" className="text-sm font-medium text-muted-foreground">Tenant</label>
          <select id="mcp-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={selectClass}>
            {options.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="mcp-expiry" className="text-sm font-medium text-muted-foreground">Expires</label>
          <select id="mcp-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)} className={selectClass}>
            {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-muted-foreground mb-1.5">Access</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            { id: 'read', label: 'Read-only', desc: 'Search and read memory' },
            { id: 'write', label: 'Read & write', desc: 'Also log decisions, tasks, commitments' },
            { id: 'custom', label: 'Custom', desc: 'Pick individual scopes' },
          ] as Array<{ id: AccessPreset; label: string; desc: string }>).map((p) => (
            <label
              key={p.id}
              className={`flex cursor-pointer flex-col gap-0.5 rounded-xl border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring ${
                preset === p.id ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mcp-access"
                  value={p.id}
                  checked={preset === p.id}
                  onChange={() => setPreset(p.id)}
                  className="accent-primary"
                />
                <span className="font-medium text-foreground">{p.label}</span>
              </span>
              <span className="text-xs text-muted-foreground pl-6">{p.desc}</span>
            </label>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2" data-testid="mcp-custom-scopes">
            {options.scopes.map((s) => (
              <label key={s.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  checked={customScopes.includes(s.id)}
                  onChange={() => toggleScope(s.id)}
                  className="mt-0.5 accent-primary"
                />
                <span className="flex flex-col">
                  <code className="font-mono text-xs text-foreground">{s.id}</code>
                  <span className="text-xs text-muted-foreground">{s.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Scopes that will be granted">
          {scopes.map((s) => <Badge key={s} variant="accent">{s}</Badge>)}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting || options.tenants.length === 0}>
          {submitting ? 'Creating…' : 'Create token'}
        </Button>
      </div>
    </form>
  );
}
