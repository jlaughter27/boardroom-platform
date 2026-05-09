import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { PageWrapper, Button, Skeleton } from '../components/ui';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { fadeIn } from '../lib/motion';
import * as api from '../lib/api';
import type { AdminStats, AdminAgent, AdminAuditEntry, AdminMemory, AdminContradiction } from '../lib/api';

type Tab = 'overview' | 'memories' | 'audit' | 'agents' | 'contradictions';

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const ms = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function truncate(s: string, n = 60): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

function OverviewTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);

  useEffect(() => {
    api.getAdminStats()
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSummarize() {
    setSummarizing(true);
    setSummaryMsg(null);
    try {
      const result = await api.triggerAdminSummarize();
      setSummaryMsg(result.message);
    } catch (e) {
      setSummaryMsg((e as Error).message);
    } finally {
      setSummarizing(false);
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} onDismiss={() => setError(null)} />;
  if (!stats) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Memories" value={stats.memories} />
        <StatCard label="Session Summaries" value={stats.sessionSummaries} />
        <StatCard label="Agents" value={stats.agents} />
        <StatCard label="Tenants" value={stats.tenants} />
        <StatCard label="Audit Entries" value={stats.auditEntries} />
        <StatCard label="Last Activity" value={relativeTime(stats.lastActivity)} />
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={handleSummarize} disabled={summarizing}>
          {summarizing ? 'Running…' : 'Trigger Session Summarizer'}
        </Button>
        {summaryMsg && <p className="text-sm text-muted-foreground">{summaryMsg}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memories tab
// ---------------------------------------------------------------------------

function MemoriesTab() {
  const [memories, setMemories] = useState<AdminMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const load = useCallback((search: string, src: string, off: number) => {
    setLoading(true);
    api.getAdminMemories({ q: search || undefined, sourceType: src || undefined, limit, offset: off })
      .then((r) => { setMemories(r.memories); setTotal(r.total); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(q, sourceType, offset); }, [load, q, sourceType, offset]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOffset(0); }}
          className="flex-1 px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <select
          value={sourceType}
          onChange={(e) => { setSourceType(e.target.value); setOffset(0); }}
          className="px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground focus:outline-none"
        >
          <option value="">All sources</option>
          <option value="MANUAL">Manual</option>
          <option value="MCP_AGENT">MCP Agent</option>
          <option value="SESSION_SUMMARY">Session Summary</option>
          <option value="AGENT_EXTRACTED">Agent Extracted</option>
          <option value="BOARDROOM_SESSION">Boardroom Session</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <p className="text-xs text-muted-foreground">{total} total</p>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-md" />)}</div>
      ) : (
        <div className="space-y-2">
          {memories.map((m) => (
            <div key={m.id} className="bg-card border border-border rounded-md p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-foreground truncate">{m.title}</p>
                <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(m.createdAt)}</span>
              </div>
              <p className="text-muted-foreground mt-0.5">{truncate(m.content)}</p>
              <div className="flex gap-2 mt-1">
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{m.sourceType}</span>
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{m.domain}</span>
                {m.agentId && <span className="text-xs text-muted-foreground">{m.agentId}</span>}
              </div>
            </div>
          ))}
          {memories.length === 0 && <p className="text-sm text-muted-foreground">No memories found.</p>}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit tab
// ---------------------------------------------------------------------------

function AuditTab() {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const load = useCallback((off: number) => {
    setLoading(true);
    api.getAdminAudit({ limit, offset: off })
      .then((r) => { setEntries(r.entries); setTotal(r.total); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(offset); }, [load, offset]);

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <p className="text-xs text-muted-foreground">{total} total entries</p>
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 rounded-md" />)}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-3">Tool</th>
                <th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3">Tenant</th>
                <th className="py-2 pr-3">Duration</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-1.5 pr-3 font-mono text-foreground">{e.toolName}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground truncate max-w-[120px]">{e.agentId}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground truncate max-w-[100px]">{e.tenantId}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{e.durationMs}ms</td>
                  <td className="py-1.5 pr-3">
                    {e.errorMessage
                      ? <span className="text-destructive">error</span>
                      : <span className="text-green-600 dark:text-green-400">ok</span>
                    }
                  </td>
                  <td className="py-1.5 text-muted-foreground">{relativeTime(e.createdAt)}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No audit entries.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agents tab
// ---------------------------------------------------------------------------

function AgentsTab() {
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdminAgents()
      .then((r) => setAgents(r.agents))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-md" />)}</div>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => (
            <div key={a.id} className="bg-card border border-border rounded-md p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{a.tenantId} · weight {a.sourceWeight}</p>
                </div>
                <span className="text-xs text-muted-foreground">Last: {relativeTime(a.lastSeenAt)}</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {a.scopes.map((s) => (
                  <span key={s} className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{s}</span>
                ))}
              </div>
            </div>
          ))}
          {agents.length === 0 && <p className="text-sm text-muted-foreground">No agents registered.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contradictions tab
// ---------------------------------------------------------------------------

function ContradictionsTab() {
  const [alerts, setAlerts] = useState<AdminContradiction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdminContradictions()
      .then((r) => { setAlerts(r.alerts); setTotal(r.total); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <p className="text-xs text-muted-foreground">{total} unresolved</p>
      {loading ? (
        <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-md" />)}</div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className="bg-card border border-border rounded-md p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-foreground">{a.description}</p>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  a.severity === 'HIGH' ? 'bg-destructive/10 text-destructive' :
                  a.severity === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                  'bg-muted text-muted-foreground'
                }`}>{a.severity}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Detected {relativeTime(a.detectedAt)}</p>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No unresolved contradictions.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdminPage
// ---------------------------------------------------------------------------

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'memories', label: 'Memories' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'agents', label: 'Agents' },
  { id: 'contradictions', label: 'Contradictions' },
];

export default function AdminPage() {
  usePageTitle('Admin');
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <PageWrapper>
      <motion.div {...fadeIn} className="p-6 h-full flex flex-col min-h-0">
        <h1 className="text-2xl font-semibold text-foreground mb-1">Admin</h1>
        <p className="text-sm text-muted-foreground mb-5">MCP memory layer overview — cross-agent, cross-tenant.</p>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border mb-5">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === 'overview' && <OverviewTab />}
          {tab === 'memories' && <MemoriesTab />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'agents' && <AgentsTab />}
          {tab === 'contradictions' && <ContradictionsTab />}
        </div>
      </motion.div>
    </PageWrapper>
  );
}
