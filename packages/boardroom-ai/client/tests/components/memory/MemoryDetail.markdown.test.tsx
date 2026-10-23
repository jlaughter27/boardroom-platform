/**
 * RD-1 — Memory Detail renders markdown, resolves [[wikilinks]] through the
 * memory's link rows (then by title), opens the target like a card click, and
 * lists backlinks ("Linked from"). Card previews strip markdown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Memory } from '@boardroom/shared';
import * as api from '../../../src/lib/api';
import { MemoryDetail } from '../../../src/components/memory/MemoryDetail';
import { MemoryCard } from '../../../src/components/memory/MemoryCard';
import { useMemoryStore } from '../../../src/stores/memory.store';

vi.mock('../../../src/lib/api', () => ({
  listMemories: vi.fn(),
  getMemory: vi.fn(),
  getMemoryLinks: vi.fn(),
  getMemoryBacklinks: vi.fn(),
  deleteMemoryLink: vi.fn(),
  updateMemory: vi.fn(),
  archiveMemory: vi.fn(),
}));

const addToast = vi.fn();
vi.mock('../../../src/components/ui/Toast', () => ({
  useToastStore: { getState: () => ({ addToast }) },
}));

const mem = (id: string, title: string, content = 'body', extra: Partial<Memory> = {}): Memory =>
  ({
    id, title, content, tags: [], domain: 'business', sector: null, memoryClass: 'SEMANTIC', confidence: 'HIGH', status: 'CONFIRMED',
    importance: 0.5, sourceType: 'API_IMPORT', sourceRef: null, sourceWeight: 1, version: 1, validAt: null, invalidAt: null,
    supersededBy: null, metadata: {}, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', lastAccessedAt: null,
    ...extra,
  } as unknown as Memory);

const PLAYBOOK = mem('m-playbook', 'Pricing playbook', [
  '# Pricing playbook',
  '',
  'Lead with **annual prepay**: [[pricing/Annual prepay terms]], [[Design partners|our design partners]], [[Competitor teardown]].',
  '',
  '| Tier | Price |',
  '|---|---|',
  '| Starter | $29 |',
].join('\n'));
const PARTNERS = mem('m-partners', 'Design partners');
const RETRO = mem('m-retro', 'Q3 pricing retro');
// Not in the explorer list: resolved via its link row + a fetch by id.
const PREPAY = mem('m-prepay', 'Annual prepay terms', 'Prepay **discount** is 2 months.', { metadata: { vault: { path: 'pricing/Annual prepay terms.md' } } } as Partial<Memory>);

beforeEach(() => {
  vi.clearAllMocks();
  useMemoryStore.getState().reset();
  useMemoryStore.setState({ memories: [PLAYBOOK, PARTNERS, RETRO], selectedMemory: PLAYBOOK });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.listMemories).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 5 });
  vi.mocked(api.getMemoryLinks).mockImplementation(async (id: string) => (id === 'm-playbook'
    ? [
      { id: 'l1', memoryId: 'm-playbook', entityType: 'memory', entityId: 'm-prepay', linkType: 'wikilink' },
      { id: 'l2', memoryId: 'm-playbook', entityType: 'memory', entityId: 'm-partners', linkType: 'wikilink' },
    ]
    : []));
  vi.mocked(api.getMemory).mockImplementation(async (id: string) => {
    if (id === 'm-prepay') return PREPAY;
    throw new Error('not found');
  });
  vi.mocked(api.getMemoryBacklinks).mockImplementation(async (id: string) => (id === 'm-playbook'
    ? { items: [{ memoryId: 'm-retro', title: 'Q3 pricing retro', domain: 'business', status: 'CONFIRMED', linkTypes: ['wikilink'] }], truncated: false }
    : { items: [], truncated: false }));
});

function renderSelected() {
  const view = render(<MemoryDetail memory={useMemoryStore.getState().selectedMemory!} />);
  return view;
}

describe('MemoryDetail markdown + wikilinks + backlinks (RD-1)', () => {
  it('renders the content as markdown (bold, table), not raw syntax; drops a leading heading that repeats the title', async () => {
    renderSelected();
    // The renderer chunk is lazy: a skeleton first, then the markdown.
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByTestId('memory-markdown-loading')).toBeNull();
    expect(screen.getByTestId('memory-markdown').querySelector('strong')).toHaveTextContent('annual prepay');
    // `# Pricing playbook` repeats the panel title (h2): not rendered again.
    expect(screen.getAllByText('Pricing playbook')).toHaveLength(1);
    expect(screen.queryByRole('heading', { level: 3, name: 'Pricing playbook' })).toBeNull();
    expect(screen.getByTestId('memory-markdown').textContent).not.toContain('**');
    expect(screen.getByTestId('memory-markdown').textContent).not.toContain('[[');
    await waitFor(() => expect(api.getMemoryBacklinks).toHaveBeenCalledWith('m-playbook'));
  });

  it('resolves a path-style wikilink through its link row (fetching the target), a label by title, and leaves the rest unresolved', async () => {
    renderSelected();
    await waitFor(() => expect(api.getMemory).toHaveBeenCalledWith('m-prepay'));
    await waitFor(() => {
      const prepay = screen.getAllByTestId('wikilink').find((l) => l.textContent === 'Annual prepay terms');
      expect(prepay).toHaveAttribute('data-memory-id', 'm-prepay');
    });
    const partners = screen.getAllByTestId('wikilink').find((l) => l.textContent === 'our design partners')!;
    expect(partners).toHaveAttribute('data-memory-id', 'm-partners');
    const missing = screen.getAllByTestId('wikilink').find((l) => l.textContent?.startsWith('Competitor teardown'))!;
    expect(missing).toHaveAttribute('data-resolved', 'false');
    // Only the target missing from the list was fetched.
    expect(api.getMemory).toHaveBeenCalledTimes(1);
    // The link chip shows the target's title instead of a bare id.
    expect(screen.getByText(/memory:\s*Annual prepay terms/)).toBeInTheDocument();
  });

  it('clicking a wikilink to a listed memory selects it like its card; to an unlisted one, shows the fetched memory', async () => {
    renderSelected();
    const partners = await screen.findByText('our design partners');
    fireEvent.click(partners);
    expect(useMemoryStore.getState().selectedMemory?.id).toBe('m-partners');

    act(() => { useMemoryStore.setState({ selectedMemory: PLAYBOOK }); });
    await waitFor(() => expect(screen.getAllByTestId('wikilink').find((l) => l.textContent === 'Annual prepay terms')).toHaveAttribute('data-resolved', 'true'));
    fireEvent.click(screen.getAllByTestId('wikilink').find((l) => l.textContent === 'Annual prepay terms')!);
    await waitFor(() => expect(useMemoryStore.getState().selectedMemory?.id).toBe('m-prepay'));
    expect(useMemoryStore.getState().selectedMemory?.title).toBe('Annual prepay terms');
  });

  it('a resolved wikilink is keyboard reachable (an anchor with an href)', async () => {
    renderSelected();
    const partners = await screen.findByText('our design partners');
    expect(partners.tagName).toBe('A');
    partners.focus();
    expect(document.activeElement).toBe(partners);
  });

  it('lists backlinks under "Linked from" and opens one on click', async () => {
    renderSelected();
    const backlink = await screen.findByTestId('backlink');
    expect(screen.getByRole('heading', { name: /Linked from \(1\)/ })).toBeInTheDocument();
    expect(backlink).toHaveTextContent('Q3 pricing retro');
    fireEvent.click(backlink);
    expect(useMemoryStore.getState().selectedMemory?.id).toBe('m-retro');
  });

  it('shows an empty and an error state for backlinks', async () => {
    vi.mocked(api.getMemoryBacklinks).mockResolvedValueOnce({ items: [], truncated: false });
    const { unmount } = renderSelected();
    expect(await screen.findByText('No other memory links here yet.')).toBeInTheDocument();
    unmount();
    vi.mocked(api.getMemoryBacklinks).mockRejectedValueOnce(new Error('boom'));
    renderSelected();
    expect(await screen.findByText('Backlinks could not be loaded.')).toBeInTheDocument();
  });

  it('editing still shows the raw markdown source', async () => {
    renderSelected();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const textarea = document.querySelector('textarea')!;
    expect(textarea.value).toContain('[[Competitor teardown]]');
    expect(textarea.value).toContain('| Tier | Price |');
  });
});

describe('MemoryCard preview (RD-1)', () => {
  it('strips markdown syntax and keeps wikilink labels', () => {
    render(<MemoryCard memory={PLAYBOOK} isSelected={false} onClick={vi.fn()} />);
    const preview = screen.getByText(/Lead with annual prepay/);
    expect(preview.textContent).toBe('Lead with annual prepay: Annual prepay terms, our design partners, Competitor teardown. Tier · Price Starter · $29');
    expect(preview.className).toContain('line-clamp-2');
  });
});
