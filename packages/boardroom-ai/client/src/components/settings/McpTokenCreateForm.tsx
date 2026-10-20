import { useMemo, useState, type FormEvent } from 'react';
import { McpScopesSchema, type McpScope } from '@boardroom/shared';
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
  { value: 'never', label: 'Never (not recommended)' },
];
/** Matches OmniMind's default when `expiresInDays` is omitted. */
export const DEFAULT_EXPIRY: Expiry = '365';

const READ_SCOPE: McpScope = 'memory:read';

/** Scopes for the "Read & write" preset: every non-admin write scope the catalog offers, plus memory:read. */
export function readWriteScopes(options: { scopes: ReadonlyArray<{ id: string; write: boolean; description?: string }>; tenants?: unknown }): string[] {
  const ids = options.scopes
    .filter((s) => s.write && !s.id.toLowerCase().startsWith('admin'))
    .map((s) => s.id);
  return Array.from(new Set([READ_SCOPE, ...ids]));
}

const FIELD_LABEL: Record<string, string> = {
  name: 'Token name',
  tenantId: 'Tenant',
  scopes: 'Scopes',
  expiresInDays: 'Expiry',
  sourceWeight: 'Source weight',
};

function fieldLabel(path: string): string {
  const root = path.split('.')[0];
  return FIELD_LABEL[root] ?? root;
}

/**
 * Turn a `validation_failed` body into one readable sentence. Handles both
 * shapes that reach the browser: BoardRoom's `details: [{ field, message }]`
 * and OmniMind's zod `flatten()` (`details: { formErrors, fieldErrors }`).
 */
export function describeValidationDetails(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const details = (body as { details?: unknown }).details;
  const parts: string[] = [];
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d && typeof d === 'object') {
        const { field, message } = d as { field?: unknown; message?: unknown };
        const msg = typeof message === 'string' ? message : '';
        if (typeof field === 'string' && field) parts.push(`${fieldLabel(field)}: ${msg || 'invalid'}`);
        else if (msg) parts.push(msg);
      } else if (typeof d === 'string') parts.push(d);
    }
  } else if (details && typeof details === 'object') {
    const { formErrors, fieldErrors } = details as { formErrors?: unknown; fieldErrors?: unknown };
    if (Array.isArray(formErrors)) parts.push(...formErrors.filter((e): e is string => typeof e === 'string'));
    if (fieldErrors && typeof fieldErrors === 'object') {
      for (const [k, v] of Object.entries(fieldErrors as Record<string, unknown>)) {
        if (Array.isArray(v) && v.length) parts.push(`${fieldLabel(k)}: ${v.join(', ')}`);
      }
    }
  }
  return parts.length ? `Please check: ${parts.join('; ')}.` : null;
}

export function describeCreateError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body && typeof err.body === 'object' ? (err.body as { error?: unknown; message?: unknown }) : null;
    const code = body && 'error' in body ? String(body.error) : '';
    const upstreamMessage = body && typeof body.message === 'string' ? body.message : '';
    if (code === 'tenant_not_owned' || err.status === 403) return 'You are not the owner of that tenant, so a token cannot be issued for it.';
    if (code === 'token_limit' || err.status === 409) return 'You have reached the token limit. Revoke a token you no longer use, then try again.';
    if (code === 'subscription_required' || code === 'subscription_expired' || err.status === 402) {
      return 'Your subscription is not active, so new tokens cannot be created. Existing tokens keep working and can still be revoked here.';
    }
    if (err.status === 422 || err.status === 400 || code === 'validation_failed') {
      return describeValidationDetails(err.body) ?? (upstreamMessage || err.message || 'Some fields are invalid.');
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Could not create the token.';
}

interface McpTokenCreateFormProps {
  options: McpTokenOptions;
  connectInfo: McpConnectInfo | null;
  /** Set when /mcp/tokens/connect-info itself failed (distinct from "configured without a URL"). */
  connectInfoError?: string | null;
  /** Fires as soon as OmniMind returns the record (so the list can refresh). */
  onCreated: (result: McpTokenCreateResponse) => void;
  /** Fires when the user dismisses the form or the one-time token view. */
  onDone: () => void;
}

const selectClass = 'bg-card border border-border rounded-control px-3 h-10 text-sm text-foreground outline-none hover:border-hairline-strong focus:border-primary/40 focus:ring-2 focus:ring-ring transition-[border-color,box-shadow] duration-fast ease-out w-full';

export function McpTokenCreateForm({ options, connectInfo, connectInfoError = null, onCreated, onDone }: McpTokenCreateFormProps) {
  const [clientId, setClientId] = useState<McpClientId>('claude-code');
  const [name, setName] = useState(getClientMeta('claude-code').defaultName);
  const [nameTouched, setNameTouched] = useState(false);
  const [tenantId, setTenantId] = useState(options.tenants[0]?.id ?? '');
  const [preset, setPreset] = useState<AccessPreset>('read');
  const [customScopes, setCustomScopes] = useState<string[]>([READ_SCOPE]);
  const [expiry, setExpiry] = useState<Expiry>(DEFAULT_EXPIRY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<McpTokenCreateResponse | null>(null);

  const writeScopes = useMemo(() => readWriteScopes(options), [options]);
  const scopes = preset === 'read' ? [READ_SCOPE] : preset === 'write' ? writeScopes : customScopes;
  const mcpUrl = connectInfo?.mcpUrl ?? null;
  const urlMissing = !mcpUrl;

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
    // Validate against the shared contract before the request leaves the browser.
    const parsedScopes = McpScopesSchema.safeParse(scopes);
    if (!parsedScopes.success) {
      setError(`Scopes: ${parsedScopes.error.issues.map((i) => i.message).join('; ')}.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createMcpToken({
        tenantId,
        name: trimmed,
        scopes: parsedScopes.data,
        expiresInDays: expiry === 'never' ? null : Number(expiry),
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
      mcpUrl: mcpUrl ?? MCP_URL_PLACEHOLDER,
      token: created.token,
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
        {urlMissing && (
          <p className="text-xs text-warning" role="note" data-testid="mcp-url-warning">
            {connectInfoError
              ? <>The server URL could not be loaded ({connectInfoError}). The blocks below show a placeholder and cannot be copied; reload this page to try again, or ask your operator for the MCP URL.</>
              : <>The server URL below is a placeholder: the operator has not set <code className="font-mono">OMNIMIND_MCP_PUBLIC_URL</code> on BoardRoom. Blocks that contain it cannot be copied until it is configured.</>}
          </p>
        )}
        <McpSnippetView snippet={snippet} placeholderUrl={urlMissing} />
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
