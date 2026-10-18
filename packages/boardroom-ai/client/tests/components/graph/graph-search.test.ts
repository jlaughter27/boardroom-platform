import { describe, it, expect } from 'vitest';
import {
  asOfToIso, formatAsOf, maxScore, memoryRowToHit, mergeBacklinks, missingHitIds, scoreMap, type HybridSearchRow,
} from '../../../src/components/graph/graph-search';
import { edge, graphOf, node } from './fixtures';

const row = (id: string, extra: Partial<HybridSearchRow> = {}): HybridSearchRow =>
  ({ id, title: `Memory ${id}`, content: 'x'.repeat(200), status: 'CONFIRMED', createdAt: '2026-08-01T00:00:00.000Z', score: 0.5, ...extra } as HybridSearchRow);

describe('graph-search — hits', () => {
  it('maps a hybrid row to a graph hit with a namespaced id, snippet and layers', () => {
    const h = memoryRowToHit(row('m1', { score: 0.91, layers: ['semantic', 'fts'] }));
    expect(h.nodeId).toBe('memory:m1');
    expect(h.type).toBe('memory');
    expect(h.score).toBe(0.91);
    expect(h.snippet.length).toBeLessThanOrEqual(140);
    expect(h.layers).toEqual(['semantic', 'fts']);
    // alt field names and missing scores are tolerated
    expect(memoryRowToHit(row('m2', { score: undefined, matchedLayers: ['trigram'] })).score).toBe(0);
    expect(memoryRowToHit(row('m2', { matchedLayers: ['trigram'] })).layers).toEqual(['trigram']);
  });

  it('builds the score map / max and finds hits missing from the loaded graph', () => {
    const hits = [memoryRowToHit(row('a', { score: 0.2 })), memoryRowToHit(row('b', { score: 0.9 })), memoryRowToHit(row('b', { score: 0.9 }))];
    expect(scoreMap(hits).get('memory:b')).toBe(0.9);
    expect(maxScore(hits)).toBe(0.9);
    const loaded = new Map([['memory:a', node('memory:a')]]);
    expect(missingHitIds(hits, loaded)).toEqual(['memory:b']); // deduped
  });
});

describe('graph-search — mergeBacklinks', () => {
  it('appends unknown nodes and edges, keeps existing rows, and updates stats', () => {
    const g = graphOf([node('project:p'), node('memory:a')], [edge('memory:a', 'project:p')]);
    const merged = mergeBacklinks(g, [{
      node: node('memory:b'),
      backlinks: [
        { node: node('project:p', { label: 'renamed' }), edge: edge('memory:b', 'project:p') },
        { node: node('person:x'), edge: edge('memory:b', 'person:x') },
        { node: node('memory:a'), edge: edge('memory:a', 'project:p') }, // duplicate edge
      ],
    }]);
    expect(merged).not.toBe(g);
    expect(merged.nodes.map((n) => n.id)).toEqual(['project:p', 'memory:a', 'memory:b', 'person:x']);
    expect(merged.nodes[0].label).toBe('project:p'); // existing row kept
    expect(merged.edges).toHaveLength(3);
    expect(merged.stats.nodeCounts.memory).toBe(2);
    expect(merged.stats.nodeCounts.person).toBe(1);
    expect(merged.stats.edgeCount).toBe(3);
  });

  it('returns the same object when nothing new arrived', () => {
    const g = graphOf([node('project:p'), node('memory:a')], [edge('memory:a', 'project:p')]);
    expect(mergeBacklinks(g, [{ node: node('memory:a'), backlinks: [{ node: node('project:p'), edge: edge('memory:a', 'project:p') }] }])).toBe(g);
    expect(mergeBacklinks(g, [])).toBe(g);
  });
});

describe('graph-search — asOf', () => {
  it('turns a day into an end-of-day UTC instant and a chip label', () => {
    expect(asOfToIso('2026-08-12')).toBe('2026-08-12T23:59:59.999Z');
    expect(asOfToIso('')).toBeUndefined();
    expect(asOfToIso('12/08/2026')).toBeUndefined();
    expect(formatAsOf('2026-08-12')).toBe('as of 12 Aug 2026');
    expect(formatAsOf(null)).toBeNull();
  });
});
