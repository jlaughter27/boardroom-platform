import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphNodeType } from '@boardroom/shared';
import {
  NODE_TYPES, TYPE_BASE_RADIUS, TYPE_LABEL, TYPE_SHAPE, TYPE_SINGULAR, communityColor, drawShape, readGraphPalette, traceShapePath, withAlpha, type GraphPalette,
} from './graph-theme';
import { createGraphStore, idOf, syncGraphData, type GraphViewLink, type GraphViewNode } from './graph-data';
import { nodeAlpha, spotlightRing, type SpotlightState } from './graph-emphasis';
import { formatDay, type TimelineVisibility } from './graph-timeline';
import { hullOutline, labelAnchor, traceHull, type HullOutline } from './graph-hulls';
import {
  badgeLabel, communityLabelAlpha, dedupeHitLabels, estimateTextWidth, hubThreshold, hullAlphaFactor, labelFontPx, labelPriority, placeAnchoredLabels, placeLabels,
  truncateLabel, wantsLabel, zoomTier, type AnchoredLabel, type LabelBox,
} from './graph-labels';
import type { Community } from './graph-communities';
import { clusterForce } from './graph-forces';
import { GraphMinimap, boundsOf, fitTransform, viewportRect, type MinimapHandle, type MinimapNode } from './graph-minimap';
import { ShapeGlyph } from './ShapeGlyph';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { cn } from '../../lib/cn';

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
 *  - wheel / pinch → zoom; drag background → pan; minimap click → pan
 *  - keyboard (canvas focused): + / − zoom, arrows pan, 0 fit
 *  - node radius ∝ √degree, clamped
 *  - reduced motion → the layout is computed off-screen, then shown at rest;
 *    no edge particles, no pulses, no tooltip transitions
 *  - node / link objects are stable per id (see graph-data.ts): selecting a
 *    node never relayouts; only a change in the visible id set re-heats
 *  - viewport: the first layout (and any later id-set change) auto-fits, but
 *    an explicit viewport intent — `focusNode` / `zoomToFitIds` within the last
 *    INTENT_TTL_MS — wins over that fit and is re-applied once the simulation
 *    settles, so centring on a node or fitting the hits survives a relayout
 *  - spotlight (search hits) → score-scaled rings on hits, the rest dims or,
 *    with "Filter to results", is not painted at all (no relayout either way)
 *  - timeline → nodes outside the window fade or are not painted; edges
 *    follow their endpoints; invalidated memories are drawn hollow and pulse
 *    once when they enter the window
 *
 * Rendering layers, per frame:
 *  1. onRenderFramePre  — vignette + faint grid (atmosphere), community hulls
 *  2. links (library)   — typed widths / dashes / curvature; focus edges are
 *                         repainted as source→target colour gradients with
 *                         particles (never under reduced motion)
 *  3. nodes             — glow + ring for the focus, ring for the selection,
 *                         spotlight rings, hollow pulses, crisp inner stroke
 *                         and soft shadow at high zoom
 *  4. onRenderFramePost — community labels (fade out as you zoom in), node
 *                         labels by zoom tier with a greedy collision pass,
 *                         minimap refresh
 *  The hover card is DOM, positioned over the canvas, never drawn on it.
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
  /** Centre the viewport on a graph-space point (minimap / keyboard). */
  panTo(x: number, y: number): void;
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
  /** Community partition (see graph-communities.ts); hulls + labels are drawn when present. */
  communityOf?: ReadonlyMap<string, number> | null;
  communities?: readonly Community[] | null;
  showCommunities?: boolean;
  /** Legend chips double as the type filter when both are given. */
  typeFilter?: ReadonlySet<KnowledgeGraphNodeType> | null;
  onToggleType?(type: KnowledgeGraphNodeType): void;
  typeCounts?: Partial<Record<KnowledgeGraphNodeType, number>> | null;
  showMinimap?: boolean;
  className?: string;
}

const PENDING_FOCUS_TTL_MS = 5000;
/** How long an explicit focus / fit-ids request outranks the automatic fit after a relayout. */
export const INTENT_TTL_MS = 5000;
const PULSE_MS = 700;
const HULL_MIN_MEMBERS = 2;
const HULL_LABEL_MIN_MEMBERS = 4;

type ViewportIntent =
  | { kind: 'focus'; id: string; zoom: number; at: number }
  | { kind: 'fit-ids'; ids: ReadonlySet<string>; at: number };

interface FrameHull { id: number; outline: HullOutline; color: string; label: string; members: number; emphasised: boolean }

interface FrameState {
  scale: number;
  /** Ids whose label survived this frame's collision pass (null until the post pass has run once) */
  labels: Set<string> | null;
  hulls: FrameHull[];
  counter: number;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Nice grid step so lines sit ~90px apart on screen at any zoom. */
function gridStep(scale: number): number {
  const raw = 90 / Math.max(1e-6, scale);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

const GLASS = 'bg-card supports-[backdrop-filter]:bg-card/80 supports-[backdrop-filter]:backdrop-blur-md [@media(prefers-reduced-transparency:reduce)]:bg-card [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none';

export const KnowledgeGraphView = forwardRef<KnowledgeGraphViewHandle, Props>(function KnowledgeGraphView(
  {
    nodes, edges, selectedId, onSelect, onFocus, onHoverChange, showLabels, depthById, spotlight = null, timeline = null,
    communityOf = null, communities = null, showCommunities = true, typeFilter = null, onToggleType, typeCounts = null, showMinimap = true, className,
  },
  ref,
) {
  const fgRef = useRef<ForceGraphMethods<GraphViewNode, GraphViewLink> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<MinimapHandle>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [palette, setPalette] = useState<GraphPalette>(() => readGraphPalette());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<FrameState>({ scale: 1, labels: null, hulls: [], counter: 0 });
  const alphaOfRef = useRef<(n: GraphViewNode) => number>(() => 1);

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
  const communityOfRef = useRef(communityOf);
  communityOfRef.current = communityOf;
  const { graphData, neighbours, idsChanged } = useMemo(
    () => syncGraphData(storeRef.current, nodes, edges, depthById),
    [nodes, edges, depthById],
  );

  /** Degree threshold for "hub" labels at low zoom (top 8% by degree). */
  const hubDegree = useMemo(() => hubThreshold(graphData.nodes.map((n) => n.degree)), [graphData]);

  /** Curvature per edge id so parallel edges between the same pair fan out instead of overlapping. */
  const curvatureById = useMemo(() => {
    const groups = new Map<string, GraphViewLink[]>();
    for (const l of graphData.links) {
      const k = pairKey(idOf(l.source), idOf(l.target));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(l);
    }
    const out = new Map<string, number>();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.forEach((l, i) => {
        const sign = idOf(l.source) < idOf(l.target) ? 1 : -1;
        out.set(l.id, sign * (i - (list.length - 1) / 2) * 0.28);
      });
    }
    return out;
  }, [graphData]);

  // ── Forces — only re-heat when the id set changed, never on selection ─────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !idsChanged) return;
    const n = graphData.nodes.length;
    // Communities gather around their own centroid, and edges that cross a
    // community boundary are long and loose, so Louvain clusters settle into
    // distinct regions and their hulls stop overlapping. Only (re)installed on
    // a relayout: a partition change alone never moves settled nodes.
    const partition = communityOfRef.current;
    const clustered = !!partition && partition.size > 0 && n > 20;
    const crosses = (l: GraphViewLink) => clustered && partition!.get(idOf(l.source)) !== partition!.get(idOf(l.target));
    fg.d3Force('charge')?.strength(n > 600 ? -45 : n > 200 ? -85 : -130).distanceMax(420);
    fg.d3Force('link')
      ?.distance((l: GraphViewLink) => (l.data.type === 'memory_entity' ? 28 : l.data.type === 'goal_hierarchy' ? 70 : 48) * (crosses(l) ? 2.4 : 1))
      .strength((l: GraphViewLink) => (l.data.type === 'memory_entity' ? 0.6 : 0.9) * (crosses(l) ? 0.25 : 1));
    const cf = clustered ? clusterForce<GraphViewNode>(partition!, n > 400 ? 0.1 : 0.16) : null;
    fg.d3Force('cluster', cf ?? null!);
    wrapRef.current?.removeAttribute('data-settled');
    fg.d3ReheatSimulation();
  }, [graphData, idsChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Viewport intents ──────────────────────────────────────────────────────
  const lastIntent = useRef<ViewportIntent | null>(null);
  const intentFresh = (i: ViewportIntent | null): i is ViewportIntent => !!i && Date.now() - i.at <= INTENT_TTL_MS;

  const fitOnce = useRef(false);
  useEffect(() => { if (idsChanged) fitOnce.current = false; }, [graphData, idsChanged]);

  // ── Imperative API ────────────────────────────────────────────────────────
  /**
   * Whole-graph fit with asymmetric insets: 72px on top is the clearance for
   * the first row of community labels, 32px elsewhere, so hulls + labels use
   * ~85% of the canvas. Falls back to the library fit when nothing is positioned.
   */
  const fitAll = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const ms = reducedMotion ? 0 : 500;
    const pts: Array<{ x: number; y: number }> = [];
    for (const n of storeRef.current.graphData.nodes) {
      if (n.x === undefined || n.y === undefined || Number.isNaN(n.x) || Number.isNaN(n.y)) continue;
      if (alphaOfRef.current(n) <= 0) continue;
      pts.push({ x: n.x, y: n.y });
    }
    const b = boundsOf(pts);
    if (!b) { fg.zoomToFit(ms, 48); return; }
    const hullPad = 16; // hulls extend past their members
    const t = fitTransform({ minX: b.minX - hullPad, minY: b.minY - hullPad, maxX: b.maxX + hullPad, maxY: b.maxY + hullPad }, size.width, size.height, { top: 72, right: 32, bottom: 32, left: 32 });
    fg.centerAt(t.cx, t.cy, ms);
    fg.zoom(t.k, ms);
  }, [reducedMotion, size]);

  const zoomToFit = useCallback(() => {
    lastIntent.current = null;
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
    fitOnce.current = true;
    fitIds(ids);
  }, [fitIds]);

  const pendingFocus = useRef<{ id: string; zoom: number; at: number } | null>(null);

  const tryFocus = useCallback((id: string, zoom: number): boolean => {
    const fg = fgRef.current;
    if (!fg) return true;
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

  const panTo = useCallback((x: number, y: number) => {
    fgRef.current?.centerAt(x, y, reducedMotion ? 0 : 300);
  }, [reducedMotion]);

  useImperativeHandle(ref, () => ({
    focusNode(id, zoom = 2.2) {
      const at = Date.now();
      lastIntent.current = { kind: 'focus', id, zoom, at };
      fitOnce.current = true;
      if (tryFocus(id, zoom)) { pendingFocus.current = null; return; }
      pendingFocus.current = { id, zoom, at };
    },
    zoomToFit,
    zoomToFitIds,
    panTo,
  }), [tryFocus, zoomToFit, zoomToFitIds, panTo]);

  const onEngineStop = useCallback(() => {
    wrapRef.current?.setAttribute('data-settled', 'true');
    if (pendingFocus.current) { flushPendingFocus(); fitOnce.current = true; return; }
    const intent = lastIntent.current;
    if (intentFresh(intent)) {
      fitOnce.current = true;
      if (intent.kind === 'focus') tryFocus(intent.id, intent.zoom);
      else fitIds(intent.ids);
      return;
    }
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
  const focusCommunity = focusId && communityOf ? communityOf.get(focusId) : undefined;

  // ── Hollow pulses: a memory that becomes hollow (timeline) pulses once ───
  const hollowSeen = useRef<Set<string>>(new Set());
  const pulses = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const now = Date.now();
    const next = new Set<string>();
    for (const id of timeline?.hollow ?? []) {
      next.add(id);
      if (!hollowSeen.current.has(id) && !reducedMotion) pulses.current.set(id, now);
    }
    hollowSeen.current = next;
  }, [timeline, reducedMotion]);

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
  alphaOfRef.current = alphaOf;

  const alphaOfId = useCallback((id: string): number => {
    const n = storeRef.current.nodeMap.get(id);
    return n ? alphaOf(n) : 1;
  }, [alphaOf]);

  /** Current canvas transform in CSS px: scale k plus translation (tx, ty). Falls back when the context cannot report it. */
  const readTransform = (ctx: CanvasRenderingContext2D, scale: number) => {
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined;
    if (!m || !Number.isFinite(m.a) || m.a === 0) return { k: scale, tx: 0, ty: 0, dpr: 1 };
    const dpr = m.a / scale;
    return { k: scale, tx: m.e / dpr, ty: m.f / dpr, dpr };
  };

  // Layer 1: atmosphere + hulls
  const onRenderFramePre = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const f = frame.current;
    f.scale = scale;
    f.counter += 1;
    const { tx, ty, dpr } = readTransform(ctx, scale);
    const { width, height } = size;

    // Vignette (screen space, under everything)
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.35, width / 2, height / 2, Math.max(width, height) * 0.75);
    if (g && typeof g.addColorStop === 'function') {
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, palette.vignette);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();

    // Faint grid (graph space, so it pans with the canvas)
    const step = gridStep(scale);
    const x0 = Math.floor((-tx / scale) / step) * step; const x1 = (width - tx) / scale;
    const y0 = Math.floor((-ty / scale) / step) * step; const y1 = (height - ty) / scale;
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.restore();

    // Community hulls
    f.hulls = [];
    if (!showCommunities || !communityOf) return;
    const members = new Map<number, Array<{ x: number; y: number }>>();
    for (const n of graphData.nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const c = communityOf.get(n.id);
      if (c === undefined || alphaOf(n) <= 0) continue;
      if (!members.has(c)) members.set(c, []);
      members.get(c)!.push({ x: n.x, y: n.y });
    }
    const pad = 9 + 6 / Math.max(0.4, scale);
    const labelById = new Map((communities ?? []).map((c) => [c.id, c.label]));
    const anyFocus = focusCommunity !== undefined;
    // Quieter inside a local graph (you are *in* a community) and under a spotlight (hits must pop).
    const zoomFactor = hullAlphaFactor(scale) * (spotlightActive ? 0.45 : 1) * (depthById ? 0.55 : 1);
    ctx.save();
    for (const [id, pts] of [...members.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (pts.length < HULL_MIN_MEMBERS) continue;
      const outline = hullOutline(pts, pad);
      if (!outline) continue;
      const color = communityColor(palette, id);
      const emphasised = focusCommunity === id;
      const fillA = palette.hullFillAlpha * zoomFactor * (anyFocus ? (emphasised ? 1.15 : 0.5) : 1);
      const strokeA = palette.hullStrokeAlpha * zoomFactor * (anyFocus ? (emphasised ? 1 : 0.45) : 1);
      traceHull(ctx, outline);
      ctx.fillStyle = withAlpha(color, fillA);
      ctx.fill();
      ctx.lineWidth = 1.2 / scale;
      ctx.setLineDash(emphasised ? [] : [6 / scale, 4 / scale]);
      ctx.strokeStyle = withAlpha(color, strokeA);
      ctx.stroke();
      f.hulls.push({ id, outline, color, label: labelById.get(id) ?? '', members: pts.length, emphasised });
    }
    ctx.restore();
  }, [size, palette, showCommunities, communityOf, communities, graphData, alphaOf, focusCommunity, spotlightActive, depthById]);

  const paintNode = useCallback((node: GraphViewNode, ctx: CanvasRenderingContext2D, scale: number) => {
    if (node.x === undefined || node.y === undefined) return;
    const alpha = alphaOf(node);
    if (alpha <= 0) return; // hidden: not painted, not hit-testable
    const r = radiusOf(node);
    const color = palette.type[node.data.type];
    const isFocus = node.id === focusId;
    const isSelected = node.id === selectedId;
    const isRoot = node.depth === 0;
    const hitScore = spotlightActive ? spotlight!.scores.get(node.id) : undefined;
    const hollow = timeline?.hollow.has(node.id) ?? false;
    const inv = 1 / Math.max(0.5, scale);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(node.x, node.y);

    if (isFocus) {
      // Soft glow: radial gradient in the node's own hue, then a crisp ring
      const outer = r * 2.6 + 10 * inv;
      const g = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, outer);
      if (g && typeof g.addColorStop === 'function') {
        g.addColorStop(0, withAlpha(color, 0.5));
        g.addColorStop(0.55, withAlpha(color, 0.16));
        g.addColorStop(1, withAlpha(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, outer, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, r + 3.5 * inv, 0, Math.PI * 2);
      ctx.lineWidth = 1.6 * inv; ctx.strokeStyle = color; ctx.stroke();
    }
    if (isSelected && !isFocus) {
      // Selection stays visible while something else is hovered: a quiet ink ring
      ctx.beginPath(); ctx.arc(0, 0, r + 3.5 * inv, 0, Math.PI * 2);
      ctx.lineWidth = 1.4 * inv; ctx.strokeStyle = palette.label; ctx.globalAlpha = alpha * 0.9; ctx.stroke(); ctx.globalAlpha = alpha;
    }
    if (isSelected && isFocus) {
      // Selected AND focused (hover on the selection): add the ink ring outside the glow ring so both read
      ctx.beginPath(); ctx.arc(0, 0, r + 6.5 * inv, 0, Math.PI * 2);
      ctx.lineWidth = 1.2 * inv; ctx.strokeStyle = palette.label; ctx.globalAlpha = alpha * 0.8; ctx.stroke(); ctx.globalAlpha = alpha;
    }
    if (isRoot && !isFocus && !isSelected) {
      // Local-graph root: a thin dashed marker so the anchor is always findable
      ctx.beginPath(); ctx.arc(0, 0, r + 4 * inv, 0, Math.PI * 2);
      ctx.setLineDash([3 * inv, 3 * inv]); ctx.lineWidth = 1 * inv; ctx.strokeStyle = withAlpha(color, 0.9); ctx.stroke(); ctx.setLineDash([]);
    }
    if (hitScore !== undefined) {
      const ring = spotlightRing(hitScore, spotlight!.max);
      ctx.beginPath(); ctx.arc(0, 0, r + ring.radiusBonus * inv + 1.5, 0, Math.PI * 2);
      ctx.lineWidth = ring.width * inv;
      ctx.strokeStyle = palette.label;
      ctx.globalAlpha = alpha * ring.alpha;
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
    const pulseAt = pulses.current.get(node.id);
    if (pulseAt !== undefined) {
      const t = (Date.now() - pulseAt) / PULSE_MS;
      if (t >= 1) pulses.current.delete(node.id);
      else {
        ctx.beginPath(); ctx.arc(0, 0, r + (2 + 12 * t) * inv, 0, Math.PI * 2);
        ctx.lineWidth = 1.5 * inv; ctx.strokeStyle = color; ctx.globalAlpha = alpha * (1 - t); ctx.stroke(); ctx.globalAlpha = alpha;
      }
    }

    const crisp = scale > 2.2;
    if (crisp && !hollow) {
      ctx.shadowColor = palette.dark ? 'rgba(0,0,0,0.55)' : 'rgba(26,26,22,0.22)';
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 1.5;
    }
    drawShape(ctx, TYPE_SHAPE[node.data.type], r, color, undefined, hollow ? 'hollow' : 'fill');
    if (crisp && !hollow && TYPE_SHAPE[node.data.type] !== 'ring') {
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      traceShapePath(ctx, TYPE_SHAPE[node.data.type], r);
      ctx.lineWidth = 1 / scale; ctx.strokeStyle = withAlpha(palette.surface, 0.7); ctx.stroke();
    }
    ctx.restore();
  }, [palette, focusId, selectedId, alphaOf, spotlight, spotlightActive, timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Layer 4: community labels, node labels (semantic zoom + collision), minimap
  const onRenderFramePost = useCallback((ctx: CanvasRenderingContext2D, scale: number) => {
    const f = frame.current;
    const { k, tx, ty } = readTransform(ctx, scale);
    const tier = zoomTier(scale);

    // Community labels hang from their OWN hull: x = outline centroid, y = visible
    // top edge − 10px. Collisions resolve sideways, then one line down into the
    // hull edge, never upward. Hidden entirely while a spotlight is active (they
    // would compete with the hit labels).
    const cAlpha = spotlightActive ? 0 : communityLabelAlpha(scale) * (emphasis ? 0.6 : 1);
    const COMMUNITY_FONT = 11;
    const COMMUNITY_LINE = COMMUNITY_FONT * 1.3;
    const boxes: LabelBox[] = [];
    const communityDraw = new Map<string, { h: FrameHull; text: string }>();
    const anchored: AnchoredLabel[] = [];
    if (cAlpha > 0.02) {
      for (const h of f.hulls) {
        if (h.members < HULL_LABEL_MIN_MEMBERS || !h.label) continue;
        const a = labelAnchor(h.outline);
        let text = h.label.toUpperCase();
        let width = estimateTextWidth(text, COMMUNITY_FONT) * 1.25; // upper-case + letter-spaced glyphs run wider
        if (width > size.width - 16) { // narrow canvas: fall back to the first hub's name, else skip
          text = text.split(' · ')[0];
          width = estimateTextWidth(text, COMMUNITY_FONT) * 1.25;
          if (width > size.width - 16) continue;
        }
        const sx = a.x * k + tx; const bottom = a.y * k + ty - 10; // 10px above the hull's top edge
        const id = `community:${h.id}`;
        anchored.push({ id, x: sx - width / 2, y: bottom - COMMUNITY_LINE, width, height: COMMUNITY_LINE, priority: 10_000 + h.members });
        communityDraw.set(id, { h, text });
      }
    }
    const communityPlaced = placeAnchoredLabels(anchored, [], { padding: 3, step: 24, lineHeight: COMMUNITY_LINE, bounds: { width: size.width } });
    for (const l of anchored) {
      const pos = communityPlaced.get(l.id);
      if (!pos) continue;
      boxes.push({ id: l.id, x: pos.x, y: pos.y, width: l.width, height: l.height, priority: l.priority, forced: true }); // node labels dodge them
    }

    // Node labels: who wants one, then who gets one. Spotlight hits that would
    // print the same text collapse into one label with a ×N badge.
    const info = new Map<string, { node: GraphViewNode; alpha: number; forced: boolean; fontPx: number; text: string; y: number }>();
    let hitCounts: Map<string, number> | null = null;
    if (spotlightActive) {
      const hits: Array<{ id: string; key: string; priority: number }> = [];
      for (const n of graphData.nodes) {
        if (!spotlight!.scores.has(n.id) || alphaOf(n) <= 0) continue;
        hits.push({ id: n.id, key: truncateLabel(n.data.label), priority: spotlight!.scores.get(n.id)! });
      }
      hitCounts = dedupeHitLabels(hits);
    }
    for (const n of graphData.nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const alpha = alphaOf(n);
      if (alpha <= 0) continue;
      const isHit = spotlightActive && spotlight!.scores.has(n.id);
      if (alpha < 0.3 && !isHit && n.id !== selectedId) continue; // a faded node's label is only noise
      if (isHit && hitCounts && !hitCounts.has(n.id)) continue; // a duplicate hit: its twin carries the badge
      // Forced (never dropped): only the focus / selected node itself. Its neighbourhood and the
      // hits always *want* a label but still yield on overlap, so a dense ring never turns into a word pile.
      const inRing = (emphasis?.has(n.id) ?? false);
      const forced = n.id === focusId || n.id === selectedId;
      if (!wantsLabel({ type: n.data.type, degree: n.degree, hubDegree, tier, forced: forced || inRing || isHit, showLabels })) continue;
      const fontPx = labelFontPx(n.degree, forced || inRing);
      const text = isHit && hitCounts ? badgeLabel(truncateLabel(n.data.label), hitCounts.get(n.id) ?? 1) : truncateLabel(n.data.label);
      const r = radiusOf(n);
      const yGraph = n.y + r + 3 / scale;
      const sx = n.x * k + tx; const sy = yGraph * k + ty;
      const width = estimateTextWidth(text, fontPx);
      boxes.push({ id: n.id, x: sx - width / 2, y: sy, width, height: fontPx * 1.3, forced, priority: labelPriority({ type: n.data.type, degree: n.degree, forced: forced || inRing, isFocus: n.id === focusId, isHit }) });
      info.set(n.id, { node: n, alpha, forced: forced || inRing, fontPx, text, y: yGraph });
    }
    const kept = placeLabels(boxes, { padding: 4 });
    f.labels = kept;
    if (communityDraw.size) {
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round';
      const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
      if ('letterSpacing' in spaced) spaced.letterSpacing = `${0.08 * COMMUNITY_FONT / scale}px`;
      for (const l of anchored) {
        const pos = communityPlaced.get(l.id); const c = communityDraw.get(l.id);
        if (!pos || !c) continue;
        // back to graph space: box centre x, box bottom y
        const gx = (pos.x + l.width / 2 - tx) / k; const gy = (pos.y + l.height - ty) / k;
        ctx.font = `600 ${COMMUNITY_FONT / scale}px ${palette.font}`;
        ctx.globalAlpha = Math.min(0.9, cAlpha) * (c.h.emphasised || focusCommunity === undefined ? 1 : 0.55);
        ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = palette.labelHalo;
        ctx.strokeText(c.text, gx, gy);
        ctx.fillStyle = c.h.color;
        ctx.fillText(c.text, gx, gy);
      }
      if ('letterSpacing' in spaced) spaced.letterSpacing = '0px';
      ctx.restore();
    }
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
    for (const id of kept) {
      const it = info.get(id);
      if (!it) continue; // a community label box
      const n = it.node;
      ctx.globalAlpha = it.forced ? 1 : Math.min(1, it.alpha + 0.1);
      ctx.font = `${n.id === focusId ? 600 : 500} ${it.fontPx / scale}px ${palette.font}`;
      ctx.lineWidth = 3 / scale; ctx.strokeStyle = palette.labelHalo;
      ctx.strokeText(it.text, n.x!, it.y);
      ctx.fillStyle = n.data.type === 'memory' && !it.forced ? withAlpha(palette.label, 0.75) : palette.label;
      ctx.fillText(it.text, n.x!, it.y);
    }
    ctx.restore();

    // Minimap (every other frame is plenty)
    if (showMinimap && minimapRef.current && f.counter % 2 === 0) {
      const fg = fgRef.current;
      const pts: MinimapNode[] = [];
      for (const n of graphData.nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        pts.push({ x: n.x, y: n.y, type: n.data.type, alpha: alphaOf(n) });
      }
      let vp = null;
      if (fg && typeof fg.centerAt === 'function' && typeof fg.zoom === 'function') {
        const c = fg.centerAt() as { x: number; y: number } | undefined;
        const z = fg.zoom() as number | undefined;
        if (c && typeof z === 'number' && z > 0) vp = viewportRect({ k: z, x: size.width / 2 - c.x * z, y: size.height / 2 - c.y * z }, size.width, size.height);
      }
      minimapRef.current.draw(pts, vp);
    }
  }, [graphData, alphaOf, emphasis, spotlight, spotlightActive, selectedId, focusId, hubDegree, showLabels, palette, focusCommunity, showMinimap, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const paintPointerArea = useCallback((node: GraphViewNode, color: string, ctx: CanvasRenderingContext2D) => {
    if (node.x === undefined || node.y === undefined) return;
    if (alphaOf(node) <= 0) return; // hidden nodes are not clickable
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radiusOf(node) + 4, 0, Math.PI * 2);
    ctx.fill();
  }, [alphaOf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Links ─────────────────────────────────────────────────────────────────
  const touchesFocus = useCallback((l: GraphViewLink) => !!focusId && (idOf(l.source) === focusId || idOf(l.target) === focusId), [focusId]);

  const linkHidden = useCallback((l: GraphViewLink) => {
    const s = idOf(l.source); const t = idOf(l.target);
    if (timeline?.edgeVisibility.get(l.id) === 'hidden') return true;
    if (spotlightActive && spotlight!.filter && (alphaOfId(s) <= 0 || alphaOfId(t) <= 0)) return true;
    return false;
  }, [timeline, spotlightActive, spotlight, alphaOfId]);

  const linkColor = useCallback((l: GraphViewLink) => {
    const s = idOf(l.source); const t = idOf(l.target);
    if (linkHidden(l)) return 'rgba(0,0,0,0)';
    if (emphasis) return s === focusId || t === focusId ? palette.edgeStrong : 'rgba(0,0,0,0)';
    if (spotlightActive) {
      const touchesHit = spotlight!.scores.has(s) || spotlight!.scores.has(t);
      return touchesHit ? palette.edgeStrong : palette.edge;
    }
    if (l.data.type === 'goal_hierarchy' || l.data.type === 'goal_project') return withAlpha(palette.type.goal, palette.dark ? 0.45 : 0.4);
    return palette.edge;
  }, [emphasis, focusId, palette, spotlight, spotlightActive, linkHidden]);

  const linkWidth = useCallback((l: GraphViewLink) => {
    if (timeline?.edgeVisibility.get(l.id) === 'faded') return 0.4;
    if (touchesFocus(l)) return 1.8;
    switch (l.data.type) {
      case 'goal_hierarchy': return 1.8;
      case 'goal_project': return 1.4;
      case 'memory_entity': return 0.6;
      default: return 1;
    }
  }, [touchesFocus, timeline]);

  const linkLineDash = useCallback((l: GraphViewLink): number[] | null => {
    if (l.data.type === 'goal_hierarchy') return [5, 4];
    if (l.data.type === 'task_dependency') return [2, 3];
    return null;
  }, []);

  const linkCurvature = useCallback((l: GraphViewLink) => curvatureById.get(l.id) ?? 0, [curvatureById]);

  /** Focus edges are repainted as a source→target colour gradient (the library draws everything else). */
  const linkCanvasObjectMode = useCallback((l: GraphViewLink) => (emphasis && touchesFocus(l) && !linkHidden(l) ? 'replace' : 'default'), [emphasis, touchesFocus, linkHidden]);

  const paintLink = useCallback((l: GraphViewLink, ctx: CanvasRenderingContext2D, scale: number) => {
    const s = l.source; const t = l.target;
    if (typeof s !== 'object' || typeof t !== 'object' || s.x === undefined || t.x === undefined || s.y === undefined || t.y === undefined) return;
    const g = ctx.createLinearGradient(s.x, s.y, t.x, t.y);
    const cs = palette.type[s.data.type]; const ct = palette.type[t.data.type];
    if (g && typeof g.addColorStop === 'function') {
      g.addColorStop(0, withAlpha(cs, 0.95));
      g.addColorStop(1, withAlpha(ct, 0.95));
      ctx.strokeStyle = g;
    } else ctx.strokeStyle = palette.edgeStrong;
    ctx.lineWidth = linkWidth(l) / scale;
    ctx.setLineDash((linkLineDash(l) ?? []).map((d) => d / scale));
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    const cp = (l as GraphViewLink & { __controlPoints?: number[] | null }).__controlPoints;
    if (cp && cp.length === 2) ctx.quadraticCurveTo(cp[0], cp[1], t.x, t.y);
    else ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [palette, linkWidth, linkLineDash]);

  const particles = useCallback((l: GraphViewLink) => (!reducedMotion && emphasis && touchesFocus(l) && !linkHidden(l) ? 3 : 0), [reducedMotion, emphasis, touchesFocus, linkHidden]);
  const particleColor = useCallback((l: GraphViewLink) => {
    const t = l.target;
    return typeof t === 'object' ? palette.type[t.data.type] : palette.edgeStrong;
  }, [palette]);

  // ── Hover card (DOM, positioned over the canvas) ──────────────────────────
  const hovered = hoverId ? storeRef.current.nodeMap.get(hoverId) ?? null : null;
  const placeTooltip = useCallback(() => {
    const el = tooltipRef.current; const p = pointer.current;
    if (!el || !p) return;
    const w = el.offsetWidth || 260; const h = el.offsetHeight || 90;
    const right = p.x + 18 + w <= size.width; const below = p.y + 18 + h <= size.height;
    const x = right ? p.x + 18 : Math.max(8, p.x - 18 - w);
    const y = below ? p.y + 18 : Math.max(8, p.y - 18 - h);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.style.transformOrigin = `${right ? 'left' : 'right'} ${below ? 'top' : 'bottom'}`;
  }, [size]);
  useEffect(() => { placeTooltip(); }, [hoverId, placeTooltip]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (hoverId) placeTooltip();
  }, [hoverId, placeTooltip]);

  // ── Keyboard: zoom / pan / fit when the canvas has focus ──────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const fg = fgRef.current;
    if (!fg || e.metaKey || e.ctrlKey || e.altKey) return;
    const z = typeof fg.zoom === 'function' ? (fg.zoom() as number) : 1;
    const c = typeof fg.centerAt === 'function' ? (fg.centerAt() as { x: number; y: number }) : { x: 0, y: 0 };
    const pan = 48 / Math.max(0.2, z);
    const ms = reducedMotion ? 0 : 160;
    switch (e.key) {
      case '+': case '=': fg.zoom(Math.min(8, z * 1.25), ms); break;
      case '-': case '_': fg.zoom(Math.max(0.15, z / 1.25), ms); break;
      case '0': zoomToFit(); break;
      case 'ArrowLeft': fg.centerAt(c.x - pan, c.y, ms); break;
      case 'ArrowRight': fg.centerAt(c.x + pan, c.y, ms); break;
      case 'ArrowUp': fg.centerAt(c.x, c.y - pan, ms); break;
      case 'ArrowDown': fg.centerAt(c.x, c.y + pan, ms); break;
      default: return;
    }
    e.preventDefault();
  }, [reducedMotion, zoomToFit]);

  const hoveredCommunity = hovered && communityOf ? communityOf.get(hovered.id) : undefined;
  const hoveredCommunityLabel = hoveredCommunity !== undefined ? communities?.find((c) => c.id === hoveredCommunity)?.label : undefined;
  const tooltipMeta = hovered ? describeNode(hovered.data) : [];

  return (
    <div
      ref={wrapRef}
      className={cn('relative outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', className)}
      style={{ background: palette.surface }}
      data-testid="knowledge-graph-view"
      tabIndex={0}
      role="application"
      aria-label="Knowledge graph canvas. Use plus and minus to zoom, arrow keys to pan, 0 to fit."
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => { pointer.current = null; }}
    >
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
        linkLineDash={linkLineDash}
        linkCurvature={linkCurvature}
        linkCanvasObjectMode={linkCanvasObjectMode}
        linkCanvasObject={paintLink}
        linkDirectionalParticles={particles}
        linkDirectionalParticleWidth={2.2}
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalParticleColor={particleColor}
        onRenderFramePre={onRenderFramePre}
        onRenderFramePost={onRenderFramePost}
        enableNodeDrag
        onNodeHover={(n) => { const id = n ? n.id : null; setHoverId(id); onHoverChange?.(id); }}
        onNodeClick={(n, ev) => {
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

      {/* Hover card */}
      {hovered && (
        <div
          ref={tooltipRef}
          role="tooltip"
          data-testid="graph-tooltip"
          className={cn(
            'pointer-events-none absolute left-0 top-0 z-10 w-[260px] rounded-lg border border-border/80 p-2.5 shadow-lg',
            GLASS,
            !reducedMotion && 'motion-safe:animate-[graph-card-in_180ms_cubic-bezier(0.23,1,0.32,1)]',
          )}
        >
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span style={{ color: palette.type[hovered.data.type] }}><ShapeGlyph shape={TYPE_SHAPE[hovered.data.type]} color="currentColor" size={10} /></span>
            <span className="rounded-full border border-border px-1.5 py-px uppercase tracking-wide">{TYPE_SINGULAR[hovered.data.type]}</span>
            {hovered.data.domain && <span className="truncate">{hovered.data.domain}</span>}
            <span className="ml-auto shrink-0 tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDay(Date.parse(hovered.data.createdAt))}</span>
          </div>
          <div className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{hovered.data.label}</div>
          {(tooltipMeta.length > 0 || hoveredCommunityLabel) && (
            <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {tooltipMeta.join(' · ')}
              {hoveredCommunityLabel && <>{tooltipMeta.length > 0 ? ' · ' : ''}in <span className="text-foreground/80">{hoveredCommunityLabel}</span></>}
            </div>
          )}
          <div className="mt-1 text-[10px] text-muted-foreground/80">
            <span className="tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>{hovered.degree}</span> links · click to inspect · double-click to focus
          </div>
        </div>
      )}

      {/* Legend bar: type chips that double as the filter */}
      {typeFilter && onToggleType && (
        <div
          className={cn('absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-200px)] flex-wrap items-center gap-1 rounded-lg border border-border/80 p-1 shadow-md', GLASS)}
          role="group"
          aria-label="Legend and type filter"
          data-testid="graph-legend"
        >
          {NODE_TYPES.map((t) => {
            const on = typeFilter.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => onToggleType(t)}
                aria-pressed={on}
                title={`${on ? 'Hide' : 'Show'} ${TYPE_LABEL[t].toLowerCase()}`}
                className={cn(
                  'flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
                  on ? 'text-foreground hover:bg-muted' : 'text-muted-foreground/70 line-through decoration-muted-foreground/50 hover:bg-muted',
                )}
              >
                <span style={{ color: palette.type[t], opacity: on ? 1 : 0.4 }}><ShapeGlyph shape={TYPE_SHAPE[t]} color="currentColor" size={10} /></span>
                <span>{TYPE_LABEL[t]}</span>
                {typeCounts && typeCounts[t] !== undefined && size.width >= 1000 && (
                  <span className="tabular-nums text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>{typeCounts[t]}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Minimap */}
      {showMinimap && (
        <div className={cn('absolute bottom-3 right-3 z-10 rounded-lg border border-border/80 p-1 shadow-md', GLASS)}>
          <GraphMinimap
            ref={minimapRef}
            colors={palette.type}
            surface={palette.surface}
            frame={palette.label}
            onJump={panTo}
          />
        </div>
      )}
    </div>
  );
});

/** Two or three short facts for the hover card, by node type. */
function describeNode(n: KnowledgeGraphNode): string[] {
  const out: string[] = [];
  const meta = n.meta ?? {};
  if (n.type === 'memory') {
    if (typeof meta.memoryClass === 'string') out.push(meta.memoryClass.toLowerCase());
    if (n.status) out.push(n.status.toLowerCase());
    if (typeof meta.invalidAt === 'string' && meta.invalidAt) out.push(`invalid since ${formatDay(Date.parse(meta.invalidAt))}`);
    if (typeof n.importance === 'number') out.push(`importance ${Math.round(n.importance * 100)}%`);
  } else {
    if (n.status) out.push(n.status.replace(/_/g, ' ').toLowerCase());
    if (typeof meta.role === 'string') out.push(meta.role);
    if (typeof meta.level === 'number') out.push(`level ${meta.level}`);
    if (typeof meta.priority === 'string' || typeof meta.priority === 'number') out.push(`priority ${meta.priority}`);
    if (typeof meta.dueAt === 'string') out.push(`due ${formatDay(Date.parse(meta.dueAt))}`);
    if (typeof n.importance === 'number') out.push(`importance ${Math.round(n.importance * 100)}%`);
  }
  return out.slice(0, 3);
}
