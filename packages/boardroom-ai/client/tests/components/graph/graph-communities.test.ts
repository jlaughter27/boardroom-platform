import { describe, it, expect } from 'vitest';
import { communityLabel, communitySlot, detectCommunities, relabel, seededRng } from '../../../src/components/graph/graph-communities';
import { edge, node } from './fixtures';

/** Two cliques joined by a single bridge edge. */
function twoClusters() {
  const a = ['project:a', 'person:a1', 'task:a2', 'memory:a3', 'memory:a4'];
  const b = ['project:b', 'person:b1', 'task:b2', 'memory:b3', 'memory:b4'];
  const nodes = [...a, ...b].map((id) => node(id, { label: id.split(':')[1] }));
  const edges = [];
  for (const group of [a, b]) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) edges.push(edge(group[i], group[j], 'project_person'));
  edges.push(edge('memory:a4', 'memory:b4'));
  return { nodes, edges, a, b };
}

describe('detectCommunities', () => {
  it('separates two cliques joined by a bridge, deterministically', () => {
    const { nodes, edges, a, b } = twoClusters();
    const r1 = detectCommunities(nodes, edges);
    const r2 = detectCommunities([...nodes].reverse(), [...edges].reverse());
    expect(r1.communities).toHaveLength(2);
    const ca = new Set(a.map((id) => r1.communityOf.get(id)));
    const cb = new Set(b.map((id) => r1.communityOf.get(id)));
    expect(ca.size).toBe(1); expect(cb.size).toBe(1); expect([...ca][0]).not.toBe([...cb][0]);
    // same partition and same ids regardless of input order
    for (const n of nodes) expect(r2.communityOf.get(n.id)).toBe(r1.communityOf.get(n.id));
  });

  it('keeps ids stable against a previous partition when nodes are added or the order flips', () => {
    const { nodes, edges } = twoClusters();
    const first = detectCommunities(nodes, edges);
    // Add a memory to the (currently smaller-id) community so sizes flip — canonical order would swap ids
    const extra = [node('memory:a9'), node('memory:a8'), node('memory:a7')];
    const added = [...nodes, ...extra];
    const addedEdges = [...edges, ...extra.map((n) => edge(n.id, 'project:a'))];
    const second = detectCommunities(added, addedEdges, first.communityOf);
    for (const n of nodes) expect(second.communityOf.get(n.id)).toBe(first.communityOf.get(n.id));
    expect(second.communityOf.get('memory:a9')).toBe(first.communityOf.get('project:a'));
    // Without the previous partition the larger community takes id 0
    const fresh = detectCommunities(added, addedEdges);
    expect(fresh.communityOf.get('project:a')).toBe(0);
  });

  it('labels a community after its most central entity (two names when the runner-up is close)', () => {
    const { nodes, edges } = twoClusters();
    const res = detectCommunities(nodes, edges);
    const ca = res.communities.find((c) => c.members.includes('project:a'))!;
    expect(ca.hubIds[0]).toBe('project:a'); // projects outrank people / tasks at equal degree
    expect(ca.label.startsWith('a')).toBe(true);
    expect(communityLabel([{ node: node('project:x', { label: 'X' }), score: 10 }, { node: node('person:y', { label: 'Y' }), score: 9 }])).toBe('X · Y');
    expect(communityLabel([{ node: node('project:x', { label: 'X' }), score: 10 }, { node: node('person:y', { label: 'Y' }), score: 2 }])).toBe('X');
    expect(communityLabel([])).toBe('Cluster');
  });

  it('folds tiny communities into their best-connected neighbour and handles edgeless graphs', () => {
    const { nodes, edges } = twoClusters();
    const lone = node('memory:lone');
    const res = detectCommunities([...nodes, lone], [...edges, edge('memory:lone', 'project:b')]);
    expect(res.communityOf.get('memory:lone')).toBe(res.communityOf.get('project:b'));
    const none = detectCommunities([node('a'), node('b')], []);
    expect(none.communities).toHaveLength(1);
    expect(detectCommunities([], []).communities).toHaveLength(0);
  });

  it('relabel maps by overlap, never reuses an old id twice, and mints fresh ids above the old max', () => {
    const prev = new Map([['a', 3], ['b', 3], ['c', 7]]);
    expect(relabel([['c', 'z'], ['a', 'b', 'y'], ['q']], prev)).toEqual([7, 3, 8]);
    expect(relabel([['a'], ['b']], prev)).toEqual([3, 8]); // second group overlaps the same old id → fresh id above the old max (7)
    expect(relabel([['a'], ['b']], null)).toEqual([0, 1]);
  });

  it('seeded rng is reproducible and slots beyond six fold to neutral', () => {
    const a = seededRng(42); const b = seededRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(communitySlot(0)).toBe(0); expect(communitySlot(5)).toBe(5); expect(communitySlot(6)).toBe('neutral'); expect(communitySlot(-1)).toBe('neutral');
  });
});
