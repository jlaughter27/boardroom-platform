import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Tooltip, TooltipProvider } from '../../../src/components/ui/Tooltip';

function renderWithProvider(ui: React.ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe('Tooltip (Radix-backed)', () => {
  it('hides tooltip content by default', () => {
    renderWithProvider(
      <Tooltip content="Helper">
        <button>Trigger</button>
      </Tooltip>
    );
    expect(screen.queryByText('Helper')).toBeNull();
  });

  it('shows tooltip content with role="tooltip" after focus', async () => {
    renderWithProvider(
      <Tooltip content="Helper">
        <button>Trigger</button>
      </Tooltip>
    );
    const trigger = screen.getByRole('button', { name: /trigger/i });
    fireEvent.focus(trigger);
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent('Helper');
    });
  });

  it('disabled prop suppresses the tooltip entirely', () => {
    renderWithProvider(
      <Tooltip content="Helper" disabled>
        <button>Trigger</button>
      </Tooltip>
    );
    const trigger = screen.getByRole('button');
    fireEvent.focus(trigger);
    // No tooltip rendered at all.
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('empty content suppresses the tooltip', () => {
    renderWithProvider(
      <Tooltip content="">
        <button>Trigger</button>
      </Tooltip>
    );
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
