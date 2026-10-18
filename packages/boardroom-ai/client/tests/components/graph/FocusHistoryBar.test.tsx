import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FocusHistoryBar } from '../../../src/components/graph/FocusHistoryBar';
import { SpotlightBar } from '../../../src/components/graph/SpotlightBar';
import { createFocusHistory, goBack, pushFocus } from '../../../src/components/graph/graph-focus';
import { node } from './fixtures';

const nodesById = new Map([node('goal:g', { label: 'Grow' }), node('project:p', { label: 'Pricing' }), node('memory:m', { label: 'Notes' })].map((n) => [n.id, n]));

describe('FocusHistoryBar', () => {
  it('renders breadcrumbs with the current entry marked and wires back / forward', () => {
    let h = createFocusHistory();
    for (const id of ['goal:g', 'project:p', 'memory:m']) h = pushFocus(h, id);
    h = goBack(h); // current = project:p
    const onBack = vi.fn(); const onForward = vi.fn(); const onCrumb = vi.fn();
    render(<FocusHistoryBar history={h} nodesById={nodesById} onBack={onBack} onForward={onForward} onCrumb={onCrumb} />);
    const crumbs = within(screen.getByTestId('focus-breadcrumbs')).getAllByRole('button');
    expect(crumbs.map((c) => c.textContent)).toEqual(['Grow', 'Pricing']);
    expect(crumbs[1]).toHaveAttribute('aria-current', 'location');
    fireEvent.click(crumbs[0]);
    expect(onCrumb).toHaveBeenCalledWith('goal:g');
    fireEvent.click(screen.getByRole('button', { name: /Back to previous focus/ }));
    fireEvent.click(screen.getByRole('button', { name: /Forward to next focus/ }));
    expect(onBack).toHaveBeenCalled();
    expect(onForward).toHaveBeenCalled();
  });

  it('disables back at the start, forward at the end, and renders nothing when empty', () => {
    const h = pushFocus(createFocusHistory(), 'goal:g');
    const { container, rerender } = render(<FocusHistoryBar history={h} nodesById={nodesById} onBack={vi.fn()} onForward={vi.fn()} onCrumb={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Back to previous focus/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Forward to next focus/ })).toBeDisabled();
    rerender(<FocusHistoryBar history={createFocusHistory()} nodesById={nodesById} onBack={vi.fn()} onForward={vi.fn()} onCrumb={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SpotlightBar', () => {
  const spotlight = {
    query: 'pricing', asOf: '2026-08-12', hits: [{ nodeId: 'memory:a' }, { nodeId: 'memory:b' }] as never, nextCursor: 'c1', loading: false, error: null, active: true, filterToResults: false,
  };

  it('shows hit count, the as-of chip, and routes the actions', () => {
    const onToggleFilter = vi.fn(); const onLoadMore = vi.fn(); const onFit = vi.fn(); const onEdit = vi.fn(); const onClear = vi.fn();
    render(<SpotlightBar spotlight={spotlight} loadedHits={1} fetchingMissing onToggleFilter={onToggleFilter} onLoadMore={onLoadMore} onFit={onFit} onEdit={onEdit} onClear={onClear} />);
    expect(screen.getByTestId('spotlight-bar')).toHaveTextContent('2 hits for “pricing”');
    expect(screen.getByTestId('spotlight-bar')).toHaveTextContent('1 in view, fetching the rest…');
    expect(screen.getByTestId('asof-chip')).toHaveTextContent('as of 12 Aug 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Filter to results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit hits' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    fireEvent.click(screen.getByRole('button', { name: '“pricing”' }));
    expect(onToggleFilter).toHaveBeenCalled();
    expect(onLoadMore).toHaveBeenCalled();
    expect(onFit).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
    expect(onEdit).toHaveBeenCalled();
  });

  it('reflects the filter state and hides load-more without a cursor', () => {
    render(<SpotlightBar spotlight={{ ...spotlight, asOf: null, nextCursor: null, filterToResults: true }} loadedHits={2} fetchingMissing={false} onToggleFilter={vi.fn()} onLoadMore={vi.fn()} onFit={vi.fn()} onEdit={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Filter to results' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('asof-chip')).not.toBeInTheDocument();
  });
});
