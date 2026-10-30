import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Badge, Card, Skeleton, useToastStore } from '../ui';
import { getMcpConnectInfo, getMcpTokenOptions, listMcpTokens, revokeMcpToken } from '../../lib/api';
import type { McpConnectInfo, McpTokenCreateResponse, McpTokenOptions, McpTokenRecord } from '../../lib/api';
import { McpTokenCreateForm } from './McpTokenCreateForm';
import { getClientMeta, inferClientFromName } from './mcp-snippets';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function isExpired(t: McpTokenRecord, now = Date.now()): boolean {
  return Boolean(t.expiresAt) && new Date(t.expiresAt as string).getTime() < now;
}

interface TokenRowProps {
  token: McpTokenRecord;
  onRevoke: (id: string) => Promise<void>;
}

function TokenRow({ token, onRevoke }: TokenRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const revokeBtnRef = useRef<HTMLButtonElement>(null);
  /** Where focus should land once the confirm group unmounts: the row (after a revoke) or the Revoke button (after Cancel). */
  const restoreFocus = useRef<'row' | 'button' | null>(null);
  const revoked = Boolean(token.revokedAt);
  const expired = !revoked && isExpired(token);
  const clientId = inferClientFromName(token.name);

  // The confirm buttons unmount when `confirming` flips back, which would drop
  // focus to <body>; move it somewhere sensible instead (a11y, L3). Cancel →
  // the Revoke button; a failed revoke → the row. A successful revoke moves the
  // token to the revoked list (a new row instance), so the panel handles that case.
  useEffect(() => {
    if (confirming || !restoreFocus.current) return;
    const target = restoreFocus.current;
    restoreFocus.current = null;
    if (target === 'button' && revokeBtnRef.current) revokeBtnRef.current.focus();
    else rowRef.current?.focus();
  }, [confirming, revoked]);

  async function confirmRevoke() {
    setBusy(true);
    try {
      await onRevoke(token.id);
    } finally {
      setBusy(false);
      restoreFocus.current = 'row';
      setConfirming(false);
    }
  }

  function cancelRevoke() {
    restoreFocus.current = 'button';
    setConfirming(false);
  }

  return (
    <li
      ref={rowRef}
      tabIndex={-1}
      className={`rounded-xl border border-border p-4 space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring ${revoked ? 'opacity-60' : ''}`}
      data-testid={`mcp-token-row-${token.id}`}
      aria-label={`Token ${token.name}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground truncate">{token.name}</span>
            {clientId && <Badge variant="info">{getClientMeta(clientId).label}</Badge>}
            {revoked && <Badge variant="danger">Revoked</Badge>}
            {expired && <Badge variant="warning">Expired</Badge>}
          </div>
          <code className="block font-mono text-xs text-muted-foreground">{token.prefix}…</code>
        </div>
        {!revoked && (
          confirming ? (
            <div className="flex items-center gap-2" role="group" aria-label={`Confirm revoking ${token.name}`}>
              <span className="text-xs text-muted-foreground">Revoke this token?</span>
              <Button variant="danger" size="sm" onClick={confirmRevoke} disabled={busy} autoFocus>
                {busy ? 'Revoking…' : 'Confirm revoke'}
              </Button>
              <Button variant="ghost" size="sm" onClick={cancelRevoke} disabled={busy}>Cancel</Button>
            </div>
          ) : (
            <Button ref={revokeBtnRef} variant="secondary" size="sm" onClick={() => setConfirming(true)} aria-label={`Revoke ${token.name}`}>
              Revoke
            </Button>
          )
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="Scopes">
        {token.scopes.map((s) => <Badge key={s} variant="accent">{s}</Badge>)}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Tenant</dt><dd className="text-foreground truncate">{token.tenantId}</dd></div>
        <div><dt className="text-muted-foreground">Created</dt><dd className="text-foreground">{formatDate(token.createdAt)}</dd></div>
        <div><dt className="text-muted-foreground">Last used</dt><dd className="text-foreground">{token.lastUsedAt ? formatDate(token.lastUsedAt) : 'Never'}</dd></div>
        <div><dt className="text-muted-foreground">Expires</dt><dd className="text-foreground">{token.expiresAt ? formatDate(token.expiresAt) : 'Never'}</dd></div>
      </dl>
    </li>
  );
}

/**
 * Settings → "Connected AI tools": personal MCP tokens for Claude, ChatGPT,
 * Cursor and friends. Local state + the api client (SettingsPage uses no store).
 */
export function ConnectedToolsPanel() {
  const addToast = useToastStore((s) => s.addToast);
  const [tokens, setTokens] = useState<McpTokenRecord[]>([]);
  const [options, setOptions] = useState<McpTokenOptions | null>(null);
  const [connectInfo, setConnectInfo] = useState<McpConnectInfo | null>(null);
  const [connectInfoError, setConnectInfoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const revokedSummaryRef = useRef<HTMLElement>(null);
  const newTokenRef = useRef<HTMLButtonElement>(null);
  /** Set after a successful revoke: the row moves to the revoked list (a new instance), so focus is restored here, not in the row. */
  const [focusAfterRevoke, setFocusAfterRevoke] = useState(false);

  /** Set when the form or the token reveal closes (Cancel / Done): it unmounts under focus, so "New token" takes it back. */
  const [focusNewToken, setFocusNewToken] = useState(false);
  useEffect(() => {
    if (!focusNewToken || creating) return;
    setFocusNewToken(false);
    newTokenRef.current?.focus();
  }, [focusNewToken, creating]);

  useEffect(() => {
    if (!focusAfterRevoke) return;
    setFocusAfterRevoke(false);
    (revokedSummaryRef.current ?? newTokenRef.current)?.focus();
  }, [focusAfterRevoke, tokens]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tokensRes, optionsRes, infoRes] = await Promise.allSettled([
      listMcpTokens(),
      getMcpTokenOptions(),
      getMcpConnectInfo(),
    ]);
    if (tokensRes.status === 'fulfilled') setTokens(tokensRes.value.tokens ?? []);
    if (optionsRes.status === 'fulfilled') setOptions(optionsRes.value);
    if (infoRes.status === 'fulfilled') {
      setConnectInfo(infoRes.value);
      setConnectInfoError(null);
    } else {
      // Distinct from "configured without a URL": the request itself failed.
      setConnectInfo(null);
      setConnectInfoError(infoRes.reason instanceof Error ? infoRes.reason.message : 'Could not load the connection details');
    }
    const failed = [tokensRes, optionsRes].find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      const reason = failed.reason;
      setError(reason instanceof Error ? reason.message : 'Could not load connected tools');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function handleCreated(result: McpTokenCreateResponse) {
    setTokens((prev) => [result.record, ...prev]);
  }

  async function handleRevoke(id: string) {
    try {
      await revokeMcpToken(id);
      const now = new Date().toISOString();
      setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, revokedAt: now } : t)));
      setFocusAfterRevoke(true);
      addToast('Token revoked', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Could not revoke token', 'error');
    }
  }

  const hasTenant = (options?.tenants.length ?? 0) > 0;
  const active = tokens.filter((t) => !t.revokedAt);
  const revoked = tokens.filter((t) => t.revokedAt);

  return (
    <Card className="p-6" data-testid="connected-tools-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="text-lg font-medium text-foreground">Connected AI tools</h2>
          <p className="text-sm text-muted-foreground">
            Give Claude Code, Cursor, ChatGPT or any MCP client access to your OmniMind memory with a personal token.
            Clients that accept a header need no OAuth setup; the install snippet tells you when a client does.
          </p>
        </div>
        {!creating && (
          <Button ref={newTokenRef} variant="primary" size="sm" onClick={() => setCreating(true)} disabled={loading || !hasTenant}>
            New token
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3 mt-4" aria-busy="true" aria-label="Loading connected tools">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-4 mt-4">
          {error && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger">
              <span>{error}</span>
              <Button variant="ghost" size="sm" onClick={() => void load()}>Retry</Button>
            </div>
          )}

          {connectInfo && !connectInfo.mcpUrl && (
            <p className="rounded-xl border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-foreground" role="note" data-testid="mcp-url-unset">
              The public MCP URL is not configured. Snippets will show a placeholder (and its Copy buttons stay disabled) until the operator sets{' '}
              <code className="font-mono">OMNIMIND_MCP_PUBLIC_URL</code> on BoardRoom.
            </p>
          )}

          {!connectInfo && connectInfoError && (
            <p className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-foreground" role="note" data-testid="mcp-connect-info-failed">
              <span>Could not load the connection details ({connectInfoError}). You can still create and revoke tokens; snippets will show a placeholder URL until this loads.</span>
              <Button variant="ghost" size="sm" onClick={() => void load()}>Retry</Button>
            </p>
          )}

          {options && !hasTenant && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center" data-testid="mcp-no-tenant">
              <h3 className="text-base font-medium text-foreground mb-1">No tenant is assigned to your account yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Tokens are issued per tenant. Ask your operator to set you as the tenant owner in OmniMind
                (the tenant&apos;s <code className="font-mono">ownerUserId</code>), then reload this page.
              </p>
            </div>
          )}

          {creating && options && (
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <McpTokenCreateForm
                options={options}
                connectInfo={connectInfo}
                connectInfoError={connectInfoError}
                onCreated={handleCreated}
                onDone={() => { setCreating(false); setFocusNewToken(true); }}
              />
            </div>
          )}

          {hasTenant && tokens.length === 0 && !creating && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center" data-testid="mcp-empty">
              <h3 className="text-base font-medium text-foreground mb-1">No tokens yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create one to connect your first AI client. You will get a ready-to-paste install snippet.
              </p>
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>Create your first token</Button>
            </div>
          )}

          {active.length > 0 && (
            <ul className="space-y-3" aria-label="Active tokens">
              {active.map((t) => <TokenRow key={t.id} token={t} onRevoke={handleRevoke} />)}
            </ul>
          )}

          {revoked.length > 0 && (
            <details className="group">
              <summary
                ref={revokedSummaryRef}
                tabIndex={0}
                className="cursor-pointer rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="mcp-revoked-summary"
              >
                {revoked.length} revoked token{revoked.length === 1 ? '' : 's'}
              </summary>
              <ul className="space-y-3 mt-3" aria-label="Revoked tokens">
                {revoked.map((t) => <TokenRow key={t.id} token={t} onRevoke={handleRevoke} />)}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
