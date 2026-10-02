import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { KnowledgeGraph, KnowledgeGraphNode, KnowledgeGraphNodeType } from '@boardroom/shared';
import * as api from '../lib/api';
import { usePageTitle } from '../hooks/usePageTitle';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { EmptyState, Skeleton } from '../components/ui';
import { KnowledgeGraphView, type KnowledgeGraphViewHandle } from '../components/graph/KnowledgeGraphView';
import { GraphControls, type GraphFilters } from '../components/graph/GraphControls';
import { NodeInspector } from '../components/graph/NodeInspector';
import { NODE_TYPES } from '../components/graph/graph-theme';
import { cn } from '../lib/cn';

const STORAGE_KEY = 'boardroom.graph.filters.v1';

function loadFilters(): GraphFilters {
  const base: GraphFilters = { types: new Set(NODE_TYPES), domain: 'all', showOrphans: false, showLabels: true, depth: 0 };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const j = JSON.parse(raw) as Partial<{ types: KnowledgeGraphNodeType[]; domain: string; showOrphans: boolean; showLabels: boolean }>;
    return {
      ...base,
      types: new Set(j.types?.length ? j.types : NODE_TYPES),
      domain: j.domain ?? 'all',
      showOrphans: j.showOrphans ?? false,
      showLabels: j.showLabels ?? true,
    };
  } catch { return base; }
}

function saveFilters(f: GraphFilters) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ types: [...f.types], domain: f.domain, showOrphans: f.showOrphans, showLabels: f.showLabels }));
  } catch { /* storage unavailable — fine */ }
}

/** BFS from a root up to `depth` hops; returns distance per reachable node. */
function neighbourhood(root: string, adjacency: Map<string, Set<string>>, depth: number): Map<string, number> {
  const dist = new Map<string, number>([[root, 0]]);
  let frontier = [root];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adjacency.get(id) ?? []) {
        if (!dist.has(nb)) { dist.set(nb, d); next.push(nb); }
      }
    }
    frontier = next;
  }
  return dist;
}

export default function GraphPage() {
  usePageTitle('Knowledge Graph');
  const [params, setParams] = useSearchParams();
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersState] = useState<GraphFilters>(loadFilters);
  const [selectedId, setSelectedId] = useState<string | null>(params.get('focus'));
  const [hoverId, setHoverId] = useState<string | null>(null);
  const viewRef = useRef<KnowledgeGraphViewHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const setFilters = useCallback((f: GraphFilters) => { setFiltersState(f); saveFilters(f); }, []);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setGraph(await api.getKnowledgeGraph({ memoryLimit: 200 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the graph');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // ── Keep ?focus= in the URL so a node is shareable / reload-safe ──────────
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (selectedId) next.set('focus', selectedId); else next.delete('focus');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard: "/" focuses search, Esc clears selection ───────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape' && !typing) setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────
  const nodesById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graph?.edges ?? []) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [graph]);
  const domains = useMemo(() => {
    const s = new Set<string>();
    for (const n of graph?.nodes ?? []) if (n.domain) s.add(n.domain);
    return [...s].sort();
  }, [graph]);

  const { nodes, edges, depthById } = useMemo(() => {
    if (!graph) return { nodes: [] as KnowledgeGraphNode[], edges: [], depthById: undefined as Map<string, number> | undefined };
    let keep = new Set<string>();
    for (const n of graph.nodes) {
      if (!filters.types.has(n.type)) continue;
      if (filters.domain !== 'all' && n.domain !== null && n.domain !== filters.domain) continue;
      keep.add(n.id);
    }
    // Domain filter: domain-less nodes stay only if they touch a kept domain node
    if (filters.domain !== 'all') {
      const anchored = new Set<string>();
      for (const id of keep) if (nodesById.get(id)!.domain === filters.domain) anchored.add(id);
      for (const id of keep) {
        if (anchored.has(id)) continue;
        const touches = [...(adjacency.get(id) ?? [])].some((nb) => anchored.has(nb));
        if (touches) anchored.add(id);
      }
      keep = anchored;
    }
    let depth: Map<string, number> | undefined;
    if (selectedId && filters.depth > 0 && keep.has(selectedId)) {
      // local graph: BFS over the kept subgraph
      const sub = new Map<string, Set<string>>();
      for (const e of graph.edges) {
        if (!keep.has(e.source) || !keep.has(e.target)) continue;
        if (!sub.has(e.source)) sub.set(e.source, new Set());
        if (!sub.has(e.target)) sub.set(e.target, new Set());
        sub.get(e.source)!.add(e.target); sub.get(e.target)!.add(e.source);
      }
      depth = neighbourhood(selectedId, sub, filters.depth);
      keep = new Set(depth.keys());
    }
    const es = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
    if (!filters.showOrphans) {
      const linked = new Set<string>();
      for (const e of es) { linked.add(e.source); linked.add(e.target); }
      if (selectedId) linked.add(selectedId);
      keep = new Set([...keep].filter((id) => linked.has(id)));
    }
    return { nodes: graph.nodes.filter((n) => keep.has(n.id)), edges: es, depthById: depth };
  }, [graph, filters, selectedId, nodesById, adjacency]);

  const visibleCounts = useMemo(() => {
    const c: Record<KnowledgeGraphNodeType, number> = { goal: 0, project: 0, task: 0, person: 0, decision: 0, commitment: 0, memory: 0 };
    for (const n of graph?.nodes ?? []) if (filters.domain === 'all' || n.domain === null || n.domain === filters.domain) c[n.type] += 1;
    return c;
  }, [graph, filters.domain]);

  const selected = selectedId ? nodesById.get(selectedId) ?? null : null;
  const hovered = hoverId ? nodesById.get(hoverId) ?? null : null;

  const pick = useCallback((id: string) => {
    setSelectedId(id);
    // Give the simulation a frame to include the node, then centre on it
    requestAnimationFrame(() => viewRef.current?.focusNode(id));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  const total = graph?.nodes.length ?? 0;
  const truncated = graph?.stats.memoryLimitHit ?? false;

  return (
    <div className="flex h-[calc(100dvh-var(--header-h,0px))] min-h-[520px] flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Knowledge Graph</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : total === 0 ? 'No linked entities yet.' : (
              <>
                <span className="tabular-nums text-foreground">{nodes.length}</span> of <span className="tabular-nums">{total}</span> nodes ·{' '}
                <span className="tabular-nums">{edges.length}</span> links
                {truncated && ' · memories capped at 200 by importance'}
              </>
            )}
          </p>
        </div>
        {hovered && !selected && (
          <div className="hidden text-xs text-muted-foreground md:block">
            Hovering <span className="text-foreground">{hovered.label}</span>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {graph && total > 0 && (
        <GraphControls
          filters={filters}
          onChange={setFilters}
          counts={visibleCounts}
          domains={domains}
          nodes={graph.nodes}
          hasSelection={!!selected}
          onPick={pick}
          onFit={() => viewRef.current?.zoomToFit()}
          searchRef={searchRef}
        />
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
        {loading && !graph ? (
          <div className="flex h-full flex-col gap-3 p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-full w-full" />
          </div>
        ) : total === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              title="Your graph is empty"
              description="Goals, projects, tasks, people, decisions and memories appear here once they are linked. Run a decision session or link a memory to a project to start the web."
            />
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              title="Nothing matches these filters"
              description="Turn a type back on, switch domain to All, or show orphans."
              action={{ label: 'Reset filters', onClick: () => setFilters({ ...filters, types: new Set(NODE_TYPES), domain: 'all', showOrphans: false, depth: 0 }) }}
            />
          </div>
        ) : (
          <div className="flex h-full">
            <KnowledgeGraphView
              ref={viewRef}
              nodes={nodes}
              edges={edges}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onHoverChange={setHoverId}
              showLabels={filters.showLabels}
              depthById={depthById}
              className="h-full min-w-0 flex-1"
            />
            {selected && (
              <NodeInspector
                node={selected}
                nodesById={nodesById}
                edges={graph!.edges}
                onSelect={pick}
                onFocusLocal={() => setFilters({ ...filters, depth: filters.depth === 0 ? 2 : filters.depth })}
                onClose={() => setSelectedId(null)}
                className={cn(
                  'w-full max-w-[340px] shrink-0 border-l border-border',
                  'max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[55%] max-md:max-w-none max-md:border-l-0 max-md:border-t',
                )}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
