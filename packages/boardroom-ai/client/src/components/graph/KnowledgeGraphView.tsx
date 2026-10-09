import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@boardroom/shared';
import {
  TYPE_BASE_RADIUS, TYPE_SHAPE, drawShape, readGraphPalette, type GraphPalette,
} from './graph-theme';
import { createGraphStore, idOf, syncGraphData, type GraphViewLink, type GraphViewNode } from './graph-data';

/**
 * Obsidian-style force graph on canvas.
 *
 * Interaction model (deliberately the same as Obsidian's graph view):
 *  - hover a node → it and its 1-hop neighbourhood stay vivid, everything
 *    else fades to ~12% alpha; labels for the neighbourhood appear
 *  - click → select (inspector opens); click background → clear
 *  - drag → move a node (pinned while dragging, released after)
 *  - wheel / pinch → zoom; drag background → pan
 *  - node radius ∝ √degree, clamped; labels appear above a zoom threshold
 *    or for hovered / selected / neighbour nodes
 *  - reduced motion → the layout is computed off-screen, then shown at rest
 *  - node / link objects are stable per id (see graph-data.ts): selecting a
 *    node never relayouts; only a change in the visible id set re-heats
 */

export type { GraphViewNode, GraphViewLink } from './graph-data';

export interface KnowledgeGraphViewHandle {
  focusNode(id: string, zoom?: number): void;
  zoomToFit(): void;
}

interface Props {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  selectedId: string | null;
  onSelect(id: string | null): void;
  onHoverChange?(id: string | null): void;
  showLabels: boolean;
  /** When set, node.depth drives the fade so rings farther from focus are dimmer. */
  depthById?: Map<string, number>;
  className?: string;
}

const PENDING_FOCUS_TTL_MS = 5000;

export const KnowledgeGraphView = forwardRef<KnowledgeGraphViewHandle, Props>(function KnowledgeGraphView(
  { nodes, edges, selectedId, onSelect, onHoverChange, showLabels, depthById, className },
  ref,
) {
  const fgRef = useRef<ForceGraphMethods<GraphViewNode, GraphViewLink> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [palette, setPalette] = useState<GraphPalette>(() => readGraphPalette());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

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

  // ── Imperative API ────────────────────────────────────────────────────────
  const zoomToFit = useCallback(() => fgRef.current?.zoomToFit(reducedMotion ? 0 : 500, 48), [reducedMotion]);

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
      if (tryFocus(id, zoom)) { pendingFocus.current = null; return; }
      pendingFocus.current = { id, zoom, at: Date.now() };
    },
    zoomToFit,
  }), [tryFocus, zoomToFit]);

  // Fit the viewport once per layout — i.e. once per change of the id set.
  const fitOnce = useRef(false);
  useEffect(() => { if (idsChanged) fitOnce.current = false; }, [graphData, idsChanged]);

  // ── Emphasis set (hovered or selected + neighbours) ───────────────────────
  const focusId = hoverId ?? selectedId;
  const emphasis = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const nb of neighbours.get(focusId) ?? []) set.add(nb);
    return set;
  }, [focusId, neighbours]);

  // ── Painters ──────────────────────────────────────────────────────────────
  const radiusOf = (n: GraphViewNode) =>
    TYPE_BASE_RADIUS[n.data.type] + Math.min(10, Math.sqrt(n.degree) * 1.6);

  const nodeAlpha = (n: GraphViewNode): number => {
    if (emphasis) return emphasis.has(n.id) ? 1 : 0.12;
    if (n.depth !== undefined) return n.depth === 0 ? 1 : n.depth === 1 ? 0.9 : 0.55;
    return n.data.type === 'memory' ? 0.75 : 1;
  };

  const paintNode = useCallback((node: GraphViewNode, ctx: CanvasRenderingContext2D, scale: number) => {
    if (node.x === undefined || node.y === undefined) return;
    const r = radiusOf(node);
    const color = palette.type[node.data.type];
    const alpha = nodeAlpha(node);
    const isFocus = node.id === focusId;
    const isSelected = node.id === selectedId;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(node.x, node.y);
    if (isSelected || isFocus) {
      ctx.beginPath(); ctx.arc(0, 0, r + 4 / scale + 2, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = alpha * 0.22; ctx.fill(); ctx.globalAlpha = alpha;
    }
    drawShape(ctx, TYPE_SHAPE[node.data.type], r, color, isSelected ? palette.label : undefined);
    ctx.restore();

    // Labels: hovered/selected/neighbour always; otherwise above a zoom threshold
    const wantLabel =
      (emphasis?.has(node.id) ?? false) ||
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
  }, [palette, focusId, selectedId, emphasis, showLabels]); // eslint-disable-line react-hooks/exhaustive-deps

  const paintPointerArea = useCallback((node: GraphViewNode, color: string, ctx: CanvasRenderingContext2D) => {
    if (node.x === undefined || node.y === undefined) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, radiusOf(node) + 4, 0, Math.PI * 2); // hit target larger than the mark
    ctx.fill();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const linkColor = useCallback((l: GraphViewLink) => {
    if (!emphasis) return palette.edge;
    const s = idOf(l.source); const t = idOf(l.target);
    return s === focusId || t === focusId ? palette.edgeStrong : 'rgba(0,0,0,0)';
  }, [emphasis, focusId, palette]);

  const linkWidth = useCallback((l: GraphViewLink) => {
    const s = idOf(l.source); const t = idOf(l.target);
    return focusId && (s === focusId || t === focusId) ? 1.6 : l.data.type === 'memory_entity' ? 0.6 : 1;
  }, [focusId]);

  return (
    <div ref={wrapRef} className={className} style={{ background: palette.surface }}>
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
        onNodeClick={(n) => onSelect(n.id === selectedId ? null : n.id)}
        onBackgroundClick={() => onSelect(null)}
        onNodeDragEnd={(n) => { n.fx = undefined; n.fy = undefined; }}
        warmupTicks={reducedMotion ? 300 : 0}
        cooldownTicks={reducedMotion ? 0 : 220}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.32}
        onEngineTick={flushPendingFocus}
        onEngineStop={() => {
          // A pending focus wins over the one-time fit (fitting would undo the centring).
          if (pendingFocus.current) { flushPendingFocus(); fitOnce.current = true; return; }
          if (!fitOnce.current) { fitOnce.current = true; zoomToFit(); }
        }}
        autoPauseRedraw={false}
        minZoom={0.15}
        maxZoom={8}
      />
    </div>
  );
});
