import { describe, it, expect } from 'vitest';
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@boardroom/shared';
import { createGraphStore, syncGraphData, idOf } from '../../../src/components/graph/graph-data';

const node = (id: string, label = id): KnowledgeGraphNode =>
  ({ id, type: 'project', label, domain: null } as unknown as KnowledgeGraphNode);
const edge = (id: string, source: string, target: string): KnowledgeGraphEdge =>
  ({ id, source, target, type: 'memory_entity' } as unknown as KnowledgeGraphEdge);

describe('syncGraphData — stable identities', () => {
  it('reuses node and link objects (and the graphData object) while the id set is unchanged', () => {
    const store = createGraphStore();
    const first = syncGraphData(store, [node('a'), node('b')], [edge('e1', 'a', 'b')]);
    expect(first.idsChanged).toBe(true);
    const a = first.graphData.nodes[0];
    // Simulate the force layout having positioned the node
    a.x = 12; a.y = -4;

    // Selection / re-render: fresh arrays, same ids, new depth + relabelled data
    const depth = new Map([['a', 0], ['b', 1]]);
    const second = syncGraphData(store, [node('a', 'A renamed'), node('b')], [edge('e1', 'a', 'b')], depth);
    expect(second.idsChanged).toBe(false);
    expect(second.graphData).toBe(first.graphData);
    expect(second.graphData.nodes[0]).toBe(a);
    expect(a.x).toBe(12);
    expect(a.y).toBe(-4);
    expect(a.data.label).toBe('A renamed');
    expect(a.depth).toBe(0);
    expect(second.graphData.links[0]).toBe(first.graphData.links[0]);
    expect(second.neighbours.get('a')?.has('b')).toBe(true);
  });

  it('reports idsChanged and hands out a new graphData object when the set changes, keeping survivors', () => {
    const store = createGraphStore();
    const first = syncGraphData(store, [node('a'), node('b'), node('c')], [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')]);
    const b = first.graphData.nodes[1];
    b.x = 3; b.y = 5;

    const second = syncGraphData(store, [node('b'), node('c')], [edge('e2', 'b', 'c')]);
    expect(second.idsChanged).toBe(true);
    expect(second.graphData).not.toBe(first.graphData);
    expect(second.graphData.nodes.map((n) => n.id)).toEqual(['b', 'c']);
    expect(second.graphData.nodes[0]).toBe(b);
    expect(b.x).toBe(3);
    expect(store.nodeMap.has('a')).toBe(false);
    expect(store.linkMap.has('e1')).toBe(false);

    // A new node arriving is also a change
    const third = syncGraphData(store, [node('b'), node('c'), node('d')], [edge('e2', 'b', 'c')]);
    expect(third.idsChanged).toBe(true);
    expect(third.graphData.nodes[2].degree).toBe(0);
  });

  it('re-seeds a link endpoint only when the edge actually moved', () => {
    const store = createGraphStore();
    const first = syncGraphData(store, [node('a'), node('b'), node('c')], [edge('e1', 'a', 'b')]);
    const link = first.graphData.links[0];
    // d3 resolves endpoints to node objects
    link.source = first.graphData.nodes[0];
    link.target = first.graphData.nodes[1];

    syncGraphData(store, [node('a'), node('b'), node('c')], [edge('e1', 'a', 'b')]);
    expect(typeof link.source).toBe('object');
    expect(idOf(link.source)).toBe('a');

    syncGraphData(store, [node('a'), node('b'), node('c')], [edge('e1', 'a', 'c')]);
    expect(link.target).toBe('c');
    expect(idOf(link.source)).toBe('a');
  });
});
