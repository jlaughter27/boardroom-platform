import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { KnowledgeGraph, KnowledgeGraphEdgeType, KnowledgeGraphNode, KnowledgeGraphNodeType } from '@boardroom/shared';
import * as api from '../lib/api';
import { usePageTitle } from '../hooks/usePageTitle';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { EmptyState, Skeleton } from '../components/ui';
import { KnowledgeGraphView, type KnowledgeGraphViewHandle, type SpotlightState } from '../components/graph/KnowledgeGraphView';
import { GraphControls, type GraphFilters } from '../components/graph/GraphControls';
import { NodeInspector } from '../components/graph/NodeInspector';
import { UnlinkedMentionsPanel } from '../components/graph/UnlinkedMentionsPanel';
import { FocusHistoryBar } from '../components/graph/FocusHistoryBar';
import { SpotlightBar } from '../components/graph/SpotlightBar';
import { GraphTimeline } from '../components/graph/GraphTimeline';
import { NODE_TYPES } from '../components/graph/graph-theme';
import { EDGE_TYPES, filterByEdgeTypes } from '../components/graph/graph-filters';
import {
  canGoBack, canGoForward, createFocusHistory, currentFocus, goBack, goForward, pushFocus, type FocusHistory,
} from '../components/graph/graph-focus';
import { applyTimeline, type TimeWindow } from '../components/graph/graph-timeline';
import { maxScore, mergeBacklinks, missingHitIds, scoreMap } from '../components/graph/graph-search';
import { useGraphStore } from '../stores/graph.store';
import { useCommandPaletteStore } from '../stores/commandPalette.store';
import { cn } from '../lib/cn';

const STORAGE_KEY = 'boardroom.graph.filters.v2';
const DEFAULT_DEPTH: GraphFilters['depth'] = 2; // local-first
const LAZY_FETCH_BATCH = 12;

function loadFilters(): GraphFilters {
  const base: GraphFilters = {
    types: new Set(NODE_TYPES), edgeTypes: new Set(EDGE_TYPES), domain: 'all', showOrphans: false, showLabels: true, depth: DEFAULT_DEPTH,
  };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const j = JSON.parse(raw) as Partial<{
      types: KnowledgeGraphNodeType[]; edgeTypes: KnowledgeGraphEdgeType[]; domain: string; showOrphans: boolean; showLabels: boolean; depth: number;
    }>;
    const depth = typeof j.depth === 'number' && [0, 1, 2, 3].includes(j.depth) ? (j.depth as GraphFilters['depth']) : DEFAULT_DEPTH;
    return {
      ...base,
      types: new Set(j.types?.length ? j.types : NODE_TYPES),
      edgeTypes: new Set(j.edgeTypes?.length ? j.edgeTypes.filter((t) => EDGE_TYPES.includes(t)) : EDGE_TYPES),
      domain: j.domain ?? 'all',
      showOrphans: j.showOrphans ?? false,
      showLabels: j.showLabels ?? true,
      depth,
    };
  } catch { return base; }
}

function saveFilters(f: GraphFilters) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      types: [...f.types], edgeTypes: [...f.edgeTypes], domain: f.domain, showOrphans: f.showOrphans, showLabels: f.showLabels, depth: f.depth,
    }));
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

function openSpotlightPalette() {
  useGraphStore.getState().setPaletteMode('memory');
  const palette = useCommandPaletteStore.getState();
  if (!palette.open) palette.toggle();
}

export default function GraphPage() {
  usePageTitle('Knowledge Graph');
  const [params, setParams] = useSearchParams();
  const initialFocus = params.get('focus');
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersState] = useState<GraphFilters>(loadFilters);
  const [selectedId, setSelectedId] = useState<string | null>(initialFocus);
  const [history, setHistory] = useState<FocusHistory>(() => (initialFocus ? pushFocus(createFocusHistory(), initialFocus) : createFocusHistory()));
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionCount, setMentionCount] = useState<number | null>(null);
  const [tlWindow, setTlWindow] = useState<TimeWindow | null>(null);
  const [tlHide, setTlHide] = useState(false);
  const [fetchingMissing, setFetchingMissing] = useState(false);
  const viewRef = useRef<KnowledgeGraphViewHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const attemptedFetch = useRef(new Set<string>());
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false),
    [],
  );

  const spotlight = useGraphStore((s) => s.spotlight);
  const focusRequest = useGraphStore((s) => s.focusRequest);

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

  /** Silent refetch after a link is created (keeps the current render while loading). */
  const refetch = useCallback(async () => {
    try {
      const fresh = await api.getKnowledgeGraph({ memoryLimit: 200 });
      attemptedFetch.current.clear();
      setGraph(fresh);
    } catch { /* keep the old graph */ }
  }, []);

  // ── Tell the palette we are here (it focuses in place instead of navigating) ─
  useEffect(() => {
    const store = useGraphStore.getState();
    store.setGraphMounted(true);
    return () => store.setGraphMounted(false);
  }, []);

  // ── Keep ?focus= in the URL so a node is shareable / reload-safe ──────────
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (selectedId) next.set('focus', selectedId); else next.delete('focus');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const edgeCounts = useMemo(() => {
    const c: Partial<Record<KnowledgeGraphEdgeType, number>> = {};
    for (const e of graph?.edges ?? []) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [graph]);

  const hitIds = useMemo(() => new Set(spotlight.hits.map((h) => h.nodeId)), [spotlight.hits]);
  const spotlightState = useMemo<SpotlightState | null>(
    () => (spotlight.active && spotlight.hits.length > 0
      ? { scores: scoreMap(spotlight.hits), max: maxScore(spotlight.hits), filter: spotlight.filterToResults }
      : null),
    [spotlight.active, spotlight.hits, spotlight.filterToResults],
  );

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
    // Edge-type filter: drop disallowed edges and the nodes they alone connected
    const pinned = new Set<string>(selectedId ? [selectedId] : []);
    const edgeFiltered = filterByEdgeTypes(
      graph.nodes.filter((n) => keep.has(n.id)),
      graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
      filters.edgeTypes,
      pinned,
    );
    keep = new Set(edgeFiltered.nodes.map((n) => n.id));
    const allowedEdges = edgeFiltered.edges;

    let depth: Map<string, number> | undefined;
    if (selectedId && filters.depth > 0 && keep.has(selectedId)) {
      // local graph: BFS over the kept subgraph
      const sub = new Map<string, Set<string>>();
      for (const e of allowedEdges) {
        if (!sub.has(e.source)) sub.set(e.source, new Set());
        if (!sub.has(e.target)) sub.set(e.target, new Set());
        sub.get(e.source)!.add(e.target); sub.get(e.target)!.add(e.source);
      }
      depth = neighbourhood(selectedId, sub, filters.depth);
      const local = new Set(depth.keys());
      // Spotlight hits (and their 1-hop) always stay visible, even outside the local ring
      if (spotlightState) {
        for (const id of hitIds) {
          if (!keep.has(id)) continue;
          local.add(id);
          for (const nb of adjacency.get(id) ?? []) if (keep.has(nb)) local.add(nb);
        }
      }
      keep = local;
    }
    const es = allowedEdges.filter((e) => keep.has(e.source) && keep.has(e.target));
    if (!filters.showOrphans) {
      const linked = new Set<string>();
      for (const e of es) { linked.add(e.source); linked.add(e.target); }
      if (selectedId) linked.add(selectedId);
      for (const id of hitIds) linked.add(id);
      keep = new Set([...keep].filter((id) => linked.has(id)));
    }
    return { nodes: graph.nodes.filter((n) => keep.has(n.id)), edges: es, depthById: depth };
  }, [graph, filters, selectedId, nodesById, adjacency, hitIds, spotlightState]);

  const visibleCounts = useMemo(() => {
    const c: Record<KnowledgeGraphNodeType, number> = { goal: 0, project: 0, task: 0, person: 0, decision: 0, commitment: 0, memory: 0 };
    for (const n of graph?.nodes ?? []) if (filters.domain === 'all' || n.domain === null || n.domain === filters.domain) c[n.type] += 1;
    return c;
  }, [graph, filters.domain]);

  const timelineOverlay = useMemo(
    () => (tlWindow ? applyTimeline(nodes, edges, tlWindow, tlHide) : null),
    [nodes, edges, tlWindow, tlHide],
  );

  const selected = selectedId ? nodesById.get(selectedId) ?? null : null;
  const hovered = hoverId ? nodesById.get(hoverId) ?? null : null;

  // ── Focus + history ───────────────────────────────────────────────────────
  const jumpTo = useCallback((id: string) => {
    setSelectedId(id);
    // Give the simulation a frame to include the node, then centre on it
    requestAnimationFrame(() => viewRef.current?.focusNode(id));
  }, []);

  const pick = useCallback((id: string) => {
    setHistory((h) => pushFocus(h, id));
    jumpTo(id);
  }, [jumpTo]);

  const historyBack = useCallback(() => {
    setHistory((h) => {
      if (!canGoBack(h)) return h;
      const next = goBack(h);
      const id = currentFocus(next);
      if (id) jumpTo(id);
      return next;
    });
  }, [jumpTo]);

  const historyForward = useCallback(() => {
    setHistory((h) => {
      if (!canGoForward(h)) return h;
      const next = goForward(h);
      const id = currentFocus(next);
      if (id) jumpTo(id);
      return next;
    });
  }, [jumpTo]);

  // Clicking a node on the canvas is a focus too (so it enters the history)
  const onCanvasSelect = useCallback((id: string | null) => {
    if (id) setHistory((h) => pushFocus(h, id));
    setSelectedId(id);
  }, []);

  // ── Focus requests from the ⌘K palette ────────────────────────────────────
  useEffect(() => {
    if (!focusRequest) return;
    useGraphStore.getState().consumeFocusRequest();
    pick(focusRequest);
  }, [focusRequest, pick]);

  // ── Keyboard: "/" opens spotlight, [ ] walk history, Esc clears selection ─
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); openSpotlightPalette(); }
      else if (e.key === '[') { e.preventDefault(); historyBack(); }
      else if (e.key === ']') { e.preventDefault(); historyForward(); }
      else if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyBack, historyForward]);

  // ── Lazily fetch what the loaded graph lacks (1-hop via backlinks): spotlight
  //    hits, and a ?focus= / palette target beyond the 200-memory cap ──────────
  useEffect(() => {
    if (!graph) return;
    const wanted = spotlight.active && spotlight.hits.length > 0 ? missingHitIds(spotlight.hits, nodesById) : [];
    if (selectedId && !nodesById.has(selectedId) && !wanted.includes(selectedId)) wanted.unshift(selectedId);
    const missing = wanted.filter((id) => !attemptedFetch.current.has(id)).slice(0, LAZY_FETCH_BATCH);
    if (missing.length === 0) return;
    for (const id of missing) attemptedFetch.current.add(id);
    let cancelled = false;
    setFetchingMissing(true);
    api.getGraphNeighbourhoods(missing)
      .then((responses) => {
        if (cancelled || responses.length === 0) return;
        setGraph((g) => (g ? mergeBacklinks(g, responses) : g));
      })
      .catch(() => { /* hits stay list-only */ })
      .finally(() => { if (!cancelled) setFetchingMissing(false); });
    return () => { cancelled = true; };
  }, [graph, spotlight.active, spotlight.hits, nodesById, selectedId]);

  // ── Spotlight: fit the view to the hit set once per result set ────────────
  const hitKey = useMemo(() => [...hitIds].sort().join('|'), [hitIds]);
  const fittedKey = useRef<string>('');
  useEffect(() => {
    if (!spotlight.active || hitIds.size === 0 || !graph) return;
    const loaded = [...hitIds].filter((id) => nodesById.has(id));
    if (loaded.length === 0) return;
    const key = `${hitKey}#${loaded.length}`;
    if (fittedKey.current === key) return;
    fittedKey.current = key;
    const t = setTimeout(() => viewRef.current?.zoomToFitIds(new Set(loaded)), reducedMotion ? 50 : 450);
    return () => clearTimeout(t);
  }, [spotlight.active, hitIds, hitKey, nodesById, graph, reducedMotion]);

  const loadedHits = useMemo(() => [...hitIds].filter((id) => nodesById.has(id)).length, [hitIds, nodesById]);

  // ── Render ────────────────────────────────────────────────────────────────
  const total = graph?.nodes.length ?? 0;
  const truncated = graph?.stats.memoryLimitHit ?? false;
  const sidePanelClass = cn(
    'w-full max-w-[340px] shrink-0 border-l border-border',
    'max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[55%] max-md:max-w-none max-md:border-l-0 max-md:border-t',
  );

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
                {selected && filters.depth > 0 && <> · local {filters.depth}° around <span className="text-foreground">{selected.label}</span></>}
                {truncated && ' · memories capped at 200 by importance'}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hovered && !selected && (
            <div className="hidden text-xs text-muted-foreground md:block">
              Hovering <span className="text-foreground">{hovered.label}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowMentions((v) => !v)}
            aria-pressed={showMentions}
            className={cn('h-8 rounded-md border px-3 text-xs', showMentions ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground')}
            title="Memories that mention a person, project or goal without being linked to it"
          >
            Unlinked mentions{mentionCount !== null ? ` · ${mentionCount}` : ''}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {graph && total > 0 && (
        <GraphControls
          filters={filters}
          onChange={setFilters}
          counts={visibleCounts}
          edgeCounts={edgeCounts}
          domains={domains}
          nodes={graph.nodes}
          hasSelection={!!selected}
          onPick={pick}
          onFit={() => viewRef.current?.zoomToFit()}
          onSpotlight={openSpotlightPalette}
          searchRef={searchRef}
        />
      )}

      {graph && total > 0 && (history.entries.length > 0 || spotlight.active) && (
        <div className="flex flex-wrap items-center gap-2">
          <FocusHistoryBar history={history} nodesById={nodesById} onBack={historyBack} onForward={historyForward} onCrumb={pick} className="min-w-0" />
          {spotlight.active && (
            <SpotlightBar
              spotlight={spotlight}
              loadedHits={loadedHits}
              fetchingMissing={fetchingMissing}
              onToggleFilter={() => useGraphStore.getState().toggleFilterToResults()}
              onLoadMore={() => void useGraphStore.getState().loadMore()}
              onFit={() => viewRef.current?.zoomToFitIds(new Set([...hitIds].filter((id) => nodesById.has(id))))}
              onEdit={openSpotlightPalette}
              onClear={() => useGraphStore.getState().clearSpotlight()}
              className="min-w-0 flex-1"
            />
          )}
        </div>
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
              description="Turn a type or link type back on, switch domain to All, or show orphans."
              action={{ label: 'Reset filters', onClick: () => setFilters({ ...filters, types: new Set(NODE_TYPES), edgeTypes: new Set(EDGE_TYPES), domain: 'all', showOrphans: false, depth: DEFAULT_DEPTH }) }}
            />
          </div>
        ) : (
          <div className="flex h-full">
            <KnowledgeGraphView
              ref={viewRef}
              nodes={nodes}
              edges={edges}
              selectedId={selectedId}
              onSelect={onCanvasSelect}
              onHoverChange={setHoverId}
              showLabels={filters.showLabels}
              depthById={depthById}
              spotlight={spotlightState}
              timeline={timelineOverlay}
              className="h-full min-w-0 flex-1"
            />
            {selected ? (
              <NodeInspector
                node={selected}
                nodesById={nodesById}
                edges={graph!.edges}
                onSelect={pick}
                onFocusLocal={() => setFilters({ ...filters, depth: filters.depth === 0 ? DEFAULT_DEPTH : filters.depth })}
                onClose={() => setSelectedId(null)}
                onLinked={refetch}
                className={sidePanelClass}
              />
            ) : showMentions ? (
              <UnlinkedMentionsPanel
                onLinked={refetch}
                onCount={setMentionCount}
                onSelectNode={pick}
                onClose={() => setShowMentions(false)}
                className={sidePanelClass}
              />
            ) : null}
          </div>
        )}
      </div>

      {graph && nodes.length > 0 && (
        <GraphTimeline
          nodes={nodes}
          window={tlWindow}
          onChange={setTlWindow}
          hideOutside={tlHide}
          onHideOutsideChange={setTlHide}
          inWindow={timelineOverlay?.inWindow ?? nodes.length}
          reducedMotion={reducedMotion}
        />
      )}
    </div>
  );
}
