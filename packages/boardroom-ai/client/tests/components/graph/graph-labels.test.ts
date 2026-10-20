import { describe, it, expect } from 'vitest';
import {
  TIER_FAR_MAX, TIER_MID_MAX, badgeLabel, communityLabelAlpha, dedupeHitLabels, hullAlphaFactor, placeAnchoredLabels, estimateTextWidth, hubThreshold, labelFontPx, labelPriority, placeLabels, truncateLabel, wantsLabel, zoomTier,
} from '../../../src/components/graph/graph-labels';

describe('graph-labels — zoom tiers', () => {
  it('maps scale to far / mid / near at the documented thresholds', () => {
    expect(zoomTier(0.3)).toBe('far');
    expect(zoomTier(TIER_FAR_MAX - 0.01)).toBe('far');
    expect(zoomTier(TIER_FAR_MAX)).toBe('mid');
    expect(zoomTier(TIER_MID_MAX - 0.01)).toBe('mid');
    expect(zoomTier(TIER_MID_MAX)).toBe('near');
    expect(zoomTier(NaN)).toBe('far');
  });

  it('hub threshold is the top 8% by degree, at least one node, never below 2', () => {
    const degrees = Array.from({ length: 100 }, (_, i) => i); // 0..99
    expect(hubThreshold(degrees)).toBe(92); // 8 hubs: 92..99
    expect(hubThreshold([1, 1, 1])).toBe(2);
    expect(hubThreshold([])).toBe(Infinity);
  });

  it('far shows hubs only, mid adds entities, near adds memories; forced always wins; labels off hides all but forced', () => {
    const base = { degree: 1, hubDegree: 5, forced: false, showLabels: true } as const;
    expect(wantsLabel({ ...base, type: 'project', tier: 'far' })).toBe(false);
    expect(wantsLabel({ ...base, type: 'project', tier: 'far', degree: 5 })).toBe(true);
    expect(wantsLabel({ ...base, type: 'project', tier: 'mid' })).toBe(true);
    expect(wantsLabel({ ...base, type: 'memory', tier: 'mid' })).toBe(false);
    expect(wantsLabel({ ...base, type: 'memory', tier: 'mid', degree: 9 })).toBe(true);
    expect(wantsLabel({ ...base, type: 'memory', tier: 'near' })).toBe(true);
    expect(wantsLabel({ ...base, type: 'memory', tier: 'far', forced: true })).toBe(true);
    expect(wantsLabel({ ...base, type: 'project', tier: 'near', showLabels: false })).toBe(false);
    expect(wantsLabel({ ...base, type: 'project', tier: 'near', showLabels: false, forced: true })).toBe(true);
  });

  it('priority orders focus > hit > forced > hubs by degree and type', () => {
    const p = (o: Partial<Parameters<typeof labelPriority>[0]>) => labelPriority({ type: 'task', degree: 0, forced: false, isFocus: false, isHit: false, ...o });
    expect(p({ isFocus: true })).toBeGreaterThan(p({ isHit: true }));
    expect(p({ isHit: true })).toBeGreaterThan(p({ forced: true }));
    expect(p({ forced: true })).toBeGreaterThan(p({ degree: 50, type: 'goal' }));
    expect(p({ type: 'goal' })).toBeGreaterThan(p({ type: 'memory' }));
    expect(p({ degree: 10 })).toBeGreaterThan(p({ degree: 2 }));
  });
});

describe('graph-labels — collision placement', () => {
  const box = (id: string, x: number, y: number, priority: number, forced = false) => ({ id, x, y, width: 60, height: 14, priority, forced });

  it('keeps the higher-priority label of an overlapping pair and both of a disjoint pair', () => {
    const kept = placeLabels([box('low', 0, 0, 1), box('high', 10, 4, 5), box('far', 200, 200, 0)]);
    expect(kept.has('high')).toBe(true);
    expect(kept.has('low')).toBe(false);
    expect(kept.has('far')).toBe(true);
  });

  it('forced labels are never dropped, even when they overlap each other or a higher-priority box', () => {
    const kept = placeLabels([box('a', 0, 0, 100), box('f1', 5, 5, 1, true), box('f2', 8, 8, 1, true)]);
    expect(kept.has('f1')).toBe(true);
    expect(kept.has('f2')).toBe(true);
    expect(kept.has('a')).toBe(false); // collides with the forced ones
  });

  it('respects padding and works across grid cells', () => {
    expect(placeLabels([box('a', 0, 0, 2), box('b', 61, 0, 1)], { padding: 0 }).size).toBe(2);
    expect(placeLabels([box('a', 0, 0, 2), box('b', 61, 0, 1)], { padding: 4 }).size).toBe(1);
    const many = Array.from({ length: 400 }, (_, i) => box(`n${i}`, (i % 20) * 70, Math.floor(i / 20) * 20, i));
    expect(placeLabels(many, { padding: 2 }).size).toBe(400); // a clean grid keeps everything
  });

  it('community label alpha is 1 when zoomed out, 0 when zoomed in, monotone in between', () => {
    expect(communityLabelAlpha(0.5)).toBe(1);
    expect(communityLabelAlpha(3)).toBe(0);
    const mid = communityLabelAlpha(1.4);
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1);
    expect(communityLabelAlpha(1.2)).toBeGreaterThan(communityLabelAlpha(1.6));
  });

  it('hull alpha factor eases from 1 (far) to 0.3 (near)', () => {
    expect(hullAlphaFactor(0.8)).toBe(1);
    expect(hullAlphaFactor(3)).toBeCloseTo(0.3);
    expect(hullAlphaFactor(1.9)).toBeGreaterThan(0.3); expect(hullAlphaFactor(1.9)).toBeLessThan(1);
  });

  it('font sizes, widths and truncation are bounded', () => {
    expect(labelFontPx(0, false)).toBe(10.5);
    expect(labelFontPx(100, false)).toBe(13.5);
    expect(labelFontPx(0, true)).toBe(11);
    expect(estimateTextWidth('abcd', 10)).toBeCloseTo(32);
    expect(truncateLabel('x'.repeat(50))).toHaveLength(41);
    expect(truncateLabel('short')).toBe('short');
  });
});


describe('graph-labels — anchored community labels', () => {
  const lbl = (id: string, x: number, y: number, priority = 1, width = 40) => ({ id, x, y, width, height: 14, priority });

  it('keeps a free label on its anchor; a colliding one slides sideways first, never up', () => {
    const placed = placeAnchoredLabels([lbl('a', 100, 50, 5), lbl('b', 110, 52, 1)], [], { step: 24, lineHeight: 14 });
    expect(placed.get('a')).toEqual({ x: 100, y: 50, shifted: false });
    const b = placed.get('b')!;
    expect(b.y).toBe(52); // same row
    expect(b.x).toBe(158); // +24 and −24 still overlap `a`; +48 is the first free slot
    expect(b.shifted).toBe(true);
    // never above its anchor, whatever happens
    for (const p of placed.values()) expect(p.y).toBeGreaterThanOrEqual(50);
  });

  it('drops one line down (into the hull edge) only when no sideways slot is free, and gives up after that', () => {
    // a wall of blockers across the whole row leaves no sideways room
    const wall = Array.from({ length: 20 }, (_, i) => ({ x: i * 90 - 400, y: 50, width: 90, height: 14 }));
    const placed = placeAnchoredLabels([lbl('a', 100, 50, 1, 80)], wall, { step: 24, lineHeight: 14, padding: 3 });
    expect(placed.get('a')).toEqual({ x: 100, y: 67, shifted: true }); // one line + padding down, same x
    const twoRows = [...wall, ...wall.map((w) => ({ ...w, y: 67 }))];
    expect(placeAnchoredLabels([lbl('a', 100, 50, 1, 80)], twoRows, { step: 24, lineHeight: 14, padding: 3 }).has('a')).toBe(false);
  });

  it('higher priority wins the anchor; boxes are kept inside the horizontal bounds', () => {
    const placed = placeAnchoredLabels([lbl('low', 100, 50, 1), lbl('high', 100, 50, 9)], [], { step: 24, lineHeight: 14 });
    expect(placed.get('high')).toEqual({ x: 100, y: 50, shifted: false });
    expect(placed.get('low')).toEqual({ x: 148, y: 50, shifted: true }); // sideways beats dropping a row
    const edge = placeAnchoredLabels([lbl('e', -40, 10, 1, 100)], [], { bounds: { width: 300 } });
    expect(edge.get('e')!.x).toBe(8);
  });
});

describe('graph-labels — spotlight hit dedupe', () => {
  it('collapses hits that share a truncated text, keeps the best-scoring one with the group count', () => {
    const counts = dedupeHitLabels([
      { id: 'm1', key: 'Founders churn', priority: 0.9 },
      { id: 'm2', key: 'Founders churn', priority: 0.95 },
      { id: 'm3', key: 'Founders churn', priority: 0.5 },
      { id: 'm4', key: 'Consultants pay', priority: 0.7 },
    ]);
    expect([...counts.entries()].sort()).toEqual([['m2', 3], ['m4', 1]]);
    expect(badgeLabel('Founders churn', 3)).toBe('Founders churn ×3');
    expect(badgeLabel('Consultants pay', 1)).toBe('Consultants pay');
    expect(dedupeHitLabels([]).size).toBe(0);
  });
});
