import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { forwardRef, useImperativeHandle } from 'react';
import * as api from '../../src/lib/api';
import GraphPage, { LEGACY_STORAGE_KEY, STORAGE_KEY, loadFilters } from '../../src/pages/GraphPage';
import { useGraphStore } from '../../src/stores/graph.store';
import { useCommandPaletteStore } from '../../src/stores/commandPalette.store';
import { edge, fakeCtx, graphOf, node } from '../components/graph/fixtures';

/**
 * GraphPage wiring: lazy backlink fetch (H2), empty "Filter to results" (M2),
 * ?focus= centring (M3), select vs focus (M4), history side effects (L1),
 * storage migration / validation (L9) and history pruning (L10).
 */

vi.mock('../../src/lib/api', () => ({
  getKnowledgeGraph: vi.fn(),
  getGraphBacklinks: vi.fn(),
  getGraphNeighbourhoods: vi.fn(),
  getUnlinkedMentions: vi.fn().mockResolvedValue({ items: [] }),
  getPeople: vi.fn().mockResolvedValue([]),
  getDecisions: vi.fn().mockResolvedValue([]),
  getTasks: vi.fn().mockResolvedValue([]),
}));

interface Registry {
  props: Record<string, unknown> | null;
  reheat: ReturnType<typeof vi.fn>;
  zoomToFit: ReturnType<typeof vi.fn>;
  centerAt: ReturnType<typeof vi.fn>;
  zoom: ReturnType<typeof vi.fn>;
}
const registry: Registry = { props: null, reheat: vi.fn(), zoomToFit: vi.fn(), centerAt: vi.fn(), zoom: vi.fn() };

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
    const data = props.graphData as { nodes: Array<{ id: string; x?: number; y?: number }> };
    data.nodes.forEach((n, i) => { if (n.x === undefined) { n.x = i * 10; n.y = 0; } });
    return <div data-testid="fg" data-nodes={data.nodes.length} data-ids={data.nodes.map((n) => n.id).join(',')} />;
  });
  return { default: Mock };
});

// p — a, b (memories); p — g (goal); g — t (task): t is 3 hops from the memories.
const graph = graphOf(
  [node('project:p'), node('memory:a'), node('memory:b'), node('goal:g'), node('task:t')],
  [edge('memory:a', 'project:p'), edge('memory:b', 'project:p'), edge('goal:g', 'project:p', 'goal_project'), edge('goal:g', 'task:t', 'project_task')],
);
const hit = (id: string) => ({ nodeId: `memory:${id}`, refId: id, type: 'memory' as const, label: id, score: 0.5, snippet: '', layers: [], status: null, createdAt: '2026-08-01T00:00:00.000Z' });

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPage(entry = '/graph') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/graph" element={<><GraphPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const fg = () => screen.getByTestId('fg');
const ids = () => (fg().getAttribute('data-ids') ?? '').split(',').filter(Boolean);
const click = (id: string, detail = 1) => act(() => { (registry.props!.onNodeClick as (n: { id: string }, ev: { detail: number }) => void)({ id }, { detail }); });
const setHits = (...hs: ReturnType<typeof hit>[]) => act(() => {
  useGraphStore.setState((s) => ({ spotlight: { ...s.spotlight, query: 'q', active: true, hits: hs } }));
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('GraphPage', () => {
  beforeAll(() => {
    // jsdom may not schedule rAF; the page uses it to defer focusNode by a frame.
    window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
    window.cancelAnimationFrame = (id: number) => clearTimeout(id);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    registry.props = null;
    useGraphStore.getState().clearSpotlight();
    useGraphStore.setState({ paletteMode: 'commands', graphMounted: false, focusRequest: null });
    useCommandPaletteStore.setState({ open: false });
    vi.mocked(api.getKnowledgeGraph).mockResolvedValue(graph);
    vi.mocked(api.getGraphBacklinks).mockImplementation(async (id: string) => ({ node: node(id), backlinks: [] }));
    vi.mocked(api.getGraphNeighbourhoods).mockResolvedValue([]);
  });

  // ── H2 ──────────────────────────────────────────────────────────────────────
  it('lazy backlink fetch survives a dependency change mid-flight: the response is merged, the id is not refetched, the caption clears', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api.getGraphNeighbourhoods).mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    setHits(hit('a'), hit('zz'));
    renderPage();
    await screen.findByTestId('fg');
    await waitFor(() => expect(api.getGraphNeighbourhoods).toHaveBeenCalledWith(['memory:zz']));
    expect(screen.getByTestId('spotlight-bar')).toHaveTextContent('1 in view, fetching the rest…');

    // Same ids, new array (a re-run of the search) while the fetch is in flight — used to cancel + strand the id.
    setHits(hit('a'), hit('zz'));
    await act(async () => { resolve([{ node: node('memory:zz'), backlinks: [{ node: node('project:p'), edge: edge('memory:zz', 'project:p') }] }]); });
    await flush();

    expect(api.getGraphNeighbourhoods).toHaveBeenCalledTimes(1);
    expect(ids()).toContain('memory:zz');
    expect(screen.getByTestId('spotlight-bar')).not.toHaveTextContent('fetching the rest');
    expect(screen.getByTestId('spotlight-bar')).not.toHaveTextContent('in view');
    expect(screen.getByTestId('spotlight-bar')).toHaveTextContent('2 hits');

    // A later hits update with the same ids does not refetch either (marked attempted on settle).
    setHits(hit('a'), hit('zz'));
    await flush();
    expect(api.getGraphNeighbourhoods).toHaveBeenCalledTimes(1);
  });

  it('ids the server does not return are marked unavailable (never retried) and counted in the bar', async () => {
    vi.mocked(api.getGraphNeighbourhoods).mockResolvedValue([]);
    setHits(hit('a'), hit('gone'), hit('gone2'));
    renderPage();
    await screen.findByTestId('fg');
    await waitFor(() => expect(screen.getByTestId('spotlight-unavailable')).toHaveTextContent('2 results are not in the graph (archived or superseded)'));
    expect(screen.getByTestId('spotlight-bar')).not.toHaveTextContent('fetching the rest');
    expect(api.getGraphNeighbourhoods).toHaveBeenCalledTimes(1);
    setHits(hit('a'), hit('gone'), hit('gone2'));
    await flush();
    expect(api.getGraphNeighbourhoods).toHaveBeenCalledTimes(1);
  });

  // ── M2 ──────────────────────────────────────────────────────────────────────
  it('"Filter to results" with no loaded hit falls back to fading (canvas never blank) and says so', async () => {
    vi.mocked(api.getGraphNeighbourhoods).mockResolvedValue([]);
    act(() => { useGraphStore.setState((s) => ({ spotlight: { ...s.spotlight, query: 'q', active: true, hits: [hit('gone')], filterToResults: true } })); });
    renderPage();
    await screen.findByTestId('fg');
    await waitFor(() => expect(screen.getByTestId('spotlight-empty-filter')).toBeInTheDocument());
    // Every loaded node is still painted (alpha > 0) even though the filter toggle is on.
    const paint = registry.props!.nodeCanvasObject as (n: unknown, ctx: unknown, scale: number) => void;
    const data = registry.props!.graphData as { nodes: Array<{ id: string }> };
    for (const n of data.nodes) {
      const ctx = fakeCtx();
      paint(n, ctx, 1);
      expect(ctx.calls.length, n.id).toBeGreaterThan(0);
      expect(Math.max(...ctx.alphas), n.id).toBeGreaterThan(0);
    }
    // Once a hit IS in the graph, the real filter applies again (re-read the painter: it closes over the spotlight).
    setHits(hit('a'));
    await flush();
    expect(screen.queryByTestId('spotlight-empty-filter')).not.toBeInTheDocument();
    const paintNow = registry.props!.nodeCanvasObject as (n: unknown, ctx: unknown, scale: number) => void;
    const ctx = fakeCtx();
    paintNow(data.nodes.find((n) => n.id === 'memory:b'), ctx, 1);
    expect(ctx.calls).toEqual([]);
  });

  // ── M3 ──────────────────────────────────────────────────────────────────────
  it('a ?focus= deep link centres the viewport on the node once it is positioned', async () => {
    renderPage('/graph?focus=memory:a');
    await screen.findByTestId('fg');
    await waitFor(() => expect(registry.centerAt).toHaveBeenCalled());
    // memory:a is the second node in the kept set → seeded at x = 10
    expect(registry.centerAt).toHaveBeenLastCalledWith(10, 0, 400);
    expect(registry.zoom).toHaveBeenLastCalledWith(2.2, 400);
    // The deep link is kept as-is (no needless rewrite of an equivalent query string).
    expect(screen.getByTestId('location')).toHaveTextContent(/\/graph\?focus=memory(:|%3A)a/);
    expect(screen.getByTestId('graph-summary')).toHaveTextContent('local 2° around memory:a');
  });

  // ── M4 ──────────────────────────────────────────────────────────────────────
  it('single click selects without re-rooting (no id-set change, no reheat); double-click focuses', async () => {
    renderPage();
    await screen.findByTestId('fg');
    expect(ids()).toHaveLength(5);
    const reheatsAfterLoad = registry.reheat.mock.calls.length;

    click('memory:b');
    expect(screen.getByRole('heading', { name: 'memory:b' })).toBeInTheDocument(); // inspector
    expect(ids()).toHaveLength(5);
    expect(registry.reheat).toHaveBeenCalledTimes(reheatsAfterLoad);
    expect(screen.getByTestId('location')).toHaveTextContent('/graph');
    expect(screen.getByTestId('location')).not.toHaveTextContent('focus=');
    expect(screen.queryByLabelText('Focus history')).not.toBeInTheDocument();

    click('memory:b', 2);
    await flush();
    expect(screen.getByTestId('location')).toHaveTextContent('/graph?focus=memory%3Ab');
    expect(screen.getByTestId('graph-summary')).toHaveTextContent('local 2° around memory:b');
    expect(ids()).toHaveLength(4); // task:t is 3 hops away
    expect(ids()).not.toContain('task:t');
    expect(registry.reheat).toHaveBeenCalledTimes(reheatsAfterLoad + 1);
    expect(within(screen.getByLabelText('Focus history')).getByTestId('focus-breadcrumbs')).toHaveTextContent('memory:b');
    expect(registry.centerAt).toHaveBeenCalled();

    // Esc clears the selection but keeps the focus root; with the palette open it does nothing.
    act(() => { useCommandPaletteStore.setState({ open: true }); });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'memory:b' })).toBeInTheDocument();
    act(() => { useCommandPaletteStore.setState({ open: false }); });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('heading', { name: 'memory:b' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('focus=memory%3Ab');
  });

  it('the inspector "Focus here" button re-roots; back / forward ([ ]) walk the history and centre', async () => {
    renderPage();
    await screen.findByTestId('fg');
    click('memory:b', 2);
    click('memory:a', 2);
    await flush();
    expect(screen.getByTestId('location')).toHaveTextContent('focus=memory%3Aa');
    registry.centerAt.mockClear();

    fireEvent.keyDown(window, { key: '[' });
    await flush();
    expect(screen.getByTestId('location')).toHaveTextContent('focus=memory%3Ab');
    expect(registry.centerAt).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: ']' });
    await flush();
    expect(screen.getByTestId('location')).toHaveTextContent('focus=memory%3Aa');

    // Select (single click) another node and use the inspector's button to focus it.
    click('project:p');
    fireEvent.click(screen.getByRole('button', { name: 'Focus here' }));
    await flush();
    expect(screen.getByTestId('location')).toHaveTextContent('focus=project%3Ap');
    expect(ids()).toHaveLength(5);
  });

  // ── L10 ─────────────────────────────────────────────────────────────────────
  it('prunes focus-history ids that turn out not to exist', async () => {
    vi.mocked(api.getGraphNeighbourhoods).mockResolvedValue([]);
    renderPage('/graph?focus=memory:gone');
    await screen.findByTestId('fg');
    await waitFor(() => expect(api.getGraphNeighbourhoods).toHaveBeenCalledWith(['memory:gone']));
    await waitFor(() => expect(screen.queryByLabelText('Focus history')).not.toBeInTheDocument());
  });
});

// ── L9 ────────────────────────────────────────────────────────────────────────
describe('loadFilters', () => {
  beforeEach(() => sessionStorage.clear());

  it('migrates v1 prefs into v2 (keeping types / domain / orphans / labels, adding defaults) and removes the v1 key', () => {
    sessionStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ types: ['memory', 'project'], domain: 'business', showOrphans: true, showLabels: false }));
    const f = loadFilters();
    expect([...f.types]).toEqual(['memory', 'project']);
    expect(f.domain).toBe('business');
    expect(f.showOrphans).toBe(true);
    expect(f.showLabels).toBe(false);
    expect(f.depth).toBe(2);
    expect(f.edgeTypes.size).toBeGreaterThan(0);
    expect(sessionStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    const v2 = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!);
    expect(v2.types).toEqual(['memory', 'project']);
    expect(v2.depth).toBe(2);
  });

  it('validates node / edge types from storage instead of trusting them', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ types: ['bogus', 'memory'], edgeTypes: ['nope'], domain: 42, depth: 9 }));
    const f = loadFilters();
    expect([...f.types]).toEqual(['memory']);
    expect(f.edgeTypes.size).toBeGreaterThan(1); // all edge types
    expect(f.domain).toBe('all');
    expect(f.depth).toBe(2);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ types: ['bogus'] }));
    expect(loadFilters().types.size).toBeGreaterThan(1); // nothing valid → all types
  });
});

// ── RD-6: "Showing 200 of N memories — Show more" ─────────────────────────────
describe('GraphPage memory cap (RD-6)', () => {
  const memories = (n: number, from = 0) => Array.from({ length: n }, (_, i) => node(`memory:m${from + i}`));
  const capped = (shown: number, total: number) => {
    const mems = memories(shown);
    const g = graphOf([node('project:p'), ...mems], mems.map((m) => edge(m.id, 'project:p')));
    return { ...g, stats: { ...g.stats, memoryLimitHit: total > shown, memoryTotal: total } };
  };

  beforeAll(() => {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
    window.cancelAnimationFrame = (id: number) => clearTimeout(id);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ depth: 0 })); // global view: every loaded memory is on the canvas
    registry.props = null;
    useGraphStore.getState().clearSpotlight();
    vi.mocked(api.getGraphNeighbourhoods).mockResolvedValue([]);
  });

  it('asks for 200 memories first, says how many are hidden, and "Show 200 more" requests the next step without a skeleton', async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValueOnce(capped(200, 640)).mockResolvedValueOnce(capped(400, 640));
    renderPage();
    await screen.findByTestId('fg');
    expect(api.getKnowledgeGraph).toHaveBeenLastCalledWith({ memoryLimit: 200 });
    expect(screen.getByTestId('graph-memory-cap')).toHaveTextContent('Showing 200 of 640 memories');

    fireEvent.click(screen.getByTestId('graph-show-more'));
    expect(screen.getByTestId('graph-show-more')).toHaveTextContent('Loading…');
    expect(screen.getByTestId('fg')).toBeInTheDocument(); // the canvas stays while the next slice loads
    await waitFor(() => expect(screen.getByTestId('graph-memory-cap')).toHaveTextContent('Showing 400 of 640 memories'));
    expect(api.getKnowledgeGraph).toHaveBeenLastCalledWith({ memoryLimit: 400 });
    expect(Number(fg().getAttribute('data-nodes'))).toBe(401);
    expect(screen.getByTestId('graph-show-more')).toHaveTextContent('Show 200 more');
  });

  it('the last step asks only for what is left; nothing hidden → no control', async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValueOnce(capped(200, 260)).mockResolvedValueOnce(capped(260, 260));
    renderPage();
    await screen.findByTestId('fg');
    expect(screen.getByTestId('graph-show-more')).toHaveTextContent('Show 60 more');
    fireEvent.click(screen.getByTestId('graph-show-more'));
    await waitFor(() => expect(screen.queryByTestId('graph-memory-cap')).not.toBeInTheDocument());
    expect(screen.getByTestId('graph-summary')).not.toHaveTextContent('memories');
  });

  it('a failed "Show more" keeps the current graph and says so', async () => {
    vi.mocked(api.getKnowledgeGraph).mockResolvedValueOnce(capped(200, 640)).mockRejectedValueOnce(new Error('boom'));
    renderPage();
    await screen.findByTestId('fg');
    fireEvent.click(screen.getByTestId('graph-show-more'));
    expect(await screen.findByText(/Could not load more memories/)).toBeInTheDocument();
    expect(screen.getByTestId('graph-memory-cap')).toHaveTextContent('Showing 200 of 640 memories');
    expect(Number(fg().getAttribute('data-nodes'))).toBe(201);
  });
});
