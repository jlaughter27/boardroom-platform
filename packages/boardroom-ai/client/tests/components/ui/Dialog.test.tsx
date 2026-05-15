import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from '../../../src/components/ui/Dialog';

describe('Dialog (Radix-backed)', () => {
  it('does not render content when closed', () => {
    render(
      <Dialog open={false} onOpenChange={() => {}} title="Hi">
        <p>body</p>
      </Dialog>
    );
    expect(screen.queryByText('body')).toBeNull();
  });

  it('renders title, description and body when open', () => {
    render(
      <Dialog open onOpenChange={() => {}} title="My title" description="My desc">
        <p>body</p>
      </Dialog>
    );
    expect(screen.getByText('My title')).toBeInTheDocument();
    expect(screen.getByText('My desc')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('exposes role="dialog" with aria-labelled-by linked to title', () => {
    render(
      <Dialog open onOpenChange={() => {}} title="Labelled" description="d">
        <p>body</p>
      </Dialog>
    );
    const dialog = screen.getByRole('dialog');
    // Radix Dialog sets role="dialog" — modal behavior is enforced via focus
    // trap + portal, not the `aria-modal` attribute (which is not always set
    // in the DOM tree in jsdom).
    expect(dialog).toBeInTheDocument();
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Labelled');
  });

  it('Escape key triggers onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Esc test" description="d">
        <p>body</p>
      </Dialog>
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('close button is labelled and dismisses', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Close test" description="d">
        <p>body</p>
      </Dialog>
    );
    const closeBtn = screen.getByRole('button', { name: /close dialog/i });
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hideClose=true hides the close button', () => {
    render(
      <Dialog open onOpenChange={() => {}} title="No-close" description="d" hideClose>
        <p>body</p>
      </Dialog>
    );
    expect(screen.queryByRole('button', { name: /close dialog/i })).toBeNull();
  });
});
