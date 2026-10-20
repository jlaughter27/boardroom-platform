import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@boardroom/shared';

/**
 * Timeline scrubber helpers — pure and deterministic (UTC everywhere) so the
 * page can be driven by tests without a clock.
 *
 * Every node has `createdAt`. Memory nodes may additionally carry
 * `meta.validAt` / `meta.invalidAt` (bi-temporal validity) when the server
 * includes them; when they do not, `createdAt` stands in for `validAt` and a
 * SUPERSEDED / ARCHIVED memory counts as invalidated at an unknown time.
 */

export interface TimeWindow {
  /** Inclusive, epoch ms */
  start: number;
  /** Inclusive, epoch ms */
  end: number;
}

export interface TimeExtent {
  min: number;
  max: number;
}

export type TimelineVisibility = 'visible' | 'faded' | 'hidden';

export interface WeekBucket {
  /** Monday 00:00 UTC */
  start: number;
  /** Next Monday 00:00 UTC (exclusive) */
  end: number;
  count: number;
}

export interface TimelineResult {
  nodeVisibility: Map<string, TimelineVisibility>;
  edgeVisibility: Map<string, TimelineVisibility>;
  /** Memories whose validity ended on or before the window end */
  hollow: Set<string>;
  /** Nodes inside the window */
  inWindow: number;
}

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

function parseMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

/** Point in time a node "starts": `meta.validAt` for memories when present, else `createdAt`. */
export function nodeTime(n: KnowledgeGraphNode): number | null {
  return parseMs(n.meta?.validAt) ?? parseMs(n.createdAt);
}

/** When a memory stopped being valid, if the payload says so. */
export function nodeInvalidAt(n: KnowledgeGraphNode): number | null {
  return parseMs(n.meta?.invalidAt);
}

/** True when the node is a memory that has been invalidated by `atMs` (or at an unknown time). */
export function isHollowAt(n: KnowledgeGraphNode, atMs: number): boolean {
  if (n.type !== 'memory') return false;
  const inv = nodeInvalidAt(n);
  if (inv !== null) return inv <= atMs;
  return n.status === 'SUPERSEDED' || n.status === 'ARCHIVED';
}

export function timeExtent(nodes: readonly KnowledgeGraphNode[]): TimeExtent | null {
  let min = Infinity; let max = -Infinity;
  for (const n of nodes) {
    const t = nodeTime(n);
    if (t === null) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min)) return null;
  return { min, max };
}

/** Monday 00:00:00 UTC of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0 = Sunday
  const back = (day + 6) % 7; // days since Monday
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back);
}

/** Node counts per ISO week across the extent (empty weeks included, so bars line up). */
export function weekHistogram(nodes: readonly KnowledgeGraphNode[], extent: TimeExtent | null = timeExtent(nodes)): WeekBucket[] {
  if (!extent) return [];
  const first = weekStart(extent.min);
  const last = weekStart(extent.max);
  const buckets: WeekBucket[] = [];
  for (let s = first; s <= last; s += WEEK_MS) buckets.push({ start: s, end: s + WEEK_MS, count: 0 });
  for (const n of nodes) {
    const t = nodeTime(n);
    if (t === null) continue;
    const i = Math.floor((weekStart(t) - first) / WEEK_MS);
    if (buckets[i]) buckets[i].count += 1;
  }
  return buckets;
}

export function clampWindow(w: TimeWindow, extent: TimeExtent): TimeWindow {
  const start = Math.min(Math.max(w.start, extent.min), extent.max);
  const end = Math.min(Math.max(w.end, start), extent.max);
  return { start, end };
}

export function isFullWindow(w: TimeWindow | null, extent: TimeExtent | null): boolean {
  if (!w || !extent) return true;
  return w.start <= extent.min && w.end >= extent.max;
}

export function nodeVisibility(n: KnowledgeGraphNode, w: TimeWindow, hideOutside: boolean): TimelineVisibility {
  const t = nodeTime(n);
  if (t === null) return 'visible'; // undated: never punished
  if (t >= w.start && t <= w.end) return 'visible';
  return hideOutside ? 'hidden' : 'faded';
}

/**
 * Apply a window to the loaded graph. Edges follow their endpoints: hidden
 * if either end is hidden, faded if either end is faded.
 */
export function applyTimeline(
  nodes: readonly KnowledgeGraphNode[],
  edges: readonly KnowledgeGraphEdge[],
  w: TimeWindow,
  hideOutside: boolean,
): TimelineResult {
  const nodeVis = new Map<string, TimelineVisibility>();
  const hollow = new Set<string>();
  let inWindow = 0;
  for (const n of nodes) {
    const v = nodeVisibility(n, w, hideOutside);
    nodeVis.set(n.id, v);
    if (v === 'visible') inWindow += 1;
    if (isHollowAt(n, w.end)) hollow.add(n.id);
  }
  const edgeVis = new Map<string, TimelineVisibility>();
  for (const e of edges) {
    const a = nodeVis.get(e.source) ?? 'visible';
    const b = nodeVis.get(e.target) ?? 'visible';
    edgeVis.set(e.id, a === 'hidden' || b === 'hidden' ? 'hidden' : a === 'faded' || b === 'faded' ? 'faded' : 'visible');
  }
  return { nodeVisibility: nodeVis, edgeVisibility: edgeVis, hollow, inWindow };
}

/**
 * Advance the window end by `stepMs` (start stays put so the graph "grows").
 * `done` is true once the end has reached the extent's max.
 */
export function stepWindow(w: TimeWindow, extent: TimeExtent, stepMs: number): { window: TimeWindow; done: boolean } {
  const end = Math.min(extent.max, w.end + Math.max(1, stepMs));
  return { window: { start: w.start, end }, done: end >= extent.max };
}

/** Step per tick for a given speed. Reduced motion jumps a whole week per tick instead of a smooth sweep. */
export function playbackStep(extent: TimeExtent, speed: number, reducedMotion: boolean): number {
  if (reducedMotion) return WEEK_MS * Math.max(1, speed);
  const span = Math.max(DAY_MS, extent.max - extent.min);
  return (span / 240) * Math.max(0.25, speed);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Aug 2026" in UTC — stable across machines and locales. */
export function formatDay(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `YYYY-MM-DD` (UTC) for native date inputs. */
export function toDateInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse a `YYYY-MM-DD` input into UTC midnight ms, or null. */
export function fromDateInputValue(v: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const ms = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}
