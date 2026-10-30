import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import * as api from '../../src/lib/api';
import { ApiError } from '../../src/lib/api';
import MemoryExplorerPage from '../../src/pages/MemoryExplorerPage';
import { useMemoryStore } from '../../src/stores/memory.store';

/**
 * `/memory?id=<id>` (and `/memory/:id`, which redirects here) opens the
 * explorer with that memory selected — even when it is not on the first page
 * of the list. An id that does not resolve shows "Memory not found" instead of
 * an empty detail pane or a redirect home. Invented data only.
 */

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>();
  return { ...actual, listMemories: vi.fn(), hybridSearchMemories: vi.fn(), getMemory: vi.fn() };
});
vi.mock('../../src/components/memory/MemorySearch', () => ({ MemorySearch: () => null }));
vi.mock('../../src/components/memory/MemoryList', () => ({ MemoryList: () => null }));
vi.mock('../../src/components/memory/MemoryDetail', () => ({
  MemoryDetail: ({ memory }: { memory: { title: string } }) => <p data-testid="detail">{memory.title}</p>,
}));

const listed = { id: 'm1', title: 'Pricing notes', content: 'Invented', domain: 'business', tags: [], status: 'CONFIRMED' };
const deep = { id: 'm-deep', title: 'Hiring plan for Q3', content: 'Invented', domain: 'business', tags: [], status: 'CONFIRMED' };

function Search() {
  return <p data-testid="search">{useLocation().search}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MemoryExplorerPage />
      <Search />
    </MemoryRouter>,
  );
}

describe('MemoryExplorerPage — ?id= deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMemoryStore.getState().reset();
    vi.mocked(api.listMemories).mockResolvedValue({ items: [listed], total: 1, offset: 0, limit: 20 } as never);
  });

  it('selects a memory that is not on the first page by fetching it', async () => {
    vi.mocked(api.getMemory).mockResolvedValue(deep as never);
    renderAt('/memory?id=m-deep');
    expect(await screen.findByTestId('detail')).toHaveTextContent('Hiring plan for Q3');
    expect(api.getMemory).toHaveBeenCalledWith('m-deep');
  });

  it('an unknown id shows a clear "Memory not found" state', async () => {
    vi.mocked(api.getMemory).mockRejectedValue(new ApiError('Not found', 404));
    renderAt('/memory?id=m-missing');
    expect(await screen.findByRole('heading', { name: 'Memory not found' })).toBeInTheDocument();
    expect(screen.getByTestId('memory-not-found')).toHaveTextContent('m-missing');
    expect(screen.queryByTestId('detail')).not.toBeInTheDocument();
  });

  it('a server error is reported as an error, not as "not found"', async () => {
    vi.mocked(api.getMemory).mockRejectedValue(new ApiError('Request failed: 503', 503));
    renderAt('/memory?id=m-deep');
    expect(await screen.findByText('Request failed: 503')).toBeInTheDocument();
    expect(screen.queryByTestId('memory-not-found')).not.toBeInTheDocument();
  });

  it('Close clears the selection and drops ?id from the URL', async () => {
    vi.mocked(api.getMemory).mockResolvedValue(deep as never);
    renderAt('/memory?id=m-deep');
    await screen.findByTestId('detail');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('detail')).not.toBeInTheDocument());
    expect(screen.getByTestId('search')).toHaveTextContent(/^$/);
  });

  it('no ?id → no fetch, the usual empty detail pane', async () => {
    renderAt('/memory');
    expect(await screen.findByText('Select a memory to view details')).toBeInTheDocument();
    expect(api.getMemory).not.toHaveBeenCalled();
  });
});
