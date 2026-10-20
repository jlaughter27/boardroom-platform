import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Modal } from '../../../src/components/shared/Modal';

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
