import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ModeSelector } from '../../../src/components/decision/ModeSelector';
import { CLIENT_MODE_LIST } from '../../../src/types/debate';

describe('ModeSelector', () => {
  it('is one segmented control with a segment per mode, each carrying a 16 px glyph', () => {
    render(<ModeSelector selectedMode="decide" onSelect={() => {}} />);
    const list = screen.getByRole('tablist', { name: 'Analysis mode' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs).toHaveLength(CLIENT_MODE_LIST.length);
    for (const tab of tabs) {
      const svg = tab.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute('width', '16');
      expect(svg).toHaveAttribute('stroke-width', '1.75');
    }
    expect(screen.getByRole('tab', { name: 'Decide' })).toHaveAttribute('data-active');
  });

  it('reports the picked mode and describes it under the control', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ModeSelector selectedMode="decide" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Pre-mortem' }));
    expect(onSelect).toHaveBeenCalledWith('premortem');

    rerender(<ModeSelector selectedMode="premortem" onSelect={onSelect} />);
    expect(screen.getByText('Assume it failed. Find out why.')).toBeInTheDocument();
    expect(screen.getByText(/personas \+ CEO synthesis|CEO only/)).toBeInTheDocument();
  });
});
