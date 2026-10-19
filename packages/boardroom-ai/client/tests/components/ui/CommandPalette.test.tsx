import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import * as api from '../../../src/lib/api';
import { CommandPalette } from '../../../src/components/ui/CommandPalette';
import { useCommandPaletteStore } from '../../../src/stores/commandPalette.store';
import { useGraphStore } from '../../../src/stores/graph.store';
import { useEntitiesStore } from '../../../src/stores/entities.store';

vi.mock('../../../src/lib/api', () => ({
  spotlightSearchMemories: vi.fn(),
  getTasks: vi.fn(),
  getCommitments: vi.fn(),
}));

const row = (id: string, score: number) => ({ id, title: `Memory ${id}`, content: `about ${id}`, status: 'CONFIRMED', createdAt: '2026-08-01T00:00:00.000Z', score, layers: ['semantic'] });

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <CommandPalette />
      <Routes><Route path="*" element={<LocationProbe />} /></Routes>
    </MemoryRouter>,
  );
}

async function openMemoryMode() {
  act(() => { useCommandPaletteStore.setState({ open: true }); });
  fireEvent.click(await screen.findByText('Search memory'));
  return screen.getByLabelText('Search memory');
}

describe('CommandPalette — memory search mode', () => {
  beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

  beforeEach(() => {
    vi.clearAllMocks();
    useCommandPaletteStore.setState({ open: false, tasksFetchedAt: 0, commitmentsFetchedAt: 0 });
    useGraphStore.getState().clearSpotlight();
    useGraphStore.setState({ paletteMode: 'commands', graphMounted: false, focusRequest: null });
    useEntitiesStore.setState({ tasks: [{ id: 't1', title: 'Ship pricing page', status: 'IN_PROGRESS' } as never], commitments: [{ id: 'c1', description: 'Send pricing deck to Ada', status: 'PENDING' } as never] });
    vi.mocked(api.spotlightSearchMemories).mockResolvedValue({ items: [row('a', 0.91), row('b', 0.42)] as never, nextCursor: 'c1' });
  });

  it('runs the hybrid search (debounced), renders hits with score and type, and loads more', async () => {
    renderPalette();
    const input = await openMemoryMode();
    fireEvent.change(input, { target: { value: 'pricing' } });
    await waitFor(() => expect(api.spotlightSearchMemories).toHaveBeenCalledWith({ query: 'pricing', limit: 20, asOfDay: null }));
    const hits = await screen.findAllByTestId('memory-hit');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toHaveTextContent('Memory a');
    expect(hits[0]).toHaveTextContent('91%');
    expect(hits[0]).toHaveTextContent('Memory');
    expect(hits[0]).toHaveTextContent('semantic');

    vi.mocked(api.spotlightSearchMemories).mockResolvedValueOnce({ items: [row('c', 0.1)] as never, nextCursor: null });
    fireEvent.click(screen.getByText('Load more'));
    await waitFor(() => expect(screen.getAllByTestId('memory-hit')).toHaveLength(3));
    expect(api.spotlightSearchMemories).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));
  });

  it('selecting a hit focuses it in the graph when the graph page is open', async () => {
    useGraphStore.setState({ graphMounted: true });
    renderPalette();
    const input = await openMemoryMode();
    fireEvent.change(input, { target: { value: 'pricing' } });
    const hits = await screen.findAllByTestId('memory-hit');
    fireEvent.click(hits[1]);
    expect(useGraphStore.getState().focusRequest).toBe('memory:b');
    expect(useCommandPaletteStore.getState().open).toBe(false);
    // the spotlight survives closing the palette (the graph keeps lighting hits)
    expect(useGraphStore.getState().spotlight.hits).toHaveLength(2);
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('selecting a hit elsewhere navigates to the graph with ?focus=', async () => {
    renderPalette();
    const input = await openMemoryMode();
    fireEvent.change(input, { target: { value: 'pricing' } });
    const hits = await screen.findAllByTestId('memory-hit');
    fireEvent.click(hits[0]);
    expect(screen.getByTestId('location')).toHaveTextContent('/graph?focus=memory%3Aa');
    expect(useGraphStore.getState().focusRequest).toBeNull();
  });

  it('the as-of date passes through to the endpoint and shows as a chip', async () => {
    renderPalette();
    const input = await openMemoryMode();
    fireEvent.change(input, { target: { value: 'pricing' } });
    await screen.findAllByTestId('memory-hit');
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-08-12' } });
    await waitFor(() => expect(api.spotlightSearchMemories).toHaveBeenLastCalledWith({ query: 'pricing', limit: 20, asOfDay: '2026-08-12' }));
    expect(screen.getByTestId('palette-asof-chip')).toHaveTextContent('as of 12 Aug 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Clear as-of date' }));
    expect(screen.queryByTestId('palette-asof-chip')).not.toBeInTheDocument();
  });

  it('opening in memory mode seeds the input with the active query without clearing the hits', async () => {
    await useGraphStore.getState().runSearch('pricing');
    vi.mocked(api.spotlightSearchMemories).mockClear();
    useGraphStore.setState({ paletteMode: 'memory' });
    renderPalette();
    act(() => { useCommandPaletteStore.setState({ open: true }); });
    const input = await screen.findByLabelText('Search memory');
    expect((input as HTMLInputElement).value).toBe('pricing');
    await new Promise((r) => setTimeout(r, 350));
    expect(api.spotlightSearchMemories).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('memory-hit')).toHaveLength(2);
  });
});

describe('CommandPalette — commands mode', () => {
  beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

  beforeEach(() => {
    vi.clearAllMocks();
    useCommandPaletteStore.setState({ open: false, tasksFetchedAt: 0, commitmentsFetchedAt: 0 });
    useGraphStore.setState({ paletteMode: 'commands', graphMounted: false, focusRequest: null });
    useEntitiesStore.setState({ goals: [], projects: [], people: [], decisions: [], tasks: [], commitments: [] });
    vi.mocked(api.getTasks).mockResolvedValue([{ id: 't1', title: 'Ship pricing page', status: 'IN_PROGRESS' } as never]);
    vi.mocked(api.getCommitments).mockResolvedValue([{ id: 'c1', description: 'Send pricing deck to Ada', status: 'PENDING' } as never]);
  });

  it('caches task / commitment lists for the session and refetches only after the 60 s TTL (L6)', async () => {
    vi.mocked(api.getTasks).mockResolvedValue([]); // a user with zero tasks
    vi.mocked(api.getCommitments).mockResolvedValue([]);
    renderPalette();
    act(() => { useCommandPaletteStore.setState({ open: true }); });
    await waitFor(() => expect(api.getTasks).toHaveBeenCalledTimes(1));
    expect(api.getCommitments).toHaveBeenCalledTimes(1);
    // Close + reopen within the TTL: still empty, but no refetch.
    act(() => { useCommandPaletteStore.getState().close(); });
    act(() => { useCommandPaletteStore.setState({ open: true }); });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getTasks).toHaveBeenCalledTimes(1);
    expect(api.getCommitments).toHaveBeenCalledTimes(1);
    // TTL expired → one refetch on the next open.
    act(() => { useCommandPaletteStore.getState().close(); });
    act(() => { useCommandPaletteStore.setState({ tasksFetchedAt: Date.now() - 61_000, commitmentsFetchedAt: Date.now() - 61_000 }); });
    act(() => { useCommandPaletteStore.setState({ open: true }); });
    await waitFor(() => expect(api.getTasks).toHaveBeenCalledTimes(2));
    expect(api.getCommitments).toHaveBeenCalledTimes(2);
  });

  it('fetches tasks and commitments on open and searches them; picking one focuses the graph node', async () => {
    renderPalette();
    act(() => { useCommandPaletteStore.setState({ open: true }); });
    await waitFor(() => expect(api.getTasks).toHaveBeenCalled());
    await waitFor(() => expect(api.getCommitments).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Search or type a command'), { target: { value: 'pricing' } });
    expect(await screen.findByText('Ship pricing page')).toBeInTheDocument();
    expect(screen.getByText('Send pricing deck to Ada')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Send pricing deck to Ada'));
    expect(screen.getByTestId('location')).toHaveTextContent('/graph?focus=commitment%3Ac1');
  });

  it('"Search memory for …" carries the typed query into memory mode', async () => {
    vi.mocked(api.spotlightSearchMemories).mockResolvedValue({ items: [] as never, nextCursor: null });
    renderPalette();
    act(() => { useCommandPaletteStore.setState({ open: true }); });
    fireEvent.change(screen.getByLabelText('Search or type a command'), { target: { value: 'launch' } });
    fireEvent.click(await screen.findByText(/Search memory for/));
    expect(useGraphStore.getState().paletteMode).toBe('memory');
    await waitFor(() => expect(api.spotlightSearchMemories).toHaveBeenCalledWith({ query: 'launch', limit: 20, asOfDay: null }));
    expect(await screen.findByText('No memories match.')).toBeInTheDocument();
  });
});
