import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { createRef, forwardRef, useEffect, useImperativeHandle } from 'react';
import { KnowledgeGraphView, type KnowledgeGraphViewHandle } from '../../../src/components/graph/KnowledgeGraphView';
import { edge, fakeCtx, node, type FakeCtx } from './fixtures';

/**
 * react-force-graph-2d is mocked with a component that, after every render,
 * seeds positions and calls `nodeCanvasObject` for each node with a fake 2D
 * context. Props and the per-node contexts are exposed on `registry`.
 */
interface Registry {
  props: Record<string, unknown> | null;
  ctxById: Map<string, FakeCtx>;
  zoomToFit: ReturnType<typeof vi.fn>;
  centerAt: ReturnType<typeof vi.fn>;
  zoom: ReturnType<typeof vi.fn>;
  reheat: ReturnType<typeof vi.fn>;
}
const registry: Registry = { props: null, ctxById: new Map(), zoomToFit: vi.fn(), centerAt: vi.fn(), zoom: vi.fn(), reheat: vi.fn() };

vi.mock('react-force-graph-2d', () => {
  const chain: Record<string, unknown> = {};
  chain.strength = () => chain; chain.distanceMax = () => chain; chain.distance = () => chain;
  const Mock = forwardRef(function MockForceGraph(props: Record<string, unknown>, ref) {
    useImperativeHandle(ref, () => ({
      d3Force: () => chain,
      d3ReheatSimulation: registry.reheat,
      zoomToFit: registry.zoomToFit,
      centerAt: registry.centerAt,
      zoom: registry.zoom,
    }));
    registry.props = props;
    useEffect(() => {
      const data = props.graphData as { nodes: Array<{ id: string; x?: number; y?: number }> };
      const paint = props.nodeCanvasObject as (n: unknown, ctx: unknown, scale: number) => void;
      registry.ctxById.clear();
      data.nodes.forEach((n, i) => {
        if (n.x === undefined) { n.x = i * 10; n.y = 0; }
        const ctx = fakeCtx();
        registry.ctxById.set(n.id, ctx);
        paint(n, ctx, 1);
      });
    });
    return <div data-testid="mock-force-graph" data-nodes={(props.graphData as { nodes: unknown[] }).nodes.length} />;
  });
  return { default: Mock };
});

const nodes = [node('project:p'), node('memory:hit'), node('memory:other')];
const edges = [edge('memory:hit', 'project:p'), edge('memory:other', 'project:p')];
const noop = () => {};

const painted = (id: string) => registry.ctxById.get(id)!;
const maxAlpha = (id: string) => Math.max(...painted(id).alphas);

describe('KnowledgeGraphView — spotlight emphasis', () => {
  beforeEach(() => { registry.props = null; registry.ctxById.clear(); vi.clearAllMocks(); });

  it('paints hits at full alpha with a ring and dims non-hits', () => {
    render(
      <KnowledgeGraphView
        nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false}
        spotlight={{ scores: new Map([['memory:hit', 0.9]]), max: 0.9, filter: false }}
      />,
    );
    expect(maxAlpha('memory:hit')).toBe(1);
    expect(maxAlpha('memory:other')).toBeLessThanOrEqual(0.15);
    expect(maxAlpha('project:p')).toBeLessThanOrEqual(0.15);
    // ring: a stroke() happens before the shape fill for the hit, none for the non-hit
    expect(painted('memory:hit').calls.some((c) => c.startsWith('stroke('))).toBe(true);
    expect(painted('memory:other').calls.some((c) => c.startsWith('stroke('))).toBe(false);
    // hits always get a label
    expect(painted('memory:hit').calls.some((c) => c.startsWith('fillText('))).toBe(true);
    expect(painted('memory:other').calls.some((c) => c.startsWith('fillText('))).toBe(false);
  });

  it('"Filter to results" skips painting non-hits entirely without changing the node set', () => {
    render(
      <KnowledgeGraphView
        nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false}
        spotlight={{ scores: new Map([['memory:hit', 0.9]]), max: 0.9, filter: true }}
      />,
    );
    expect(painted('memory:other').calls).toEqual([]);
    expect(painted('memory:hit').calls.length).toBeGreaterThan(0);
    // nodes stay in graphData (no relayout) — only painting is suppressed
    expect((registry.props!.graphData as { nodes: unknown[] }).nodes).toHaveLength(3);
    // hidden nodes also get no pointer area and transparent links
    const pointer = fakeCtx();
    (registry.props!.nodePointerAreaPaint as (n: unknown, c: string, ctx: unknown) => void)(
      (registry.props!.graphData as { nodes: Array<{ id: string }> }).nodes.find((n) => n.id === 'memory:other'), '#f00', pointer,
    );
    expect(pointer.calls).toEqual([]);
    const linkColor = registry.props!.linkColor as (l: unknown) => string;
    const links = (registry.props!.graphData as { links: Array<{ id: string }> }).links;
    expect(linkColor(links.find((l) => l.id === edges[1].id))).toBe('rgba(0,0,0,0)');
  });

  it('without a spotlight the old base alphas apply (memories quieter)', () => {
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    expect(maxAlpha('project:p')).toBe(1);
    expect(maxAlpha('memory:hit')).toBe(0.75);
  });
});

describe('KnowledgeGraphView — timeline overlay', () => {
  it('fades, hides and draws hollow glyphs per the overlay; edges follow', () => {
    const overlay = {
      nodeVisibility: new Map([['project:p', 'visible'], ['memory:hit', 'faded'], ['memory:other', 'hidden']] as const),
      edgeVisibility: new Map([[edges[0].id, 'faded'], [edges[1].id, 'hidden']] as const),
      hollow: new Set(['memory:hit']),
    };
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} timeline={overlay} />);
    expect(maxAlpha('project:p')).toBe(1);
    expect(maxAlpha('memory:hit')).toBeCloseTo(0.75 * 0.25);
    expect(painted('memory:other').calls).toEqual([]);
    // hollow memory: stroked outline, no fill()
    const hitCalls = painted('memory:hit').calls;
    expect(hitCalls.some((c) => c.startsWith('stroke('))).toBe(true);
    expect(hitCalls.some((c) => c === 'fill()')).toBe(false);
    // a visible, non-hollow node is filled
    expect(painted('project:p').calls.some((c) => c === 'fill()')).toBe(true);
    const linkColor = registry.props!.linkColor as (l: unknown) => string;
    const linkWidth = registry.props!.linkWidth as (l: unknown) => number;
    const links = (registry.props!.graphData as { links: Array<{ id: string }> }).links;
    expect(linkColor(links.find((l) => l.id === edges[1].id))).toBe('rgba(0,0,0,0)');
    expect(linkWidth(links.find((l) => l.id === edges[0].id))).toBe(0.4);
  });
});

describe('KnowledgeGraphView — handle + callbacks', () => {
  it('zoomToFitIds fits only the given ids and the selection callback toggles', () => {
    const ref = createRef<KnowledgeGraphViewHandle>();
    const onSelect = vi.fn();
    render(<KnowledgeGraphView ref={ref} nodes={nodes} edges={edges} selectedId="project:p" onSelect={onSelect} showLabels={false} />);
    act(() => ref.current!.zoomToFitIds(new Set(['memory:hit'])));
    expect(registry.zoomToFit).toHaveBeenCalledTimes(1);
    const filter = registry.zoomToFit.mock.calls[0][2] as (n: { id: string }) => boolean;
    expect(filter({ id: 'memory:hit' })).toBe(true);
    expect(filter({ id: 'project:p' })).toBe(false);
    // unknown ids → no-op
    act(() => ref.current!.zoomToFitIds(new Set(['nope'])));
    expect(registry.zoomToFit).toHaveBeenCalledTimes(1);

    const onNodeClick = registry.props!.onNodeClick as (n: { id: string }) => void;
    onNodeClick({ id: 'project:p' });
    expect(onSelect).toHaveBeenLastCalledWith(null); // clicking the selected node clears
    onNodeClick({ id: 'memory:hit' });
    expect(onSelect).toHaveBeenLastCalledWith('memory:hit');
    (registry.props!.onBackgroundClick as () => void)();
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('focusNode centres on a positioned node', () => {
    const ref = createRef<KnowledgeGraphViewHandle>();
    render(<KnowledgeGraphView ref={ref} nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    act(() => ref.current!.focusNode('memory:hit', 3));
    expect(registry.centerAt).toHaveBeenCalledWith(10, 0, 400);
    expect(registry.zoom).toHaveBeenCalledWith(3, 400);
  });
});
