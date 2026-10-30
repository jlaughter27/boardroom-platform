import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GraphControls, type GraphFilters } from '../../../src/components/graph/GraphControls';
import { NODE_TYPES } from '../../../src/components/graph/graph-theme';
import { EDGE_TYPES } from '../../../src/components/graph/graph-filters';
import { node } from './fixtures';

const counts = { goal: 1, project: 2, task: 3, person: 4, decision: 5, commitment: 6, memory: 7 };
const baseFilters = (): GraphFilters => ({
  types: new Set(NODE_TYPES), edgeTypes: new Set(EDGE_TYPES), domain: 'all', showOrphans: false, showLabels: true, depth: 2,
});

function setup(filters = baseFilters()) {
  const onChange = vi.fn();
  const onPick = vi.fn();
  const onFit = vi.fn();
  const onSpotlight = vi.fn();
  render(
    <GraphControls
      filters={filters} onChange={onChange} counts={counts} edgeCounts={{ memory_entity: 9, goal_project: 2 }} domains={['business', 'personal']}
      nodes={[node('project:alpha', { label: 'Alpha launch' }), node('memory:beta', { label: 'Beta notes' })]}
      hasSelection onPick={onPick} onFit={onFit} onSpotlight={onSpotlight}
    />,
  );
  return { onChange, onPick, onFit, onSpotlight };
}

describe('GraphControls', () => {
  it('toggles an edge type off (and back on) through the Links chips', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Links/ }));
    const chip = screen.getByRole('button', { name: /Memory → entity/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveTextContent('9');
    fireEvent.click(chip);
    const next = onChange.mock.calls[0][0] as GraphFilters;
    expect(next.edgeTypes.has('memory_entity')).toBe(false);
    expect(next.edgeTypes.size).toBe(EDGE_TYPES.length - 1);
  });

  it('never removes the last remaining edge type', () => {
    const f = baseFilters();
    f.edgeTypes = new Set(['goal_project']);
    const { onChange } = setup(f);
    fireEvent.click(screen.getByRole('button', { name: /^Links/ }));
    fireEvent.click(screen.getByRole('button', { name: /Goal → project/ }));
    const next = onChange.mock.calls[0][0] as GraphFilters;
    expect(next.edgeTypes.has('goal_project')).toBe(true);
    // "All links" restores the full set
    fireEvent.click(screen.getByRole('button', { name: 'All links' }));
    expect((onChange.mock.calls[1][0] as GraphFilters).edgeTypes.size).toBe(EDGE_TYPES.length);
  });

  it('Local / Global toggle maps onto depth (0 = global, 2 = local default)', () => {
    const { onChange } = setup();
    expect(screen.getByRole('button', { name: 'Local' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Global' }));
    expect((onChange.mock.calls[0][0] as GraphFilters).depth).toBe(0);
    const f = baseFilters(); f.depth = 0;
    onChange.mockClear();
    render(<GraphControls filters={f} onChange={onChange} counts={counts} domains={[]} nodes={[]} hasSelection={false} onPick={vi.fn()} onFit={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Local' })[1]);
    expect((onChange.mock.calls[0][0] as GraphFilters).depth).toBe(2);
  });

  it('the node finder picks a node and the spotlight button opens memory search', () => {
    const { onPick, onSpotlight } = setup();
    const input = screen.getByLabelText('Search graph nodes');
    fireEvent.change(input, { target: { value: 'beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('memory:beta');
    fireEvent.click(screen.getByRole('button', { name: /Search memory/ }));
    expect(onSpotlight).toHaveBeenCalled();
  });

  it('type chips keep at least one type on', () => {
    const f = baseFilters(); f.types = new Set(['goal']);
    const { onChange } = setup(f);
    fireEvent.click(screen.getByRole('button', { name: /Goals/ }));
    expect((onChange.mock.calls[0][0] as GraphFilters).types.has('goal')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Projects/ }));
    expect((onChange.mock.calls[1][0] as GraphFilters).types.has('project')).toBe(true);
  });

  // Lane I · item 3 — the type chips (legend + filter) were seven tab stops.
  it('the node-type chips are one tab stop with arrow-key navigation', () => {
    setup();
    const group = screen.getByRole('toolbar', { name: 'Node types' });
    const chips = Array.from(group.querySelectorAll('button'));
    expect(chips).toHaveLength(NODE_TYPES.length);
    expect(chips.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    chips[0].focus();
    fireEvent.keyDown(chips[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(chips[1]);
    fireEvent.keyDown(chips[1], { key: 'End' });
    expect(document.activeElement).toBe(chips[chips.length - 1]);
    expect(chips.filter((b) => b.tabIndex === 0)).toEqual([chips[chips.length - 1]]);
  });
});
