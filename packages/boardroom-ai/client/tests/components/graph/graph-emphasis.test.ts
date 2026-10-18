import { describe, it, expect } from 'vitest';
import {
  FADE_ALPHA, SPOTLIGHT_DIM_ALPHA, TIMELINE_FADE_FACTOR, nodeAlpha, normalizeScore, spotlightRing,
} from '../../../src/components/graph/graph-emphasis';

const base = { type: 'project' as const, emphasis: null, spotlight: null, timeline: undefined };
const spot = (ids: Record<string, number>, filter = false) => ({ scores: new Map(Object.entries(ids)), max: Math.max(...Object.values(ids)), filter });

describe('graph-emphasis — nodeAlpha', () => {
  it('hits are vivid and non-hits dim while a spotlight is active', () => {
    const spotlight = spot({ hit: 0.8, other: 0.4 });
    expect(nodeAlpha({ ...base, id: 'hit', spotlight })).toBe(1);
    expect(nodeAlpha({ ...base, id: 'miss', spotlight })).toBe(SPOTLIGHT_DIM_ALPHA);
    // memories are only quieter when nothing else is going on
    expect(nodeAlpha({ ...base, id: 'm', type: 'memory' })).toBe(0.75);
    expect(nodeAlpha({ ...base, id: 'hit', type: 'memory', spotlight })).toBe(1);
  });

  it('"Filter to results" hides non-hits entirely (alpha 0) but never hits', () => {
    const spotlight = spot({ hit: 0.8 }, true);
    expect(nodeAlpha({ ...base, id: 'miss', spotlight })).toBe(0);
    expect(nodeAlpha({ ...base, id: 'hit', spotlight })).toBe(1);
    // even when hovered neighbourhood would otherwise show it
    expect(nodeAlpha({ ...base, id: 'miss', spotlight, emphasis: new Set(['miss']) })).toBe(0);
  });

  it('hover / selection emphasis takes precedence over spotlight dimming', () => {
    const spotlight = spot({ hit: 0.8 });
    const emphasis = new Set(['nb']);
    expect(nodeAlpha({ ...base, id: 'nb', spotlight, emphasis })).toBe(1);
    expect(nodeAlpha({ ...base, id: 'hit', spotlight, emphasis })).toBe(FADE_ALPHA);
  });

  it('depth rings fade with distance when nothing else applies', () => {
    expect(nodeAlpha({ ...base, id: 'a', depth: 0 })).toBe(1);
    expect(nodeAlpha({ ...base, id: 'a', depth: 1 })).toBe(0.9);
    expect(nodeAlpha({ ...base, id: 'a', depth: 2 })).toBe(0.55);
  });

  it('timeline: hidden → 0, faded multiplies the result', () => {
    expect(nodeAlpha({ ...base, id: 'a', timeline: 'hidden' })).toBe(0);
    expect(nodeAlpha({ ...base, id: 'a', timeline: 'hidden', spotlight: spot({ a: 1 }) })).toBe(0);
    expect(nodeAlpha({ ...base, id: 'a', timeline: 'faded' })).toBeCloseTo(TIMELINE_FADE_FACTOR);
    expect(nodeAlpha({ ...base, id: 'a', timeline: 'faded', spotlight: spot({ a: 1 }) })).toBeCloseTo(TIMELINE_FADE_FACTOR);
    expect(nodeAlpha({ ...base, id: 'a', timeline: 'visible' })).toBe(1);
  });
});

describe('graph-emphasis — score-scaled rings', () => {
  it('normalises against the best hit and degrades gracefully', () => {
    expect(normalizeScore(0.5, 1)).toBe(0.5);
    expect(normalizeScore(2, 1)).toBe(1);
    expect(normalizeScore(0.3, 0)).toBe(1);
    expect(normalizeScore(Number.NaN, 1)).toBe(1);
  });

  it('a better score means a bigger, brighter ring', () => {
    const top = spotlightRing(1, 1);
    const low = spotlightRing(0.2, 1);
    expect(top.radiusBonus).toBeGreaterThan(low.radiusBonus);
    expect(top.width).toBeGreaterThan(low.width);
    expect(top.alpha).toBeGreaterThan(low.alpha);
    expect(top.alpha).toBeLessThanOrEqual(1);
    expect(low.alpha).toBeGreaterThan(0.4);
  });
});
