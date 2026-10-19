import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '../../../src/lib/api';
import { MemorySearch, collectTagChips } from '../../../src/components/memory/MemorySearch';
import { MemoryList } from '../../../src/components/memory/MemoryList';
import { useMemoryStore } from '../../../src/stores/memory.store';
import type { Memory } from '@boardroom/shared';

vi.mock('../../../src/lib/api', () => ({
  listMemories: vi.fn(),
  hybridSearchMemories: vi.fn(),
  updateMemory: vi.fn(),
  archiveMemory: vi.fn(),
}));

vi.mock('../../../src/components/ui/Toast', () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

const mem = (id: string, tags: string[]): Memory =>
  ({ id, title: `Memory ${id}`, content: 'body', tags, domain: 'business', memoryClass: 'SEMANTIC', confidence: 'HIGH', status: 'CONFIRMED', importance: 0.5, createdAt: '2026-08-01T00:00:00.000Z' } as unknown as Memory);

describe('collectTagChips', () => {
  it('orders tags by frequency then name, keeps selected ones first and caps the list', () => {
    const chips = collectTagChips([{ tags: ['b', 'a'] }, { tags: ['a', 'c'] }, { tags: ['a'] }], ['zzz'], 3);
    expect(chips).toEqual(['zzz', 'a', 'b']);
  });
});

describe('MemorySearch — hybrid filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMemoryStore.getState().reset();
    useMemoryStore.setState({ engine: 'hybrid', filters: { q: 'pricing' }, memories: [mem('1', ['sales', 'q3']), mem('2', ['sales'])], hybridActive: true, scores: { '1': 0.82 }, layers: { '1': ['semantic', 'fts'] } });
    vi.mocked(api.hybridSearchMemories).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(api.listMemories).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 20 });
  });

  it('renders tag chips from the results and a tag toggle re-searches the hybrid endpoint with tags', async () => {
    render(<MemorySearch />);
    const sales = screen.getByRole('button', { name: '#sales' });
    expect(screen.getByRole('button', { name: '#q3' })).toBeInTheDocument();
    fireEvent.click(sales);
    await waitFor(() => expect(api.hybridSearchMemories).toHaveBeenCalledWith(expect.objectContaining({ query: 'pricing', tags: ['sales'] })));
    expect(api.listMemories).not.toHaveBeenCalled();
  });

  it('as-of date and include-archived pass through to the hybrid endpoint and show a chip', async () => {
    render(<MemorySearch />);
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-08-12' } });
    await waitFor(() => expect(api.hybridSearchMemories).toHaveBeenLastCalledWith(expect.objectContaining({ asOf: '2026-08-12T23:59:59.999Z' })));
    expect(screen.getByTestId('memory-asof-chip')).toHaveTextContent('as of 12 Aug 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Include archived' }));
    await waitFor(() => expect(api.hybridSearchMemories).toHaveBeenLastCalledWith(expect.objectContaining({ includeArchived: true, asOf: '2026-08-12T23:59:59.999Z' })));
    expect(screen.getByRole('button', { name: 'Include archived' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the hybrid badge while results come from hybrid search', () => {
    render(<MemorySearch />);
    expect(screen.getByText('hybrid')).toBeInTheDocument();
  });

  it('greys out the controls the hybrid endpoint ignores (class, sort) while hybrid results are shown (M5)', () => {
    render(<MemorySearch />);
    expect(screen.getByLabelText('Memory class')).toBeDisabled();
    expect(screen.getByLabelText('Memory class')).toHaveAttribute('title', expect.stringMatching(/Not applied by hybrid search/));
    expect(screen.getByLabelText('Sort by')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Desc|Asc/ })).toBeDisabled();
    expect(screen.getByLabelText('Status')).toBeEnabled(); // status IS forwarded to hybrid
    expect(screen.getByLabelText('As of date')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Include archived' })).toBeInTheDocument();
  });

  it('hides as-of / include-archived (which the list endpoint ignores) while the list endpoint answers (M5)', () => {
    useMemoryStore.setState({ hybridActive: false, filters: {}, memories: [] });
    render(<MemorySearch />);
    expect(screen.queryByLabelText('As of date')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Include archived' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Memory class')).toBeEnabled();
    expect(screen.getByLabelText('Sort by')).toBeEnabled();
  });

  it('a stale as-of chip stays clearable in list mode', () => {
    useMemoryStore.setState({ hybridActive: false, filters: { asOf: '2026-08-12' }, memories: [] });
    render(<MemorySearch />);
    expect(screen.getByTestId('memory-asof-chip')).toHaveTextContent('as of 12 Aug 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Clear as-of date' }));
    expect(useMemoryStore.getState().filters.asOf).toBeUndefined();
  });
});

describe('MemoryList — hybrid results', () => {
  beforeEach(() => {
    useMemoryStore.getState().reset();
  });

  it('shows the match score and layers per card and pages by cursor', () => {
    useMemoryStore.setState({ engine: 'hybrid', hybridActive: true, memories: [mem('1', []), mem('2', [])], scores: { '1': 0.82, '2': 0.4 }, layers: { '1': ['semantic', 'fts'] }, nextCursor: 'c1', total: 2, offset: 2 });
    render(<MemoryList />);
    const scores = screen.getAllByTestId('memory-score');
    expect(scores.map((s) => s.textContent)).toEqual(['82%', '40%']);
    expect(screen.getByTestId('memory-layers')).toHaveTextContent('semantic · fts');
    expect(screen.getByRole('button', { name: 'Load more results' })).toBeInTheDocument();
  });

  it('list results show no score and use offset paging', () => {
    useMemoryStore.setState({ hybridActive: false, memories: [mem('1', [])], total: 5, offset: 1 });
    render(<MemoryList />);
    expect(screen.queryByTestId('memory-score')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more (4 remaining)' })).toBeInTheDocument();
  });
});
