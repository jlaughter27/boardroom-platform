import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CHORD_TIMEOUT_MS, useKeyboardShortcuts } from '../../src/hooks/useKeyboardShortcuts';
import { useCommandPaletteStore } from '../../src/stores/commandPalette.store';
import { useGraphStore } from '../../src/stores/graph.store';

function Harness() {
  const shortcuts = useKeyboardShortcuts();
  return (
    <div>
      <input aria-label="field" />
      <ul>{shortcuts.map((s) => <li key={s.label}>{s.label}: {s.description}</li>)}</ul>
    </div>
  );
}

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });

describe('useKeyboardShortcuts — `g m` chord (L7)', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ open: false });
    useGraphStore.setState({ paletteMode: 'commands' });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('g then m opens the palette in memory-search mode, like ⌘⇧K', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    key('g');
    expect(useCommandPaletteStore.getState().open).toBe(false); // a lone g does nothing
    key('m');
    expect(useCommandPaletteStore.getState().open).toBe(true);
    expect(useGraphStore.getState().paletteMode).toBe('memory');
    // ⌘⇧K is still bound.
    useCommandPaletteStore.setState({ open: false });
    useGraphStore.setState({ paletteMode: 'commands' });
    key('k', { metaKey: true, shiftKey: true });
    expect(useCommandPaletteStore.getState().open).toBe(true);
    expect(useGraphStore.getState().paletteMode).toBe('memory');
  });

  it('the chord expires, needs plain keys, and is ignored while typing', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(10_000);
    key('g');
    now.mockReturnValue(10_000 + CHORD_TIMEOUT_MS + 1);
    key('m');
    expect(useCommandPaletteStore.getState().open).toBe(false);

    now.mockReturnValue(20_000);
    key('g');
    key('m', { shiftKey: true }); // not a plain m
    expect(useCommandPaletteStore.getState().open).toBe(false);

    const input = screen.getByLabelText('field');
    fireEvent.keyDown(input, { key: 'g' });
    fireEvent.keyDown(input, { key: 'm' });
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it('is listed for the shortcuts modal', () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    expect(screen.getByText(/G then M: Search memory/)).toBeInTheDocument();
  });
});
