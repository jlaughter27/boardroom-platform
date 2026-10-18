import type { KnowledgeGraphNodeType } from '@boardroom/shared';
import type { TimelineVisibility } from './graph-timeline';

/**
 * One place that decides how vivid a node is painted. Pure so the policy can
 * be tested without a canvas. Precedence, strongest first:
 *
 *   1. hidden by the timeline, or filtered out by "Filter to results"  → 0
 *   2. hover / selection neighbourhood                                 → 1 vs 0.12
 *   3. spotlight (search hits)                                         → 1 vs 0.15
 *   4. local-graph depth ring                                          → 1 / 0.9 / 0.55
 *   5. base (memories a touch quieter)                                 → 0.75 / 1
 *
 * A timeline *fade* multiplies whatever the rules above produced.
 */

export interface SpotlightState {
  /** nodeId → raw relevance score */
  scores: ReadonlyMap<string, number>;
  /** Highest score in the set (so rings can be scaled) */
  max: number;
  /** Hide non-hits instead of fading them */
  filter: boolean;
}

export interface AlphaInput {
  id: string;
  type: KnowledgeGraphNodeType;
  depth?: number;
  emphasis: ReadonlySet<string> | null;
  spotlight: SpotlightState | null;
  timeline: TimelineVisibility | undefined;
}

export const FADE_ALPHA = 0.12;
export const SPOTLIGHT_DIM_ALPHA = 0.15;
export const TIMELINE_FADE_FACTOR = 0.25;

export function nodeAlpha(i: AlphaInput): number {
  if (i.timeline === 'hidden') return 0;
  const isHit = i.spotlight?.scores.has(i.id) ?? false;
  if (i.spotlight?.filter && !isHit) return 0;

  let a: number;
  if (i.emphasis) a = i.emphasis.has(i.id) ? 1 : FADE_ALPHA;
  else if (i.spotlight && i.spotlight.scores.size > 0) a = isHit ? 1 : SPOTLIGHT_DIM_ALPHA;
  else if (i.depth !== undefined) a = i.depth === 0 ? 1 : i.depth === 1 ? 0.9 : 0.55;
  else a = i.type === 'memory' ? 0.75 : 1;

  if (i.timeline === 'faded') a *= TIMELINE_FADE_FACTOR;
  return a;
}

/** 0..1 position of `score` inside the hit set (1 = best hit). Single-hit sets score 1. */
export function normalizeScore(score: number, max: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return 1;
  return Math.max(0, Math.min(1, score / max));
}

export interface SpotlightRing {
  /** Extra radius beyond the node mark, in graph units at zoom 1 */
  radiusBonus: number;
  /** Stroke width in graph units at zoom 1 */
  width: number;
  /** Ring opacity */
  alpha: number;
}

/** Score-scaled ring: the best hit gets the widest, brightest ring. */
export function spotlightRing(score: number, max: number): SpotlightRing {
  const t = normalizeScore(score, max);
  return {
    radiusBonus: 3 + 5 * t,
    width: 1.2 + 1.8 * t,
    alpha: 0.45 + 0.55 * t,
  };
}
