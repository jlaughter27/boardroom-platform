import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { KnowledgeGraphNodeType } from '@boardroom/shared';
import { cn } from '../../lib/cn';

/**
 * Corner minimap: every positioned node as a dot plus the current viewport
 * rectangle; click (or drag) to pan the main view there. The view drives it
 * imperatively from its render loop (`ref.current.draw(...)`) so the minimap
 * never causes a React render per frame. The maths is exported and pure.
 */

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface MinimapTransform {
  /** graph units → minimap px */
  k: number;
  tx: number;
  ty: number;
}

export interface MinimapNode { x: number; y: number; type: KnowledgeGraphNodeType; alpha: number }

/** Graph-space rectangle currently on screen. */
export interface ViewportRect { x: number; y: number; width: number; height: number }

export function boundsOf(points: ReadonlyArray<{ x: number; y: number }>): Bounds | null {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Fit `bounds` into a `width × height` box with `pad` px margin, preserving aspect and centring. */
export function minimapTransform(bounds: Bounds, width: number, height: number, pad = 8): MinimapTransform {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const k = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  const tx = (width - bw * k) / 2 - bounds.minX * k;
  const ty = (height - bh * k) / 2 - bounds.minY * k;
  return { k, tx, ty };
}

export function toMinimap(t: MinimapTransform, x: number, y: number): { x: number; y: number } {
  return { x: x * t.k + t.tx, y: y * t.k + t.ty };
}

export function fromMinimap(t: MinimapTransform, px: number, py: number): { x: number; y: number } {
  return { x: (px - t.tx) / t.k, y: (py - t.ty) / t.k };
}

/**
 * Viewport rectangle in graph space from the main view's transform
 * (`k`, `x`, `y` as d3-zoom reports them) and the canvas size in CSS px.
 */
export function viewportRect(zoom: { k: number; x: number; y: number }, width: number, height: number): ViewportRect {
  return { x: -zoom.x / zoom.k, y: -zoom.y / zoom.k, width: width / zoom.k, height: height / zoom.k };
}

export interface FitInsets { top: number; right: number; bottom: number; left: number }

/**
 * Zoom + centre that fits `bounds` into the canvas minus `insets` (asymmetric,
 * so a taller top inset can hold the first row of community labels). Returns
 * the point to `centerAt` and the zoom `k`, clamped to [min, max].
 */
export function fitTransform(bounds: Bounds, width: number, height: number, insets: FitInsets, limits: { min: number; max: number } = { min: 0.15, max: 8 }): { k: number; cx: number; cy: number } {
  const aw = Math.max(1, width - insets.left - insets.right);
  const ah = Math.max(1, height - insets.top - insets.bottom);
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const k = Math.max(limits.min, Math.min(limits.max, Math.min(aw / bw, ah / bh)));
  const bcx = (bounds.minX + bounds.maxX) / 2; const bcy = (bounds.minY + bounds.maxY) / 2;
  const sx0 = insets.left + aw / 2; const sy0 = insets.top + ah / 2; // where the bounds centre should land on screen
  return { k, cx: bcx + (width / 2 - sx0) / k, cy: bcy + (height / 2 - sy0) / k };
}

export interface MinimapHandle {
  draw(nodes: readonly MinimapNode[], viewport: ViewportRect | null): void;
}

interface Props {
  width?: number;
  height?: number;
  colors: Record<KnowledgeGraphNodeType, string>;
  surface: string;
  frame: string;
  /** Pan the main view so that graph point (x, y) is centred. */
  onJump(x: number, y: number): void;
  className?: string;
}

export const GraphMinimap = forwardRef<MinimapHandle, Props>(function GraphMinimap({ width = 168, height = 112, colors, surface, frame, onJump, className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<MinimapTransform | null>(null);
  const dragging = useRef(false);

  useImperativeHandle(ref, () => ({
    draw(nodes, viewport) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const b = boundsOf(nodes);
      if (!b) { transformRef.current = null; return; }
      // Include the viewport in the bounds so the rectangle never leaves the map
      const all: Bounds = viewport
        ? { minX: Math.min(b.minX, viewport.x), minY: Math.min(b.minY, viewport.y), maxX: Math.max(b.maxX, viewport.x + viewport.width), maxY: Math.max(b.maxY, viewport.y + viewport.height) }
        : b;
      const t = minimapTransform(all, width, height, 8);
      transformRef.current = t;
      for (const n of nodes) {
        if (n.alpha <= 0) continue;
        const p = toMinimap(t, n.x, n.y);
        ctx.globalAlpha = Math.max(0.25, n.alpha);
        ctx.fillStyle = colors[n.type];
        ctx.beginPath(); ctx.arc(p.x, p.y, n.type === 'memory' ? 0.9 : 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (viewport) {
        const a = toMinimap(t, viewport.x, viewport.y);
        const w = viewport.width * t.k; const h = viewport.height * t.k;
        ctx.save();
        // Dim everything outside the viewport, then outline it
        ctx.fillStyle = surface; ctx.globalAlpha = 0.45;
        ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.rect(a.x, a.y, w, h); ctx.fill('evenodd');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = frame; ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.max(4, Math.round(w)), Math.max(4, Math.round(h)));
        ctx.restore();
      }
    },
  }), [width, height, colors, surface, frame]);

  const jump = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = transformRef.current;
    if (!t) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = fromMinimap(t, e.clientX - r.left, e.clientY - r.top);
    onJump(p.x, p.y);
  };

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Graph overview — click to pan"
      data-testid="graph-minimap"
      width={width}
      height={height}
      style={{ width, height }}
      className={cn('cursor-crosshair rounded-md', className)}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); jump(e); }}
      onPointerMove={(e) => { if (dragging.current) jump(e); }}
      onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { dragging.current = false; }}
    />
  );
});
