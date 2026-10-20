import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EntityPicker } from '../../../src/components/graph/EntityPicker';

const options = [
  { id: '1', label: 'Ada Lovelace', hint: 'engineer' },
  { id: '2', label: 'Grace Hopper', hint: null },
  { id: '3', label: 'Alan Turing' },
];

describe('EntityPicker', () => {
  it('filters as you type, hides excluded ids, and picks with Enter', () => {
    const onPick = vi.fn();
    render(<EntityPicker options={options} exclude={new Set(['3'])} placeholder="Search people…" onPick={onPick} />);
    const input = screen.getByRole('combobox', { name: 'Search people…' });
    fireEvent.focus(input);
    expect(screen.getAllByRole('option')).toHaveLength(2); // Alan excluded
    fireEvent.change(input, { target: { value: 'ada' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('engineer')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(options[0]);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('arrow keys move the active option and the mouse picks', () => {
    const onPick = vi.fn();
    render(<EntityPicker options={options} placeholder="Pick" onPick={onPick} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const opts = screen.getAllByRole('option');
    expect(opts[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.mouseDown(opts[2]);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ label: 'Grace Hopper' }));
  });

  it('shows "No matches" for an unknown query and Escape closes the list', () => {
    render(<EntityPicker options={options} placeholder="Pick" onPick={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'a' } });
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
