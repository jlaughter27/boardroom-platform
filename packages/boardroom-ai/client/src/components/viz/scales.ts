/**
 * Scale and path maths for the viz primitives. Pure functions, no DOM —
 * everything here is unit-tested in isolation.
 */

export interface LinearScale {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
  invert(px: number): number;
}

/** Linear map domain → range; a degenerate domain (min === max) maps everything to range[0]. */
export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const fn = ((v: number) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0))) as LinearScale;
  fn.domain = domain;
  fn.range = range;
  fn.invert = (px: number) => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * span);
  return fn;
}

/**
 * "Nice" ticks: round step sizes (1 / 2 / 2.5 / 5 × 10^k) that cover [min,max].
 * Always includes 0 when the data sits on one side of it.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  let lo = Math.min(min, max, 0);
  let hi = Math.max(min, max, 0);
  if (lo === hi) hi = lo + 1;
  const rough = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let t = start; t <= end + step / 2; t += step) out.push(Number(t.toFixed(10)));
  return out;
}

/** Upper bound of the nice ticks — a tidy y-axis maximum. */
export function niceMax(max: number, count = 4): number {
  const ticks = niceTicks(0, max, count);
  return ticks[ticks.length - 1] || 1;
}

export interface BandScale {
  (i: number): number;
  bandwidth: number;
  step: number;
}

/** Equal bands across [r0, r1] with an inner gap (px) between them. */
export function bandScale(count: number, range: [number, number], gap = 2): BandScale {
  const [r0, r1] = range;
  const n = Math.max(1, count);
  const step = (r1 - r0) / n;
  const bandwidth = Math.max(0, step - gap);
  const fn = ((i: number) => r0 + i * step + gap / 2) as BandScale;
  fn.bandwidth = bandwidth;
  fn.step = step;
  return fn;
}

export interface Point { x: number; y: number }

const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Polyline path through the points (round joins come from stroke attrs). */
export function linePath(points: Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)},${f(p.y)}`).join(' ');
}

/** Closed area between a top polyline and a bottom polyline (bottom given left→right). */
export function areaPath(top: Point[], bottom: Point[]): string {
  if (top.length === 0 || bottom.length === 0) return '';
  const up = linePath(top);
  const down = [...bottom].reverse().map((p) => `L${f(p.x)},${f(p.y)}`).join(' ');
  return `${up} ${down} Z`;
}

/** Area from a polyline down to a flat baseline. */
export function baselineAreaPath(top: Point[], baselineY: number): string {
  if (top.length === 0) return '';
  const bottom = top.map((p) => ({ x: p.x, y: baselineY }));
  return areaPath(top, bottom);
}

/**
 * Stack series (each an array of the same length) bottom→top.
 * Returns, per series, `[y0, y1]` per index. Negative values are clamped to 0.
 */
export function stackSeries(series: number[][]): Array<Array<[number, number]>> {
  const n = series[0]?.length ?? 0;
  const base = new Array<number>(n).fill(0);
  return series.map((values) => values.map((v, i) => {
    const y0 = base[i];
    const y1 = y0 + Math.max(0, v || 0);
    base[i] = y1;
    return [y0, y1] as [number, number];
  }));
}

/**
 * A bar with 4px-rounded data-end and a square baseline edge.
 * `dir` is the growth direction: 'right' (horizontal bars) or 'up' (columns).
 */
export function roundedBarPath(x: number, y: number, w: number, h: number, dir: 'right' | 'up' = 'right', radius = 4): string {
  if (w <= 0 || h <= 0) return '';
  if (dir === 'right') {
    const r = Math.min(radius, h / 2, w);
    return `M${f(x)},${f(y)} H${f(x + w - r)} Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)} V${f(y + h - r)} Q${f(x + w)},${f(y + h)} ${f(x + w - r)},${f(y + h)} H${f(x)} Z`;
  }
  const r = Math.min(radius, w / 2, h);
  return `M${f(x)},${f(y + h)} V${f(y + r)} Q${f(x)},${f(y)} ${f(x + r)},${f(y)} H${f(x + w - r)} Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)} V${f(y + h)} Z`;
}

/** Index of the point whose x is nearest to `px`. */
export function nearestIndex(xs: number[], px: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i] - px);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** sqrt-area scale for bubbles: count → radius in [rMin, rMax]. */
export function bubbleRadius(count: number, maxCount: number, rMin = 4, rMax = 14): number {
  if (!(count > 0) || !(maxCount > 0)) return rMin;
  return rMin + (rMax - rMin) * Math.sqrt(Math.min(1, count / maxCount));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 1,284 → "1.3K", 12_900_000 → "12.9M", 950 → "950". */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return Number.isInteger(n) ? String(n) : trim(n);
}

function trim(n: number): string {
  const s = Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1);
  return s.replace(/\.0$/, '');
}

/** $0.00 under $10, $12.3 under $100, $120 above. */
export function formatUsd(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

export function formatPct(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)} %`;
}

/** Signed delta string, e.g. "+12 %", "−3", "0". */
export function formatDelta(v: number, suffix = ''): string {
  if (!Number.isFinite(v) || v === 0) return `0${suffix}`;
  const sign = v > 0 ? '+' : '−';
  return `${sign}${formatCompact(Math.abs(v))}${suffix}`;
}
