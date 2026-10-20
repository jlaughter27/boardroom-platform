import type { KnowledgeGraphNodeType } from '@boardroom/shared';

/**
 * Semantic zoom + label placement — pure so the policy is unit-testable.
 *
 * Three zoom tiers decide WHICH nodes want a label:
 *   far  (scale < TIER_FAR_MAX)  → community labels + hub nodes only
 *   mid  (scale < TIER_MID_MAX)  → + every entity (non-memory) label
 *   near (otherwise)             → + memory labels
 * Hover / selection / spotlight hits are "forced": they always want one.
 *
 * `placeLabels` then runs a greedy collision pass in screen space: forced
 * labels are placed first and never dropped; the rest are placed in priority
 * order and skipped when their box overlaps an already-placed one. A uniform
 * grid keeps the pass linear-ish for ≤ 400 candidates per frame.
 */

export type ZoomTier = 'far' | 'mid' | 'near';

export const TIER_FAR_MAX = 1.05;
export const TIER_MID_MAX = 2.1;
/** Top share of nodes (by degree) that count as hubs. */
export const HUB_FRACTION = 0.08;

export function zoomTier(scale: number): ZoomTier {
  if (!Number.isFinite(scale) || scale < TIER_FAR_MAX) return 'far';
  if (scale < TIER_MID_MAX) return 'mid';
  return 'near';
}

/** Degree at or above which a node is a hub: the top HUB_FRACTION of degrees (at least one node), never below 2. */
export function hubThreshold(degrees: readonly number[]): number {
  if (degrees.length === 0) return Infinity;
  const sorted = [...degrees].sort((a, b) => b - a);
  const count = Math.max(1, Math.round(sorted.length * HUB_FRACTION));
  return Math.max(2, sorted[Math.min(count, sorted.length) - 1]);
}

export interface WantsLabelInput {
  type: KnowledgeGraphNodeType;
  degree: number;
  hubDegree: number;
  tier: ZoomTier;
  /** hovered / selected / neighbour-of-focus / spotlight hit */
  forced: boolean;
  showLabels: boolean;
}

export function wantsLabel(i: WantsLabelInput): boolean {
  if (i.forced) return true;
  if (!i.showLabels) return false;
  const hub = i.degree >= i.hubDegree;
  switch (i.tier) {
    case 'far': return hub;
    case 'mid': return hub || i.type !== 'memory';
    default: return true;
  }
}

const TYPE_WEIGHT: Record<KnowledgeGraphNodeType, number> = {
  goal: 60, project: 50, person: 40, decision: 30, task: 20, commitment: 20, memory: 0,
};

export interface PriorityInput {
  type: KnowledgeGraphNodeType;
  degree: number;
  forced: boolean;
  isFocus: boolean;
  isHit: boolean;
}

/** Higher wins a contested spot. Focus > hits > forced neighbours > hubs by degree + type weight. */
export function labelPriority(i: PriorityInput): number {
  let p = TYPE_WEIGHT[i.type] + Math.min(200, i.degree * 4);
  if (i.forced) p += 1000;
  if (i.isHit) p += 2000;
  if (i.isFocus) p += 4000;
  return p;
}

export interface LabelBox {
  id: string;
  /** Screen-space box (px) */
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
  forced?: boolean;
}

/** Cheap width estimate for sans text (no canvas needed): ~0.6 em per mixed-case glyph + halo padding. */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.6 + 8;
}

function overlaps(a: LabelBox, b: LabelBox, pad: number): boolean {
  return a.x - pad < b.x + b.width && a.x + a.width + pad > b.x && a.y - pad < b.y + b.height && a.y + a.height + pad > b.y;
}

/**
 * Greedy placement. Returns the ids whose boxes survive. Forced boxes are
 * always kept (they may overlap each other — a hovered neighbourhood is
 * allowed to be dense); non-forced boxes are dropped on any overlap.
 */
export function placeLabels(boxes: readonly LabelBox[], options: { padding?: number; cell?: number } = {}): Set<string> {
  const pad = options.padding ?? 2;
  const cell = options.cell ?? 64;
  const sorted = [...boxes].sort((a, b) => (Number(b.forced) - Number(a.forced)) || b.priority - a.priority);
  const kept = new Set<string>();
  const grid = new Map<string, LabelBox[]>();
  const cellsOf = (b: LabelBox): string[] => {
    const x0 = Math.floor((b.x - pad) / cell); const x1 = Math.floor((b.x + b.width + pad) / cell);
    const y0 = Math.floor((b.y - pad) / cell); const y1 = Math.floor((b.y + b.height + pad) / cell);
    const keys: string[] = [];
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) keys.push(`${cx}:${cy}`);
    return keys;
  };
  for (const b of sorted) {
    const keys = cellsOf(b);
    if (!b.forced) {
      let collides = false;
      outer: for (const k of keys) {
        for (const other of grid.get(k) ?? []) {
          if (overlaps(b, other, pad)) { collides = true; break outer; }
        }
      }
      if (collides) continue;
    }
    kept.add(b.id);
    for (const k of keys) {
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(b);
    }
  }
  return kept;
}

/** Community labels: fully visible when zoomed out, gone once entity labels take over. */
export const COMMUNITY_LABEL_FADE_START = 0.9;
export const COMMUNITY_LABEL_FADE_END = 1.9;

export function communityLabelAlpha(scale: number): number {
  if (!Number.isFinite(scale) || scale <= COMMUNITY_LABEL_FADE_START) return 1;
  if (scale >= COMMUNITY_LABEL_FADE_END) return 0;
  const t = (scale - COMMUNITY_LABEL_FADE_START) / (COMMUNITY_LABEL_FADE_END - COMMUNITY_LABEL_FADE_START);
  return 1 - t * t * (3 - 2 * t); // smoothstep
}

/** Node label font size in screen px: hubs a touch larger, clamped. */
export function labelFontPx(degree: number, forced: boolean): number {
  return Math.max(10, Math.min(13.5, 10.5 + degree * 0.18)) + (forced ? 0.5 : 0);
}

export function truncateLabel(label: string, max = 40): string {
  return label.length > max + 2 ? `${label.slice(0, max)}…` : label;
}

/** Hull fill / stroke multiplier: full when zoomed out, quiet once you are inside a community. */
export const HULL_FADE_START = 1.3;
export const HULL_FADE_END = 2.6;
export function hullAlphaFactor(scale: number): number {
  if (!Number.isFinite(scale) || scale <= HULL_FADE_START) return 1;
  if (scale >= HULL_FADE_END) return 0.3;
  const t = (scale - HULL_FADE_START) / (HULL_FADE_END - HULL_FADE_START);
  return 1 - 0.7 * (t * t * (3 - 2 * t));
}

export interface AnchoredLabel {
  id: string;
  /** Preferred screen-space box (x, y = top-left) — the anchor position */
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
  /** How far the box may slide sideways in px (default: 1.5× its width, at least 96) */
  maxShift?: number;
}

export interface AnchoredPlacement { x: number; y: number; shifted: boolean }

function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, pad: number): boolean {
  return a.x - pad < b.x + b.width && a.x + a.width + pad > b.x && a.y - pad < b.y + b.height && a.y + a.height + pad > b.y;
}

/**
 * Place labels that belong to a specific anchor (community labels hang from
 * their hull's top edge). Resolution order per label, highest priority first:
 * the anchor itself, then sideways nudges (±step, ±2·step … up to maxShift),
 * then the same series ONE line (+ padding) down, into the hull edge. Never upward. A
 * label that finds no free spot is dropped. `blockers` are already-placed
 * boxes to avoid; `bounds.width` keeps boxes on screen.
 */
export function placeAnchoredLabels(
  labels: readonly AnchoredLabel[],
  blockers: ReadonlyArray<{ x: number; y: number; width: number; height: number }> = [],
  options: { padding?: number; step?: number; lineHeight?: number; bounds?: { width: number } } = {},
): Map<string, AnchoredPlacement> {
  const pad = options.padding ?? 3;
  const step = options.step ?? 24;
  const placed: Array<{ x: number; y: number; width: number; height: number }> = [...blockers];
  const out = new Map<string, AnchoredPlacement>();
  const sorted = [...labels].sort((a, b) => b.priority - a.priority);
  for (const l of sorted) {
    const lineHeight = options.lineHeight ?? l.height;
    const maxShift = l.maxShift ?? Math.max(l.width * 1.5, 96); // a label may slide well along its hull's top edge
    const minX = 8; const maxX = options.bounds ? options.bounds.width - l.width - 8 : Infinity;
    const shifts: number[] = [0];
    for (let d = step; d <= maxShift; d += step) shifts.push(d, -d);
    let chosen: AnchoredPlacement | null = null;
    rows: for (const dy of [0, lineHeight + pad]) {
      for (const dx of shifts) {
        const x = Math.max(minX, Math.min(maxX, l.x + dx));
        const box = { x, y: l.y + dy, width: l.width, height: l.height };
        if (placed.some((p) => boxesOverlap(box, p, pad))) continue;
        chosen = { x, y: box.y, shifted: dx !== 0 || dy !== 0 };
        break rows;
      }
    }
    if (!chosen) continue;
    placed.push({ x: chosen.x, y: chosen.y, width: l.width, height: l.height });
    out.set(l.id, chosen);
  }
  return out;
}

/**
 * Collapse spotlight hits that would print the same (truncated) text: the
 * highest-priority hit keeps the label and carries the group's count, the
 * rest are suppressed. Returns id → count for the survivors only.
 */
export function dedupeHitLabels(hits: ReadonlyArray<{ id: string; key: string; priority: number }>): Map<string, number> {
  const best = new Map<string, { id: string; priority: number; count: number }>();
  for (const h of hits) {
    const cur = best.get(h.key);
    if (!cur) best.set(h.key, { id: h.id, priority: h.priority, count: 1 });
    else { cur.count += 1; if (h.priority > cur.priority) { cur.id = h.id; cur.priority = h.priority; } }
  }
  const out = new Map<string, number>();
  for (const b of best.values()) out.set(b.id, b.count);
  return out;
}

/** Label text with the duplicate badge: "Founders churn when… ×4". */
export function badgeLabel(text: string, count: number): string {
  return count > 1 ? `${text} ×${count}` : text;
}
