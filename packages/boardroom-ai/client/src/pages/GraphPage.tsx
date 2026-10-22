import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { KnowledgeGraph, KnowledgeGraphEdgeType, KnowledgeGraphNode, KnowledgeGraphNodeType } from '@boardroom/shared';
import * as api from '../lib/api';
import { usePageTitle } from '../hooks/usePageTitle';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { EmptyState, PageHeader, Skeleton } from '../components/ui';
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
  canGoBack, canGoForward, createFocusHistory, currentFocus, goBack, goForward, pruneHistory, pushFocus, type FocusHistory,
} from '../components/graph/graph-focus';
import { applyTimeline, type TimeWindow } from '../components/graph/graph-timeline';
import { maxScore, mergeBacklinks, missingHitIds, scoreMap } from '../components/graph/graph-search';
import { detectCommunities } from '../components/graph/graph-communities';
import { useGraphStore } from '../stores/graph.store';
import { useCommandPaletteStore } from '../stores/commandPalette.store';
import { cn } from '../lib/cn';

/**
 * Two kinds of "current node", kept apart on purpose:
 *   - SELECTED — what the inspector shows and the canvas emphasises. A single
 *     click. Never changes the visible id set, so it never relayouts.
 *   - FOCUSED  — the root of the local graph (depth > 0), the `?focus=` URL
 *     param and the back / forward history. Only explicit actions change it:
 *     double-click on the canvas, the inspector's "Focus here", a palette hit
 *     ("Focus in graph"), find-a-node, a crumb, back / forward, `?focus=`.
 *   Focusing also selects.
 */

export const STORAGE_KEY = 'boardroom.graph.filters.v2';
/** Pre-edge-type / pre-depth key; migrated into v2 on first read, then removed. */
export const LEGACY_STORAGE_KEY = 'boardroom.graph.filters.v1';
const DEFAULT_DEPTH: GraphFilters['depth'] = 2; // local-first
const LAZY_FETCH_BATCH = 12;

function saveFilters(f: GraphFilters) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      types: [...f.types], edgeTypes: [...f.edgeTypes], domain: f.domain, showOrphans: f.showOrphans, showLabels: f.showLabels, depth: f.depth,
    }));
  } catch { /* storage unavailable — fine */ }
}

export function loadFilters(): GraphFilters {
  const base: GraphFilters = {
    types: new Set(NODE_TYPES), edgeTypes: new Set(EDGE_TYPES), domain: 'all', showOrphans: false, showLabels: true, depth: DEFAULT_DEPTH,
  };
  try {
    let raw = sessionStorage.getItem(STORAGE_KEY);
    let migrated = false;
    if (!raw) { raw = sessionStorage.getItem(LEGACY_STORAGE_KEY); migrated = !!raw; }
    if (!raw) return base;
    const j = JSON.parse(raw) as Partial<{
      types: unknown[]; edgeTypes: unknown[]; domain: unknown; showOrphans: unknown; showLabels: unknown; depth: unknown;
    }>;
    // Everything from storage is validated — a stale or hand-edited entry must not poison the filters.
    const types = Array.isArray(j.types) ? j.types.filter((t): t is KnowledgeGraphNodeType => (NODE_TYPES as readonly string[]).includes(t as string)) : [];
    const edgeTypes = Array.isArray(j.edgeTypes) ? j.edgeTypes.filter((t): t is KnowledgeGraphEdgeType => (EDGE_TYPES as readonly string[]).includes(t as string)) : [];
    const depth = typeof j.depth === 'number' && [0, 1, 2, 3].includes(j.depth) ? (j.depth as GraphFilters['depth']) : DEFAULT_DEPTH;
    const f: GraphFilters = {
      ...base,
      types: new Set(types.length ? types : NODE_TYPES),
      edgeTypes: new Set(edgeTypes.length ? edgeTypes : EDGE_TYPES),
      domain: typeof j.domain === 'string' && j.domain ? j.domain : 'all',
      showOrphans: typeof j.showOrphans === 'boolean' ? j.showOrphans : false,
      showLabels: typeof j.showLabels === 'boolean' ? j.showLabels : true,
      depth,
    };
    if (migrated) {
      saveFilters(f);
      try { sessionStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* fine */ }
    }
    return f;
  } catch { return base; }
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
  // Read once: the deep-link target at mount. Later focus changes write the URL, never the other way round.
  const [initialFocus] = useState<string | null>(() => params.get('focus'));
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersState] = useState<GraphFilters>(loadFilters);
  const [focusId, setFocusId] = useState<string | null>(initialFocus);
  const [selectedId, setSelectedId] = useState<string | null>(initialFocus);
  const [history, setHistory] = useState<FocusHistory>(() => (initialFocus ? pushFocus(createFocusHistory(), initialFocus) : createFocusHistory()));
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionCount, setMentionCount] = useState<number | null>(null);
  const [tlWindow, setTlWindow] = useState<TimeWindow | null>(null);
  const [tlHide, setTlHide] = useState(false);
  /** Lazy neighbourhood requests in flight (a count, so overlapping batches cannot strand the flag). */
  const [fetchingCount, setFetchingCount] = useState(0);
  /** Ids whose neighbourhood fetch settled with nothing (archived / superseded / deleted) — never retried. */
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());
  const viewRef = useRef<KnowledgeGraphViewHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const attemptedFetch = useRef(new Set<string>());
  const inFlightFetch = useRef(new Set<string>());
  const historyRef = useRef(history);
  historyRef.current = history;
  const focusIdRef = useRef(focusId);
  focusIdRef.current = focusId;
  const reducedMotion = useReducedMotion();

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
      setUnavailable(new Set());
      setGraph(fresh);
      // History entries that left the graph are dropped — except the current
      // focus and live hits, which the lazy fetch will bring back.
      const ids = new Set(fresh.nodes.map((n) => n.id));
      const hits = new Set(useGraphStore.getState().spotlight.hits.map((h) => h.nodeId));
      const keepId = focusIdRef.current;
      setHistory((h) => pruneHistory(h, (id) => ids.has(id) || id === keepId || hits.has(id)));
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
    if (focusId) next.set('focus', focusId); else next.delete('focus');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [focusId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Communities: Louvain over the LOADED graph (not the filtered view), so
  //    hull membership never changes with filters, selection or focus. Ids are
  //    kept stable against the previous partition across refetches / merges.
  const prevCommunities = useRef<ReadonlyMap<string, number> | null>(null);
  const communityResult = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return null;
    const res = detectCommunities(graph.nodes, graph.edges, prevCommunities.current);
    prevCommunities.current = res.communityOf;
    return res;
  }, [graph]);
  useEffect(() => {
    useGraphStore.getState().setCommunities(communityResult?.communityOf ?? new Map(), communityResult?.communities ?? []);
  }, [communityResult]);

  const hitIds = useMemo(() => new Set(spotlight.hits.map((h) => h.nodeId)), [spotlight.hits]);
  const loadedHits = useMemo(() => [...hitIds].filter((id) => nodesById.has(id)).length, [hitIds, nodesById]);
  const unavailableHits = useMemo(() => [...hitIds].filter((id) => unavailable.has(id) && !nodesById.has(id)).length, [hitIds, unavailable, nodesById]);
  // "Filter to results" with no hit loaded would blank the canvas — fall back to fading and say so.
  const emptyFilter = spotlight.active && spotlight.filterToResults && spotlight.hits.length > 0 && loadedHits === 0;
  const spotlightState = useMemo<SpotlightState | null>(
    () => (spotlight.active && spotlight.hits.length > 0
      ? { scores: scoreMap(spotlight.hits), max: maxScore(spotlight.hits), filter: spotlight.filterToResults && loadedHits > 0 }
      : null),
    [spotlight.active, spotlight.hits, spotlight.filterToResults, loadedHits],
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
    const pinned = new Set<string>(focusId ? [focusId] : []);
    const edgeFiltered = filterByEdgeTypes(
      graph.nodes.filter((n) => keep.has(n.id)),
      graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
      filters.edgeTypes,
      pinned,
    );
    keep = new Set(edgeFiltered.nodes.map((n) => n.id));
    const allowedEdges = edgeFiltered.edges;

    let depth: Map<string, number> | undefined;
    if (focusId && filters.depth > 0 && keep.has(focusId)) {
      // local graph: BFS over the kept subgraph, rooted at the FOCUSED node
      const sub = new Map<string, Set<string>>();
      for (const e of allowedEdges) {
        if (!sub.has(e.source)) sub.set(e.source, new Set());
        if (!sub.has(e.target)) sub.set(e.target, new Set());
        sub.get(e.source)!.add(e.target); sub.get(e.target)!.add(e.source);
      }
      depth = neighbourhood(focusId, sub, filters.depth);
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
      if (focusId) linked.add(focusId);
      for (const id of hitIds) linked.add(id);
      keep = new Set([...keep].filter((id) => linked.has(id)));
    }
    return { nodes: graph.nodes.filter((n) => keep.has(n.id)), edges: es, depthById: depth };
  }, [graph, filters, focusId, nodesById, adjacency, hitIds, spotlightState]);

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
  const focused = focusId ? nodesById.get(focusId) ?? null : null;
  const hovered = hoverId ? nodesById.get(hoverId) ?? null : null;
  // A selected node the timeline hides must not keep its neighbourhood vivid while itself invisible.
  const canvasSelectedId = selectedId && timelineOverlay?.nodeVisibility.get(selectedId) === 'hidden' ? null : selectedId;

  // ── Focus + history ───────────────────────────────────────────────────────
  /** Re-root on `id`, select it and centre the viewport (the view retries until the node has a position). */
  const jumpTo = useCallback((id: string) => {
    setFocusId(id);
    setSelectedId(id);
    // Give the simulation a frame to include the node, then centre on it
    requestAnimationFrame(() => viewRef.current?.focusNode(id));
  }, []);

  const pick = useCallback((id: string) => {
    setHistory((h) => pushFocus(h, id));
    jumpTo(id);
  }, [jumpTo]);

  // Side effects stay OUT of the setState updaters (StrictMode double-invokes them).
  const historyBack = useCallback(() => {
    const h = historyRef.current;
    if (!canGoBack(h)) return;
    const next = goBack(h);
    historyRef.current = next;
    setHistory(next);
    const id = currentFocus(next);
    if (id) jumpTo(id);
  }, [jumpTo]);

  const historyForward = useCallback(() => {
    const h = historyRef.current;
    if (!canGoForward(h)) return;
    const next = goForward(h);
    historyRef.current = next;
    setHistory(next);
    const id = currentFocus(next);
    if (id) jumpTo(id);
  }, [jumpTo]);

  /** Legend chip → the same type filter the controls row edits (never empties the set). */
  const toggleType = useCallback((t: KnowledgeGraphNodeType) => {
    const next = new Set(filters.types);
    if (next.has(t)) { if (next.size > 1) next.delete(t); } else next.add(t);
    setFilters({ ...filters, types: next });
  }, [filters, setFilters]);

  // Single click on the canvas: select only (inspector opens, no relayout).
  const onCanvasSelect = useCallback((id: string | null) => { setSelectedId(id); }, []);
  // Double click on the canvas: explicit focus (re-roots the local graph, enters the history).
  const onCanvasFocus = useCallback((id: string) => { pick(id); }, [pick]);

  // ── Focus requests from the ⌘K palette ────────────────────────────────────
  useEffect(() => {
    if (!focusRequest) return;
    useGraphStore.getState().consumeFocusRequest();
    pick(focusRequest);
  }, [focusRequest, pick]);

  // ── ?focus= deep link: centre once the node is in the graph ───────────────
  const initialCentred = useRef(false);
  useEffect(() => {
    if (!graph || !initialFocus || initialCentred.current) return;
    if (!nodesById.has(initialFocus)) return; // beyond the cap: wait for the lazy fetch to merge it
    initialCentred.current = true;
    const raf = requestAnimationFrame(() => viewRef.current?.focusNode(initialFocus));
    return () => cancelAnimationFrame(raf);
  }, [graph, nodesById, initialFocus]);

  // ── Keyboard: "/" opens spotlight, [ ] walk history, Esc clears selection ─
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable;
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (useCommandPaletteStore.getState().open) return; // the palette owns the keyboard while open
      if (e.key === '/') { e.preventDefault(); openSpotlightPalette(); }
      else if (e.key === '[') { e.preventDefault(); historyBack(); }
      else if (e.key === ']') { e.preventDefault(); historyForward(); }
      else if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyBack, historyForward]);

  // ── Lazily fetch what the loaded graph lacks (1-hop via backlinks): spotlight
  //    hits, and a ?focus= / palette target beyond the 200-memory cap.
  //
  //    Never cancelled on a dependency change: the merge is idempotent (it
  //    dedupes by node / edge id), while dropping a response would strand the
  //    ids. Ids are marked attempted only once the request settles; ids the
  //    server did not return (404 / archived) are marked unavailable and never
  //    retried until a full refetch. ──────────────────────────────────────────
  useEffect(() => {
    if (!graph) return;
    const wanted = spotlight.active && spotlight.hits.length > 0 ? missingHitIds(spotlight.hits, nodesById) : [];
    if (focusId && !nodesById.has(focusId) && !wanted.includes(focusId)) wanted.unshift(focusId);
    const missing = wanted
      .filter((id) => !attemptedFetch.current.has(id) && !inFlightFetch.current.has(id))
      .slice(0, LAZY_FETCH_BATCH);
    if (missing.length === 0) return;
    for (const id of missing) inFlightFetch.current.add(id);
    setFetchingCount((c) => c + 1);
    api.getGraphNeighbourhoods(missing)
      .then((responses) => {
        const returned = new Set(responses.filter((r) => r?.node).map((r) => r.node.id));
        const gone = missing.filter((id) => !returned.has(id));
        if (responses.length > 0) setGraph((g) => (g ? mergeBacklinks(g, responses) : g));
        if (gone.length > 0) {
          setUnavailable((prev) => { const next = new Set(prev); for (const id of gone) next.add(id); return next; });
        }
      })
      .catch(() => { /* network failure: the ids stay list-only until a refetch */ })
      .finally(() => {
        for (const id of missing) { inFlightFetch.current.delete(id); attemptedFetch.current.add(id); }
        setFetchingCount((c) => Math.max(0, c - 1));
      });
  }, [graph, spotlight.active, spotlight.hits, nodesById, focusId]);

  // Focus-history ids that turned out not to exist are pruned (a crumb must never show a raw id for nothing).
  useEffect(() => {
    if (unavailable.size === 0) return;
    setHistory((h) => pruneHistory(h, (id) => !unavailable.has(id)));
  }, [unavailable]);

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

  // ── Render ────────────────────────────────────────────────────────────────
  const total = graph?.nodes.length ?? 0;
  const truncated = graph?.stats.memoryLimitHit ?? false;
  const sidePanelClass = cn(
    'w-full max-w-[340px] shrink-0 border-l border-border',
    'max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[55%] max-md:max-w-none max-md:border-l-0 max-md:border-t',
  );

  return (
    <div className="flex h-full min-h-[520px] flex-col gap-3">
      <PageHeader
        className="mb-0"
        title="Knowledge Graph"
        subtitle={
          <span data-testid="graph-summary">
            {loading ? 'Loading…' : total === 0 ? 'No linked entities yet.' : (
              <>
                <span className="tnum text-foreground">{nodes.length}</span> of <span className="tnum">{total}</span> nodes ·{' '}
                <span className="tnum">{edges.length}</span> links
                {communityResult && communityResult.communities.length > 1 && <> · <span className="tnum">{communityResult.communities.length}</span> communities</>}
                {focused && filters.depth > 0 && <> · local {filters.depth}° around <span className="text-foreground">{focused.label}</span></>}
                {truncated && ' · memories capped at 200 by importance'}
              </>
            )}
          </span>
        }
        actions={
          <>
            {hovered && !selected && (
              <div className="hidden text-xs text-muted-foreground md:block">
                Hovering <span className="text-foreground">{hovered.label}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowMentions((v) => !v)}
              aria-pressed={showMentions}
              className={cn(
                'h-8 rounded-control border px-3 text-xs transition-[background-color,color,border-color] duration-fast ease-out',
                showMentions ? 'border-primary/50 bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
              title="Memories that mention a person, project or goal without being linked to it"
            >
              Unlinked mentions{mentionCount !== null ? ` · ${mentionCount}` : ''}
            </button>
          </>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {graph && total > 0 && (
        <GraphControls
          filters={filters}
          onChange={setFilters}
          counts={visibleCounts}
          edgeCounts={edgeCounts}
          domains={domains}
          nodes={graph.nodes}
          hasSelection={!!focused}
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
              unavailableHits={unavailableHits}
              fetchingMissing={fetchingCount > 0}
              emptyFilter={emptyFilter}
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

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border shadow-sm">
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
              selectedId={canvasSelectedId}
              onSelect={onCanvasSelect}
              onFocus={onCanvasFocus}
              onHoverChange={setHoverId}
              showLabels={filters.showLabels}
              depthById={depthById}
              spotlight={spotlightState}
              timeline={timelineOverlay}
              communityOf={communityResult?.communityOf ?? null}
              communities={communityResult?.communities ?? null}
              typeFilter={filters.types}
              onToggleType={toggleType}
              typeCounts={visibleCounts}
              className="h-full min-w-0 flex-1"
            />
            {selected ? (
              <NodeInspector
                node={selected}
                nodesById={nodesById}
                edges={graph!.edges}
                onSelect={pick}
                onFocusLocal={() => {
                  pick(selected.id);
                  if (filters.depth === 0) setFilters({ ...filters, depth: DEFAULT_DEPTH });
                }}
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
