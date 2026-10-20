/**
 * Community hull geometry — pure functions over points so the blob outlines
 * can be unit-tested without a canvas.
 *
 * A hull is: convex hull of the member positions (monotone chain) → offset
 * outward by `pad` → smoothed into a closed quadratic curve through edge
 * midpoints (the "bubble" look). Communities of one or two nodes are drawn
 * as a disc / capsule by hulling a ring of points around each member.
 */

export interface Pt { x: number; y: number }

/** Andrew's monotone chain. Returns the hull counter-clockwise, no repeated end point. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const pts = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

export function centroid(points: readonly Pt[]): Pt {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0; let y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

/** Shoelace area (absolute). */
export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]; const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Offset a convex polygon outward by `pad`: each vertex moves along the
 * bisector of its two edge normals, mitre-limited to 2·pad so sharp corners
 * do not spike.
 */
export function padPolygon(poly: readonly Pt[], pad: number): Pt[] {
  const n = poly.length;
  if (n === 0) return [];
  if (n === 1) return [{ ...poly[0] }];
  const c = centroid(poly);
  if (n === 2) {
    // A segment: push both ends away from the centre and sideways
    return poly.map((p) => {
      const dx = p.x - c.x; const dy = p.y - c.y; const l = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / l) * pad, y: p.y + (dy / l) * pad };
    });
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n]; const cur = poly[i]; const next = poly[(i + 1) % n];
    const n1 = edgeNormal(prev, cur, c); const n2 = edgeNormal(cur, next, c);
    let bx = n1.x + n2.x; let by = n1.y + n2.y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-6) { bx = n1.x; by = n1.y; } else { bx /= bl; by /= bl; }
    const cosHalf = Math.max(0.5, bx * n1.x + by * n1.y); // mitre limit 2·pad
    const d = pad / cosHalf;
    out.push({ x: cur.x + bx * d, y: cur.y + by * d });
  }
  return out;
}

function edgeNormal(a: Pt, b: Pt, inside: Pt): Pt {
  const ex = b.x - a.x; const ey = b.y - a.y; const l = Math.hypot(ex, ey) || 1;
  let nx = ey / l; let ny = -ex / l;
  // orient away from the polygon centre
  const mx = (a.x + b.x) / 2 - inside.x; const my = (a.y + b.y) / 2 - inside.y;
  if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
  return { x: nx, y: ny };
}

export interface CurveSegment { cx: number; cy: number; x: number; y: number }

export interface RoundedPath {
  /** Start point (midpoint of the first edge) */
  start: Pt;
  /** Quadratic segments: control point = polygon vertex, end = next edge midpoint */
  segments: CurveSegment[];
}

/** Smooth a closed polygon into quadratic curves through consecutive edge midpoints. */
export function roundedPath(poly: readonly Pt[]): RoundedPath | null {
  const n = poly.length;
  if (n < 3) return null;
  const mid = (i: number): Pt => {
    const a = poly[i % n]; const b = poly[(i + 1) % n];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const segments: CurveSegment[] = [];
  for (let i = 1; i <= n; i++) {
    const v = poly[i % n]; const m = mid(i);
    segments.push({ cx: v.x, cy: v.y, x: m.x, y: m.y });
  }
  return { start: mid(0), segments };
}

export type HullOutline =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'path'; polygon: Pt[]; path: RoundedPath };

const RING_STEPS = 10;

/**
 * Outline for a set of member positions padded by `pad`. One member → disc;
 * two members → capsule-like hull; three or more → padded, smoothed hull.
 */
export function hullOutline(points: readonly Pt[], pad: number): HullOutline | null {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return null;
  if (pts.length === 1) return { kind: 'circle', cx: pts[0].x, cy: pts[0].y, r: pad };
  let base: Pt[];
  if (pts.length === 2) {
    const ring: Pt[] = [];
    for (const p of pts) {
      for (let i = 0; i < RING_STEPS; i++) {
        const a = (Math.PI * 2 * i) / RING_STEPS;
        ring.push({ x: p.x + Math.cos(a) * pad, y: p.y + Math.sin(a) * pad });
      }
    }
    base = convexHull(ring);
  } else {
    const hull = convexHull(pts);
    if (hull.length < 3) return hullOutline(hull, pad);
    base = padPolygon(hull, pad);
  }
  const path = roundedPath(base);
  if (!path) return null;
  return { kind: 'path', polygon: base, path };
}

/** Trace an outline onto an already-transformed context (no fill / stroke). */
export function traceHull(ctx: CanvasRenderingContext2D, outline: HullOutline): void {
  ctx.beginPath();
  if (outline.kind === 'circle') { ctx.arc(outline.cx, outline.cy, outline.r, 0, Math.PI * 2); return; }
  ctx.moveTo(outline.path.start.x, outline.path.start.y);
  for (const s of outline.path.segments) ctx.quadraticCurveTo(s.cx, s.cy, s.x, s.y);
  ctx.closePath();
}

export interface OutlineExtent { minX: number; maxX: number; minY: number; maxY: number; cx: number; cy: number }

/**
 * Bounding extent of the RENDERED outline. The smoothed curve runs through
 * edge midpoints, so it sits inside the padded polygon by up to the pad; the
 * extent samples each quadratic segment so the top edge is where the eye
 * sees it, not where the control polygon is.
 */
export function outlineExtent(outline: HullOutline): OutlineExtent {
  if (outline.kind === 'circle') {
    return { minX: outline.cx - outline.r, maxX: outline.cx + outline.r, minY: outline.cy - outline.r, maxY: outline.cy + outline.r, cx: outline.cx, cy: outline.cy };
  }
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity; let sx = 0; let sy = 0; let n = 0;
  let prev = outline.path.start;
  const take = (x: number, y: number) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    sx += x; sy += y; n += 1;
  };
  for (const seg of outline.path.segments) {
    for (let i = 1; i <= 4; i++) {
      const t = i / 4; const u = 1 - t;
      take(u * u * prev.x + 2 * u * t * seg.cx + t * t * seg.x, u * u * prev.y + 2 * u * t * seg.cy + t * t * seg.y);
    }
    prev = { x: seg.x, y: seg.y };
  }
  return { minX, maxX, minY, maxY, cx: sx / Math.max(1, n), cy: sy / Math.max(1, n) };
}

/** Where a community's label hangs from: the outline's own centroid x and its visible top edge. */
export function labelAnchor(outline: HullOutline, inset = 0): Pt {
  const e = outlineExtent(outline);
  return { x: e.cx, y: e.minY + inset };
}

/** Point-in-outline test on the (padded) polygon — used for hover over hull labels. */
export function pointInOutline(outline: HullOutline, p: Pt): boolean {
  if (outline.kind === 'circle') return Math.hypot(p.x - outline.cx, p.y - outline.cy) <= outline.r;
  const poly = outline.polygon;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
