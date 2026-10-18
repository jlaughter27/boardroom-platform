import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '../../../src/lib/api';
import { UnlinkedMentionsPanel } from '../../../src/components/graph/UnlinkedMentionsPanel';

vi.mock('../../../src/lib/api', () => ({
  getUnlinkedMentions: vi.fn(),
  linkUnlinkedMention: vi.fn(),
}));

const addToast = vi.fn();
vi.mock('../../../src/components/ui', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
  useToastStore: { getState: () => ({ addToast }) },
}));

const items = [
  { memoryId: 'm1', memoryTitle: 'Standup notes', entityType: 'person' as const, entityId: 'p1', entityLabel: 'Ada', snippet: 'Ada said…' },
  { memoryId: 'm2', memoryTitle: 'Roadmap', entityType: 'project' as const, entityId: 'pr1', entityLabel: 'Pricing', snippet: '' },
];

describe('UnlinkedMentionsPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('loads mentions, reports the count, links one and removes it from the list', async () => {
    vi.mocked(api.getUnlinkedMentions).mockResolvedValue({ items });
    vi.mocked(api.linkUnlinkedMention).mockResolvedValue(undefined);
    const onLinked = vi.fn(); const onCount = vi.fn(); const onSelectNode = vi.fn();
    render(<UnlinkedMentionsPanel onLinked={onLinked} onCount={onCount} onSelectNode={onSelectNode} onClose={vi.fn()} />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    await screen.findByText('Ada');
    expect(onCount).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: 'Ada' }));
    expect(onSelectNode).toHaveBeenCalledWith('person:p1');

    fireEvent.click(screen.getAllByRole('button', { name: 'Link' })[0]);
    await waitFor(() => expect(api.linkUnlinkedMention).toHaveBeenCalledWith({ memoryId: 'm1', entityType: 'person', entityId: 'p1' }));
    await waitFor(() => expect(screen.queryByText('Ada')).not.toBeInTheDocument());
    expect(onLinked).toHaveBeenCalled();
    expect(onCount).toHaveBeenLastCalledWith(1);
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('Linked'), 'success');
  });

  it('shows the empty state and surfaces load errors', async () => {
    vi.mocked(api.getUnlinkedMentions).mockResolvedValueOnce({ items: [] });
    const { unmount } = render(<UnlinkedMentionsPanel onLinked={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/already linked/);
    unmount();
    vi.mocked(api.getUnlinkedMentions).mockRejectedValueOnce(new Error('nope'));
    render(<UnlinkedMentionsPanel onLinked={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('nope');
  });

  it('keeps the row and toasts when linking fails; close calls back', async () => {
    vi.mocked(api.getUnlinkedMentions).mockResolvedValue({ items: [items[1]] });
    vi.mocked(api.linkUnlinkedMention).mockRejectedValue(new Error('conflict'));
    const onClose = vi.fn();
    render(<UnlinkedMentionsPanel onLinked={vi.fn()} onClose={onClose} />);
    await screen.findByText('Pricing');
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('conflict', 'error'));
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close unlinked mentions' }));
    expect(onClose).toHaveBeenCalled();
  });
});
