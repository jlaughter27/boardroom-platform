import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
    // hits always get a label; labels are drawn in the post pass (collision-placed), never per node
    const post = fakeCtx();
    (registry.props!.onRenderFramePost as (ctx: unknown, scale: number) => void)(post, 1);
    const drawn = post.calls.filter((c) => c.startsWith('fillText(')).join('\n');
    expect(drawn).toContain('memory:hit');
    expect(drawn).not.toContain('memory:other');
    expect(painted('memory:hit').calls.some((c) => c.startsWith('fillText('))).toBe(false);
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

  it('with no intent the first engine stop fits the whole graph exactly once per layout (centerAt + zoom with asymmetric insets)', () => {
    const { rerender } = render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    const stop = () => (registry.props!.onEngineStop as () => void)();
    stop(); stop();
    expect(registry.zoom).toHaveBeenCalledTimes(1);
    expect(registry.centerAt).toHaveBeenCalledTimes(1);
    expect(registry.zoomToFit).not.toHaveBeenCalled(); // the symmetric library fit is only the fallback
    rerender(<KnowledgeGraphView nodes={nodes.slice(0, 2)} edges={edges.slice(0, 1)} selectedId={null} onSelect={noop} showLabels={false} />);
    stop();
    expect(registry.zoom).toHaveBeenCalledTimes(2);
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
    expect(registry.zoomToFit).toHaveBeenCalledTimes(2); // whole-graph fits go through centerAt + zoom
    expect(registry.zoom).toHaveBeenCalledTimes(1);
    (registry.props!.onEngineStop as () => void)();
    expect(registry.zoomToFit).toHaveBeenCalledTimes(2); // nothing pending, already fitted this layout
    expect(registry.zoom).toHaveBeenCalledTimes(1);
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
    // the stale focus is NOT re-applied (zoom 2.2); instead the whole graph is fitted (a second centerAt + a fit zoom)
    expect(registry.centerAt).toHaveBeenCalledTimes(2);
    expect(registry.zoom).toHaveBeenCalledTimes(2);
    expect(registry.zoom.mock.calls[1][0]).not.toBe(2.2);
    now.mockRestore();
  });
});


describe('KnowledgeGraphView — communities, legend, hover card, settled flag', () => {
  beforeEach(() => { registry.props = null; registry.ctxById.clear(); vi.clearAllMocks(); });

  const communityOf = new Map([['project:p', 0], ['memory:hit', 0], ['memory:other', 0]]);
  const communities = [{ id: 0, members: ['project:p', 'memory:hit', 'memory:other'], size: 3, label: 'project:p', hubIds: ['project:p'] }];

  it('draws a hull for a community in the pre pass and its label in the post pass at low zoom only', () => {
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} communityOf={communityOf} communities={[{ ...communities[0], size: 4, members: [...communities[0].members, 'x'] }]} />);
    const pre = fakeCtx();
    (registry.props!.onRenderFramePre as (ctx: unknown, scale: number) => void)(pre, 0.8);
    // a hull = a traced path that is filled then stroked (after the grid stroke)
    expect(pre.calls.filter((c) => c === 'fill()').length).toBeGreaterThanOrEqual(1);
    expect(pre.calls.some((c) => c.startsWith('quadraticCurveTo('))).toBe(true);
    // without communities: no curves at all
    const pre2 = fakeCtx();
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    (registry.props!.onRenderFramePre as (ctx: unknown, scale: number) => void)(pre2, 0.8);
    expect(pre2.calls.some((c) => c.startsWith('quadraticCurveTo('))).toBe(false);
  });

  it('community labels fade out as you zoom in (semantic zoom)', () => {
    const big = new Map([['project:p', 0], ['memory:hit', 0], ['memory:other', 0]]);
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} communityOf={big} communities={communities} />);
    // HULL_LABEL_MIN_MEMBERS is 4 — three visible members never earns a community label
    const far = fakeCtx();
    (registry.props!.onRenderFramePre as (ctx: unknown, scale: number) => void)(far, 0.5);
    (registry.props!.onRenderFramePost as (ctx: unknown, scale: number) => void)(far, 0.5);
    expect(far.calls.filter((c) => c.startsWith('fillText(PROJECT:P'))).toHaveLength(0);
  });

  it('legend chips reflect and toggle the type filter', () => {
    const onToggleType = vi.fn();
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} typeFilter={new Set(['project'])} onToggleType={onToggleType} typeCounts={{ project: 1, memory: 2 }} />);
    const legend = screen.getByTestId('graph-legend');
    const projects = within(legend).getByRole('button', { name: /projects/i });
    const memories = within(legend).getByRole('button', { name: /memories/i });
    expect(projects).toHaveAttribute('aria-pressed', 'true');
    expect(memories).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(memories);
    expect(onToggleType).toHaveBeenCalledWith('memory');
  });

  it('hovering shows a DOM hover card with title, type and community; leaving removes it', () => {
    render(<KnowledgeGraphView nodes={[node('project:p', { label: 'Knowledge Graph', status: 'active', domain: 'business' }), ...nodes.slice(1)]} edges={edges} selectedId={null} onSelect={noop} showLabels={false} communityOf={communityOf} communities={[{ ...communities[0], label: 'Knowledge Graph · Maya' }]} />);
    const hover = registry.props!.onNodeHover as (n: { id: string } | null) => void;
    act(() => hover({ id: 'project:p' }));
    const card = screen.getByTestId('graph-tooltip');
    expect(card).toHaveTextContent('Knowledge Graph');
    expect(card).toHaveTextContent('Project');
    expect(card).toHaveTextContent('in Knowledge Graph · Maya');
    act(() => hover(null));
    expect(screen.queryByTestId('graph-tooltip')).not.toBeInTheDocument();
  });

  it('exposes data-settled once the engine stops and clears it on a relayout', () => {
    const { rerender } = render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    const view = screen.getByTestId('knowledge-graph-view');
    expect(view).not.toHaveAttribute('data-settled');
    (registry.props!.onEngineStop as () => void)();
    expect(view).toHaveAttribute('data-settled', 'true');
    rerender(<KnowledgeGraphView nodes={nodes.slice(0, 2)} edges={edges.slice(0, 1)} selectedId={null} onSelect={noop} showLabels={false} />);
    expect(view).not.toHaveAttribute('data-settled');
  });

  it('only edges touching the focus are repainted as gradients, with particles; reduced motion turns particles off', () => {
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId="project:p" onSelect={noop} showLabels={false} />);
    const links = (registry.props!.graphData as { links: Array<{ id: string }> }).links;
    const mode = registry.props!.linkCanvasObjectMode as (l: unknown) => string;
    const particles = registry.props!.linkDirectionalParticles as (l: unknown) => number;
    expect(mode(links[0])).toBe('replace'); // memory:hit — project:p touches the selection
    expect(particles(links[0])).toBeGreaterThan(0);
    const paint = registry.props!.linkCanvasObject as (l: unknown, ctx: unknown, scale: number) => void;
    const ctx = fakeCtx();
    paint({ ...links[0], source: { id: 'memory:hit', x: 0, y: 0, data: { type: 'memory' } }, target: { id: 'project:p', x: 10, y: 0, data: { type: 'project' } }, data: { type: 'memory_entity' } }, ctx, 1);
    expect(ctx.calls.some((c) => c.startsWith('createLinearGradient('))).toBe(true);
    expect(ctx.calls.some((c) => c === 'stroke()')).toBe(true);
    // no focus → nothing is replaced and no particles
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    const links2 = (registry.props!.graphData as { links: Array<{ id: string }> }).links;
    expect((registry.props!.linkCanvasObjectMode as (l: unknown) => string)(links2[0])).toBe('default');
    expect((registry.props!.linkDirectionalParticles as (l: unknown) => number)(links2[0])).toBe(0);
  });

  it('under a spotlight, duplicate hit labels collapse into one badged label and community labels are hidden', () => {
    const dup = [
      node('project:p'),
      node('memory:h1', { label: 'Founders churn when the first session takes too long' }),
      node('memory:h2', { label: 'Founders churn when the first session takes too long' }),
      node('memory:h3', { label: 'Consultants pay for the memory' }),
    ];
    const dupEdges = [edge('memory:h1', 'project:p'), edge('memory:h2', 'project:p'), edge('memory:h3', 'project:p')];
    const big = new Map(dup.map((n) => [n.id, 0]));
    render(
      <KnowledgeGraphView
        nodes={dup} edges={dupEdges} selectedId={null} onSelect={noop} showLabels={false}
        spotlight={{ scores: new Map([['memory:h1', 0.9], ['memory:h2', 0.95], ['memory:h3', 0.7]]), max: 0.95, filter: false }}
        communityOf={big} communities={[{ id: 0, members: dup.map((n) => n.id), size: 4, label: 'Project P', hubIds: ['project:p'] }]}
      />,
    );
    // spread the nodes out so plain collision is not what drops a label here
    (registry.props!.graphData as { nodes: Array<{ x: number; y: number }> }).nodes.forEach((n, i) => { n.x = i * 900; n.y = 0; });
    const post = fakeCtx();
    (registry.props!.onRenderFramePre as (ctx: unknown, scale: number) => void)(fakeCtx(), 0.6);
    (registry.props!.onRenderFramePost as (ctx: unknown, scale: number) => void)(post, 0.6);
    const texts = post.calls.filter((c) => c.startsWith('fillText(')).join('\n');
    expect(texts).toContain('×2');
    expect(texts.match(/Founders churn/g)?.length).toBe(1); // one label for the pair
    expect(texts).toContain('Consultants pay');
    expect(texts).not.toContain('PROJECT P'); // community label hidden while the spotlight is on
  });

  it('keyboard on the focused canvas zooms and pans', () => {
    render(<KnowledgeGraphView nodes={nodes} edges={edges} selectedId={null} onSelect={noop} showLabels={false} />);
    const view = screen.getByTestId('knowledge-graph-view');
    registry.zoom.mockReturnValue(1);
    registry.centerAt.mockReturnValue({ x: 0, y: 0 });
    fireEvent.keyDown(view, { key: '+' });
    expect(registry.zoom).toHaveBeenLastCalledWith(1.25, 160);
    fireEvent.keyDown(view, { key: 'ArrowRight' });
    expect(registry.centerAt).toHaveBeenLastCalledWith(48, 0, 160);
    fireEvent.keyDown(view, { key: '0' });
    // whole-graph fit = centerAt(x, y, ms) + zoom(k, ms); the getters (no-arg calls) also hit the spies
    expect(registry.zoom.mock.calls.at(-1)).toHaveLength(2);
    expect(registry.centerAt.mock.calls.at(-1)).toHaveLength(3);
    expect(registry.zoom.mock.calls.at(-1)![0]).not.toBe(1.25);
  });
});
