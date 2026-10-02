import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject, type LinkObject } from 'react-force-graph-2d';
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@boardroom/shared';
import {
  TYPE_BASE_RADIUS, TYPE_SHAPE, drawShape, readGraphPalette, type GraphPalette,
} from './graph-theme';

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
 */

export interface GraphViewNode extends NodeObject {
  id: string;
  data: KnowledgeGraphNode;
  degree: number;
  /** Distance from the focus node when local-graph mode is on (0 = focus) */
  depth?: number;
}

export interface GraphViewLink extends LinkObject {
  id: string;
  source: string | GraphViewNode;
  target: string | GraphViewNode;
  data: KnowledgeGraphEdge;
}

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

const idOf = (v: string | GraphViewNode | number | undefined): string =>
  typeof v === 'object' && v !== null ? String(v.id) : String(v);

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

  // ── Graph data (library mutates node objects, so build fresh copies) ──────
  const { graphData, neighbours } = useMemo(() => {
    const degree = new Map<string, number>();
    const neigh = new Map<string, Set<string>>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
      if (!neigh.has(e.source)) neigh.set(e.source, new Set());
      if (!neigh.has(e.target)) neigh.set(e.target, new Set());
      neigh.get(e.source)!.add(e.target);
      neigh.get(e.target)!.add(e.source);
    }
    const gNodes: GraphViewNode[] = nodes.map((n) => ({
      id: n.id, data: n, degree: degree.get(n.id) ?? 0, depth: depthById?.get(n.id),
    }));
    const gLinks: GraphViewLink[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e }));
    return { graphData: { nodes: gNodes, links: gLinks }, neighbours: neigh };
  }, [nodes, edges, depthById]);

  // ── Forces ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const n = graphData.nodes.length;
    fg.d3Force('charge')?.strength(n > 600 ? -40 : n > 200 ? -70 : -120).distanceMax(400);
    fg.d3Force('link')
      ?.distance((l: GraphViewLink) => (l.data.type === 'memory_entity' ? 28 : l.data.type === 'goal_hierarchy' ? 70 : 48))
      .strength((l: GraphViewLink) => (l.data.type === 'memory_entity' ? 0.6 : 0.9));
    fg.d3ReheatSimulation();
  }, [graphData]);

  // ── Imperative API ────────────────────────────────────────────────────────
  const zoomToFit = useCallback(() => fgRef.current?.zoomToFit(reducedMotion ? 0 : 500, 48), [reducedMotion]);
  useImperativeHandle(ref, () => ({
    focusNode(id, zoom = 2.2) {
      const node = graphData.nodes.find((n) => n.id === id);
      const fg = fgRef.current;
      if (!node || !fg || node.x === undefined || node.y === undefined) return;
      fg.centerAt(node.x, node.y, reducedMotion ? 0 : 400);
      fg.zoom(zoom, reducedMotion ? 0 : 400);
    },
    zoomToFit,
  }), [graphData, reducedMotion, zoomToFit]);

  const fitOnce = useRef(false);
  useEffect(() => { fitOnce.current = false; }, [graphData]);

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
        onEngineStop={() => { if (!fitOnce.current) { fitOnce.current = true; zoomToFit(); } }}
        autoPauseRedraw={false}
        minZoom={0.15}
        maxZoom={8}
      />
    </div>
  );
});
