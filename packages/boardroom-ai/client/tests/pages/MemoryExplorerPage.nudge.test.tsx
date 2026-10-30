import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MemoryStatus } from '@boardroom/shared';
import * as api from '../../src/lib/api';
import MemoryExplorerPage from '../../src/pages/MemoryExplorerPage';
import { useMemoryStore } from '../../src/stores/memory.store';

/**
 * H1c (2026-10-30): the "Review Memories" nudge sent `status=ACTIVE`, which is
 * not a MemoryStatus — OmniMind answered 500 (now 422) and five clicks could
 * open BoardRoom's shared circuit breaker. It must only send valid filters.
 */

vi.mock('../../src/lib/api', () => ({
  listMemories: vi.fn(),
  hybridSearchMemories: vi.fn(),
}));
vi.mock('../../src/components/memory/MemorySearch', () => ({ MemorySearch: () => null }));
vi.mock('../../src/components/memory/MemoryList', () => ({ MemoryList: () => null }));
vi.mock('../../src/components/memory/MemoryDetail', () => ({ MemoryDetail: () => null }));

const memory = { id: 'm1', title: 'Pricing notes', content: 'Invented', domain: 'business', tags: [], status: 'CONFIRMED' };

describe('MemoryExplorerPage — Review Memories nudge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMemoryStore.getState().reset();
    vi.mocked(api.listMemories).mockResolvedValue({ items: [memory], total: 1, offset: 0, limit: 20 } as never);
  });

  it('lists live memories without an invalid status filter', async () => {
    render(<MemoryRouter><MemoryExplorerPage /></MemoryRouter>);
    const button = await screen.findByRole('button', { name: 'Review Memories' });
    vi.mocked(api.listMemories).mockClear();

    fireEvent.click(button);

    await waitFor(() => expect(api.listMemories).toHaveBeenCalledTimes(1));
    const params = vi.mocked(api.listMemories).mock.calls[0][0] ?? {};
    const validStatuses: string[] = Object.values(MemoryStatus);
    if (params.status !== undefined) expect(validStatuses).toContain(params.status);
    expect(params.status).toBeUndefined();
  });
});
