import { describe, it, expect } from 'vitest';
import { EDGE_TYPES, filterByEdgeTypes, groupNeighboursByEdgeType } from '../../../src/components/graph/graph-filters';
import { edge, node } from './fixtures';

const nodes = [node('goal:g'), node('project:p'), node('task:t'), node('person:x'), node('memory:m'), node('project:lonely')];
const edges = [
  edge('goal:g', 'project:p', 'goal_project'),
  edge('project:p', 'task:t', 'project_task'),
  edge('project:p', 'person:x', 'project_person', 'engineer'),
  edge('memory:m', 'project:p', 'memory_entity'),
];

describe('graph-filters — edge-type filter', () => {
  it('is a pass-through when every type is allowed', () => {
    const r = filterByEdgeTypes(nodes, edges, new Set(EDGE_TYPES));
    expect(r.edges).toHaveLength(4);
    expect(r.nodes).toHaveLength(6);
    expect(r.orphaned).toEqual([]);
  });

  it('removes edges of other types and the nodes they alone connected, keeping pre-existing orphans', () => {
    const r = filterByEdgeTypes(nodes, edges, new Set(['goal_project', 'project_task']));
    expect(r.edges.map((e) => e.type)).toEqual(['goal_project', 'project_task']);
    const ids = r.nodes.map((n) => n.id);
    expect(ids).toContain('goal:g');
    expect(ids).toContain('project:p');
    expect(ids).toContain('task:t');
    expect(ids).not.toContain('person:x');   // only reachable via project_person
    expect(ids).not.toContain('memory:m');   // only reachable via memory_entity
    expect(ids).toContain('project:lonely'); // was already an orphan — the Orphans toggle owns it
    expect(r.orphaned.sort()).toEqual(['memory:m', 'person:x']);
  });

  it('never drops a pinned (selected) node', () => {
    const r = filterByEdgeTypes(nodes, edges, new Set(['goal_project']), new Set(['memory:m']));
    expect(r.nodes.map((n) => n.id)).toContain('memory:m');
    expect(r.orphaned).toEqual(['task:t', 'person:x']);
  });
});

describe('graph-filters — neighbours grouped by edge type', () => {
  it('groups in schema order with direction and skips unknown nodes', () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const groups = groupNeighboursByEdgeType('project:p', [...edges, edge('project:p', 'task:missing', 'project_task')], byId);
    expect(groups.map((g) => g.type)).toEqual(['goal_project', 'project_task', 'project_person', 'memory_entity']);
    expect(groups.map((g) => g.items.length)).toEqual([1, 1, 1, 1]);
    const goal = groups[0].items[0];
    expect(goal.node.id).toBe('goal:g');
    expect(goal.direction).toBe('in');
    const task = groups[1].items[0];
    expect(task.direction).toBe('out');
    expect(groups[2].items[0].edge.label).toBe('engineer');
  });

  it('returns nothing for a node without edges', () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(groupNeighboursByEdgeType('project:lonely', edges, byId)).toEqual([]);
  });
});
