import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { createRef, forwardRef, useEffect, useImperativeHandle } from 'react';
import { INTENT_TTL_MS, KnowledgeGraphView, type KnowledgeGraphViewHandle } from '../../../src/components/graph/KnowledgeGraphView';
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

  it('double-click (detail 2) is a focus, single click a select', () => {
    const onSelect = vi.fn();
    const onFocus = vi.fn();
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={onSelect} onFocus={onFocus} showLabels={false} />);
    const onNodeClick = registry.props!.onNodeClick as (n: { id: string }, ev: { detail: number }) => void;
    onNodeClick({ id: 'memory:hit' }, { detail: 1 });
    expect(onSelect).toHaveBeenLastCalledWith('memory:hit');
    expect(onFocus).not.toHaveBeenCalled();
    onNodeClick({ id: 'memory:hit' }, { detail: 2 });
    expect(onFocus).toHaveBeenCalledWith('memory:hit');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('KnowledgeGraphView — relayout + viewport policy', () => {
  beforeEach(() => { registry.props = null; registry.ctxById.clear(); vi.clearAllMocks(); });

  it('selection / spotlight / depth changes never reheat; only an id-set change does (once)', () => {
    const { rerender } = render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    expect(registry.reheat).toHaveBeenCalledTimes(1); // first layout
    rerender(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId="memory:hit" onSelect={noop} showLabels={false} />);
    rerender(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId="project:p" onSelect={noop} showLabels={false} spotlight={{ scores: new Map([['memory:hit', 1]]), max: 1, filter: true }} />);
    rerender(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId="project:p" onSelect={noop} showLabels={false} depthById={new Map([['project:p', 0], ['memory:hit', 1]])} />);
    expect(registry.reheat).toHaveBeenCalledTimes(1);
    rerender(<KnowledgeGraphView nodes={nodes.slice(0, 2)} edges={edges.slice(0, 1)} selectedId="project:p" onSelect={noop} showLabels={false} />);
    expect(registry.reheat).toHaveBeenCalledTimes(2);
    rerender(<KnowledgeGraphView nodes={nodes.slice(0, 2)} edges={edges.slice(0, 1)} selectedId={null} onSelect={noop} showLabels={false} />);
    expect(registry.reheat).toHaveBeenCalledTimes(2);
  });

  it('with no intent the first engine stop fits the whole graph exactly once per layout', () => {
    const { rerender } = render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    const stop = () => (registry.props!.onEngineStop as () => void)();
    stop(); stop();
    expect(registry.zoomToFit).toHaveBeenCalledTimes(1);
    rerender(<KnowledgeGraphView nodes={nodes.slice(0, 2)} edges={edges.slice(0, 1)} selectedId={null} onSelect={noop} showLabels={false} />);
    stop();
    expect(registry.zoomToFit).toHaveBeenCalledTimes(2);
  });

  it('a fresh focusNode outranks the one-time fit and is re-applied when the simulation settles', () => {
    const ref = createRef<KnowledgeGraphViewHandle>();
    const { rerender } = render(<KnowledgeGraphView ref={ref} nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    act(() => ref.current!.focusNode('memory:hit'));
    expect(registry.centerAt).toHaveBeenCalledTimes(1);
    // Relayout (lazy merge / local-mode re-root) → engine stop: no whole-graph fit, the node is re-centred.
    rerender(<KnowledgeGraphView ref={ref} nodes={nodes.slice(0, 2)} edges={edges.slice(0, 1)} selectedId={null} onSelect={noop} showLabels={false} />);
    (registry.props!.onEngineStop as () => void)();
    expect(registry.zoomToFit).not.toHaveBeenCalled();
    expect(registry.centerAt).toHaveBeenCalledTimes(2);
    expect(registry.centerAt).toHaveBeenLastCalledWith(10, 0, 400);
  });

  it('a fresh zoomToFitIds ("Fit hits") outranks the one-time fit; an explicit zoomToFit clears the intent', () => {
    const ref = createRef<KnowledgeGraphViewHandle>();
    render(<KnowledgeGraphView ref={ref} nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    act(() => ref.current!.zoomToFitIds(new Set(['memory:hit'])));
    expect(registry.zoomToFit).toHaveBeenCalledTimes(1);
    (registry.props!.onEngineStop as () => void)();
    expect(registry.zoomToFit).toHaveBeenCalledTimes(2);
    // re-applied as a subset fit, not a whole-graph fit
    const filter = registry.zoomToFit.mock.calls[1][2] as (n: { id: string }) => boolean;
    expect(filter({ id: 'memory:hit' })).toBe(true);
    expect(filter({ id: 'project:p' })).toBe(false);

    act(() => ref.current!.zoomToFit());
    expect(registry.zoomToFit).toHaveBeenCalledTimes(3);
    expect(registry.zoomToFit.mock.calls[2][2]).toBeUndefined(); // whole graph
    (registry.props!.onEngineStop as () => void)();
    expect(registry.zoomToFit).toHaveBeenCalledTimes(3); // nothing pending, already fitted this layout
  });

  it('a stale intent (older than INTENT_TTL_MS) no longer blocks the fit', () => {
    const ref = createRef<KnowledgeGraphViewHandle>();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    const { rerender } = render(<KnowledgeGraphView ref={ref} nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    act(() => ref.current!.focusNode('memory:hit'));
    now.mockReturnValue(1_000_000 + INTENT_TTL_MS + 1);
    rerender(<KnowledgeGraphView ref={ref} nodes={nodes.slice(0, 2)} edges={edges.slice(0, 1)} selectedId={null} onSelect={noop} showLabels={false} />);
    (registry.props!.onEngineStop as () => void)();
    expect(registry.zoomToFit).toHaveBeenCalledTimes(1);
    expect(registry.centerAt).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });
});
