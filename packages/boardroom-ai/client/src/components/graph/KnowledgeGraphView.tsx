import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@boardroom/shared';
import {
  TYPE_BASE_RADIUS, TYPE_SHAPE, drawShape, readGraphPalette, type GraphPalette,
} from './graph-theme';
import { createGraphStore, idOf, syncGraphData, type GraphViewLink, type GraphViewNode } from './graph-data';
import { nodeAlpha, spotlightRing, type SpotlightState } from './graph-emphasis';
import type { TimelineVisibility } from './graph-timeline';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * Obsidian-style force graph on canvas.
 *
 * Interaction model (deliberately the same as Obsidian's graph view):
 *  - hover a node → it and its 1-hop neighbourhood stay vivid, everything
 *    else fades to ~12% alpha; labels for the neighbourhood appear
 *  - click → SELECT (inspector opens, emphasis ring); click background → clear.
 *    Selection never changes the visible id set, so it never relayouts.
 *  - double-click → FOCUS (`onFocus`): the page re-roots the local graph there;
 *    that is the only canvas gesture that may change the id set
 *  - drag → move a node (pinned while dragging, released after)
 *  - wheel / pinch → zoom; drag background → pan
 *  - node radius ∝ √degree, clamped; labels appear above a zoom threshold
 *    or for hovered / selected / neighbour nodes
 *  - reduced motion → the layout is computed off-screen, then shown at rest
 *  - node / link objects are stable per id (see graph-data.ts): selecting a
 *    node never relayouts; only a change in the visible id set re-heats
 *  - viewport: the first layout (and any later id-set change) auto-fits, but
 *    an explicit viewport intent — `focusNode` / `zoomToFitIds` within the last
 *    INTENT_TTL_MS — wins over that fit and is re-applied once the simulation
 *    settles, so centring on a node or fitting the hits survives a relayout
 *  - spotlight (search hits) → score-scaled rings on hits, the rest dims or,
 *    with "Filter to results", is not painted at all (no relayout either way)
 *  - timeline → nodes outside the window fade or are not painted; edges
 *    follow their endpoints; invalidated memories are drawn hollow
 */

export type { GraphViewNode, GraphViewLink } from './graph-data';
export type { SpotlightState } from './graph-emphasis';

export interface TimelineOverlay {
  nodeVisibility: ReadonlyMap<string, TimelineVisibility>;
  edgeVisibility: ReadonlyMap<string, TimelineVisibility>;
  hollow: ReadonlySet<string>;
}

export interface KnowledgeGraphViewHandle {
  focusNode(id: string, zoom?: number): void;
  zoomToFit(): void;
  /** Fit the viewport to a subset of nodes (no-op when none of them is positioned yet). */
  zoomToFitIds(ids: ReadonlySet<string>): void;
}

interface Props {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  selectedId: string | null;
  /** Single click (select) — must not change the visible id set. */
  onSelect(id: string | null): void;
  /** Double click (focus) — the page may re-root the local graph here. */
  onFocus?(id: string): void;
  onHoverChange?(id: string | null): void;
  showLabels: boolean;
  /** When set, node.depth drives the fade so rings farther from focus are dimmer. */
  depthById?: Map<string, number>;
  /** Search hits to light up (see graph-emphasis.ts). */
  spotlight?: SpotlightState | null;
  /** Timeline window result (see graph-timeline.ts). */
  timeline?: TimelineOverlay | null;
  className?: string;
}

const PENDING_FOCUS_TTL_MS = 5000;
/** How long an explicit focus / fit-ids request outranks the automatic fit after a relayout. */
export const INTENT_TTL_MS = 5000;

type ViewportIntent =
  | { kind: 'focus'; id: string; zoom: number; at: number }
  | { kind: 'fit-ids'; ids: ReadonlySet<string>; at: number };

export const KnowledgeGraphView = forwardRef<KnowledgeGraphViewHandle, Props>(function KnowledgeGraphView(
  { nodes, edges, selectedId, onSelect, onFocus, onHoverChange, showLabels, depthById, spotlight = null, timeline = null, className },
  ref,
) {
  const fgRef = useRef<ForceGraphMethods<GraphViewNode, GraphViewLink> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [palette, setPalette] = useState<GraphPalette>(() => readGraphPalette());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  // ── Size to container ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Follow theme changes (class="dark" toggled on <html>) ─────────────────
  useEffect(() => {
    const mo = new MutationObserver(() => setPalette(readGraphPalette()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => mo.disconnect();
  }, []);

  // ── Graph data: one stable object per id (positions survive re-renders) ──
  const storeRef = useRef(createGraphStore());
  const { graphData, neighbours, idsChanged } = useMemo(
    () => syncGraphData(storeRef.current, nodes, edges, depthById),
    [nodes, edges, depthById],
  );

  // ── Forces — only re-heat when the id set changed, never on selection ─────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !idsChanged) return;
    const n = graphData.nodes.length;
    fg.d3Force('charge')?.strength(n > 600 ? -40 : n > 200 ? -70 : -120).distanceMax(400);
    fg.d3Force('link')
      ?.distance((l: GraphViewLink) => (l.data.type === 'memory_entity' ? 28 : l.data.type === 'goal_hierarchy' ? 70 : 48))
      .strength((l: GraphViewLink) => (l.data.type === 'memory_entity' ? 0.6 : 0.9));
    fg.d3ReheatSimulation();
  }, [graphData, idsChanged]);

  // ── Viewport intents ──────────────────────────────────────────────────────
  // The last explicit request (focus a node / fit the hits). While it is fresh
  // it is re-applied on engine stop instead of the automatic fit, and it is
  // cleared by an explicit "Fit" (zoomToFit).
  const lastIntent = useRef<ViewportIntent | null>(null);
  const intentFresh = (i: ViewportIntent | null): i is ViewportIntent => !!i && Date.now() - i.at <= INTENT_TTL_MS;

  // Fit the viewport once per layout — i.e. once per change of the id set.
  const fitOnce = useRef(false);
  useEffect(() => { if (idsChanged) fitOnce.current = false; }, [graphData, idsChanged]);

  // ── Imperative API ────────────────────────────────────────────────────────
  const fitAll = useCallback(() => fgRef.current?.zoomToFit(reducedMotion ? 0 : 500, 48), [reducedMotion]);

  const zoomToFit = useCallback(() => {
    lastIntent.current = null; // an explicit "fit everything" supersedes earlier intents
    fitOnce.current = true;
    fitAll();
  }, [fitAll]);

  const fitIds = useCallback((ids: ReadonlySet<string>): boolean => {
    const fg = fgRef.current;
    if (!fg || ids.size === 0) return false;
    let positioned = 0;
    for (const id of ids) {
      const n = storeRef.current.nodeMap.get(id);
      if (n && n.x !== undefined && n.y !== undefined && !Number.isNaN(n.x)) positioned += 1;
    }
    if (positioned === 0) return false;
    fg.zoomToFit(reducedMotion ? 0 : 500, 64, (n: GraphViewNode) => ids.has(n.id));
    return true;
  }, [reducedMotion]);

  const zoomToFitIds = useCallback((ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    lastIntent.current = { kind: 'fit-ids', ids, at: Date.now() };
    fitOnce.current = true; // the one-time fit must not undo this
    fitIds(ids);
  }, [fitIds]);

  /**
   * Focus requested before the node existed / had a position — retried on the
   * next engine tick or stop, and dropped after PENDING_FOCUS_TTL_MS so a stale
   * request cannot yank the viewport on an unrelated relayout later.
   */
  const pendingFocus = useRef<{ id: string; zoom: number; at: number } | null>(null);

  const tryFocus = useCallback((id: string, zoom: number): boolean => {
    const fg = fgRef.current;
    if (!fg) return true; // no graph mounted — nothing to wait for
    const node = storeRef.current.nodeMap.get(id);
    if (!node || node.x === undefined || node.y === undefined || Number.isNaN(node.x) || Number.isNaN(node.y)) return false;
    fg.centerAt(node.x, node.y, reducedMotion ? 0 : 400);
    fg.zoom(zoom, reducedMotion ? 0 : 400);
    return true;
  }, [reducedMotion]);

  const flushPendingFocus = useCallback(() => {
    const p = pendingFocus.current;
    if (!p) return;
    if (Date.now() - p.at > PENDING_FOCUS_TTL_MS || tryFocus(p.id, p.zoom)) pendingFocus.current = null;
  }, [tryFocus]);

  useImperativeHandle(ref, () => ({
    focusNode(id, zoom = 2.2) {
      const at = Date.now();
      lastIntent.current = { kind: 'focus', id, zoom, at };
      fitOnce.current = true; // the one-time fit must not undo the centring
      if (tryFocus(id, zoom)) { pendingFocus.current = null; return; }
      pendingFocus.current = { id, zoom, at };
    },
    zoomToFit,
    zoomToFitIds,
  }), [tryFocus, zoomToFit, zoomToFitIds]);

  const onEngineStop = useCallback(() => {
    // 1. A pending focus (node had no position yet) wins over everything.
    if (pendingFocus.current) { flushPendingFocus(); fitOnce.current = true; return; }
    // 2. A fresh explicit intent is re-applied: positions moved during the relayout.
    const intent = lastIntent.current;
    if (intentFresh(intent)) {
      fitOnce.current = true;
      if (intent.kind === 'focus') tryFocus(intent.id, intent.zoom);
      else fitIds(intent.ids);
      return;
    }
    // 3. Otherwise fit the whole graph once per layout.
    if (!fitOnce.current) { fitOnce.current = true; fitAll(); }
  }, [flushPendingFocus, tryFocus, fitIds, fitAll]);

  // ── Emphasis set (hovered or selected + neighbours) ───────────────────────
  const focusId = hoverId ?? selectedId;
  const emphasis = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const nb of neighbours.get(focusId) ?? []) set.add(nb);
    return set;
  }, [focusId, neighbours]);

  const spotlightActive = !!spotlight && spotlight.scores.size > 0;

  // ── Painters ──────────────────────────────────────────────────────────────
  const radiusOf = (n: GraphViewNode) =>
    TYPE_BASE_RADIUS[n.data.type] + Math.min(10, Math.sqrt(n.degree) * 1.6);

  const alphaOf = useCallback((n: GraphViewNode): number => nodeAlpha({
    id: n.id,
    type: n.data.type,
    depth: n.depth,
    emphasis,
    spotlight: spotlightActive ? spotlight : null,
    timeline: timeline?.nodeVisibility.get(n.id),
  }), [emphasis, spotlight, spotlightActive, timeline]);

  const alphaOfId = useCallback((id: string): number => {
    const n = storeRef.current.nodeMap.get(id);
    return n ? alphaOf(n) : 1;
  }, [alphaOf]);

  const paintNode = useCallback((node: GraphViewNode, ctx: CanvasRenderingContext2D, scale: number) => {
    if (node.x === undefined || node.y === undefined) return;
    const alpha = alphaOf(node);
    if (alpha <= 0) return; // hidden: not painted, not hit-testable
    const r = radiusOf(node);
    const color = palette.type[node.data.type];
    const isFocus = node.id === focusId;
    const isSelected = node.id === selectedId;
    const hitScore = spotlightActive ? spotlight!.scores.get(node.id) : undefined;
    const hollow = timeline?.hollow.has(node.id) ?? false;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(node.x, node.y);
    if (isSelected || isFocus) {
      ctx.beginPath(); ctx.arc(0, 0, r + 4 / scale + 2, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = alpha * 0.22; ctx.fill(); ctx.globalAlpha = alpha;
    }
    if (hitScore !== undefined) {
      // Spotlight ring, scaled by relevance score
      const ring = spotlightRing(hitScore, spotlight!.max);
      ctx.beginPath(); ctx.arc(0, 0, r + ring.radiusBonus / Math.max(0.5, scale) + 1.5, 0, Math.PI * 2);
      ctx.lineWidth = ring.width / Math.max(0.5, scale);
      ctx.strokeStyle = palette.label;
      ctx.globalAlpha = alpha * ring.alpha;
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
    drawShape(ctx, TYPE_SHAPE[node.data.type], r, color, isSelected ? palette.label : undefined, hollow ? 'hollow' : 'fill');
    ctx.restore();

    // Labels: hovered/selected/neighbour/hit always; otherwise above a zoom threshold
    const wantLabel =
      (emphasis?.has(node.id) ?? false) ||
      hitScore !== undefined ||
      (showLabels && (scale * r > 6.5 || (node.data.type !== 'memory' && scale > 1.6)));
    if (!wantLabel) return;
    const fontPx = Math.max(10, Math.min(14, 11 + node.degree * 0.2)) / scale;
    ctx.save();
    ctx.globalAlpha = Math.max(alpha, emphasis?.has(node.id) ? 1 : 0);
    ctx.font = `${isFocus ? 600 : 500} ${fontPx}px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const label = node.data.label.length > 42 ? `${node.data.label.slice(0, 40)}…` : node.data.label;
    const y = node.y + r + 3 / scale;
    ctx.lineWidth = 3 / scale;
    ctx.strokeStyle = palette.labelHalo;
    ctx.lineJoin = 'round';
    ctx.strokeText(label, node.x, y);
    ctx.fillStyle = palette.label;
    ctx.fillText(label, node.x, y);
    ctx.restore();
  }, [palette, focusId, selectedId, emphasis, showLabels, alphaOf, spotlight, spotlightActive, timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  const paintPointerArea = useCallback((node: GraphViewNode, color: string, ctx: CanvasRenderingContext2D) => {
    if (node.x === undefined || node.y === undefined) return;
    if (alphaOf(node) <= 0) return; // hidden nodes are not clickable
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radiusOf(node) + 4, 0, Math.PI * 2); // hit target larger than the mark
    ctx.fill();
  }, [alphaOf]); // eslint-disable-line react-hooks/exhaustive-deps

  const linkColor = useCallback((l: GraphViewLink) => {
    const s = idOf(l.source); const t = idOf(l.target);
    const tv = timeline?.edgeVisibility.get(l.id);
    if (tv === 'hidden') return 'rgba(0,0,0,0)';
    if (spotlightActive && spotlight!.filter && (alphaOfId(s) <= 0 || alphaOfId(t) <= 0)) return 'rgba(0,0,0,0)';
    if (emphasis) return s === focusId || t === focusId ? palette.edgeStrong : 'rgba(0,0,0,0)';
    if (spotlightActive) {
      const touchesHit = spotlight!.scores.has(s) || spotlight!.scores.has(t);
      return touchesHit ? palette.edgeStrong : palette.edge;
    }
    return palette.edge;
  }, [emphasis, focusId, palette, spotlight, spotlightActive, timeline, alphaOfId]);

  const linkWidth = useCallback((l: GraphViewLink) => {
    const s = idOf(l.source); const t = idOf(l.target);
    if (timeline?.edgeVisibility.get(l.id) === 'faded') return 0.4;
    return focusId && (s === focusId || t === focusId) ? 1.6 : l.data.type === 'memory_entity' ? 0.6 : 1;
  }, [focusId, timeline]);

  return (
    <div ref={wrapRef} className={className} style={{ background: palette.surface }} data-testid="knowledge-graph-view">
      <ForceGraph2D<GraphViewNode, GraphViewLink>
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor={palette.surface}
        nodeId="id"
        nodeLabel={() => ''}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintPointerArea}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkDirectionalParticles={0}
        enableNodeDrag
        onNodeHover={(n) => { const id = n ? n.id : null; setHoverId(id); onHoverChange?.(id); }}
        onNodeClick={(n, ev) => {
          // The second click of a double-click carries detail === 2: that is the
          // explicit "focus here" gesture; a single click only selects.
          if (onFocus && ((ev as MouseEvent | undefined)?.detail ?? 0) >= 2) { onFocus(n.id); return; }
          onSelect(n.id === selectedId ? null : n.id);
        }}
        onBackgroundClick={() => onSelect(null)}
        onNodeDragEnd={(n) => { n.fx = undefined; n.fy = undefined; }}
        warmupTicks={reducedMotion ? 300 : 0}
        cooldownTicks={reducedMotion ? 0 : 220}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.32}
        onEngineTick={flushPendingFocus}
        onEngineStop={onEngineStop}
        autoPauseRedraw={false}
        minZoom={0.15}
        maxZoom={8}
      />
    </div>
  );
});
