import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal, SHEET_DISMISS_OFFSET, SHEET_DISMISS_VELOCITY, shouldDismissSheet } from '../../../src/components/shared/Modal';

describe('Modal — sheet variant', () => {
  it('renders as a sheet with a scrolling body and no drag grabber on a desktop viewport', () => {
    render(
      <Modal isOpen onClose={() => {}} title="CEO Synthesis" variant="sheet" size="lg">
        <p>Report</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog', { name: 'CEO Synthesis' });
    expect(dialog).toHaveAttribute('data-variant', 'sheet');
    // matchMedia is mocked to `matches: false` (≥ 640 px), so there is nothing to drag.
    expect(screen.queryByTestId('sheet-grabber')).toBeNull();
    expect(screen.getByText('Report').parentElement?.className).toContain('overflow-y-auto');
  });

  it('dismisses past 120 px of travel or a 600 px/s flick, otherwise settles back', () => {
    expect(SHEET_DISMISS_OFFSET).toBe(120);
    expect(SHEET_DISMISS_VELOCITY).toBe(600);
    expect(shouldDismissSheet({ offset: { x: 0, y: 121 }, velocity: { x: 0, y: 0 } })).toBe(true);
    expect(shouldDismissSheet({ offset: { x: 0, y: 40 }, velocity: { x: 0, y: 601 } })).toBe(true);
    expect(shouldDismissSheet({ offset: { x: 0, y: 119 }, velocity: { x: 0, y: 599 } })).toBe(false);
    expect(shouldDismissSheet({ offset: { x: 0, y: -200 }, velocity: { x: 0, y: -900 } })).toBe(false);
  });

  it('shows header actions before the close button', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Sheet" variant="sheet" headerActions={<button type="button">Export</button>}>
        <p>Body</p>
      </Modal>
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Export', 'Close modal']);
  });
});

describe('Modal', () => {
  it('renders a labelled dialog with its content when open', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Customize Dashboard">
        <p>Body copy</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog', { name: 'Customize Dashboard' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Body copy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Customize Dashboard' })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="Hidden">
        <p>Body copy</p>
      </Modal>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Body copy')).not.toBeInTheDocument();
  });

  it('calls onClose from the close button and from Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Shortcuts">
        <button type="button">Inside</button>
      </Modal>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it('moves focus into the dialog when it opens', async () => {
    render(
      <Modal isOpen onClose={() => {}} title="Focus">
        <button type="button">First action</button>
      </Modal>
    );
    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it('wires an optional description', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Review" description="Scheduled 12 days ago">
        <p>Body</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleDescription('Scheduled 12 days ago');
  });
});
