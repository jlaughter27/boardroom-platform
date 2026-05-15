import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { Toaster, useToastStore } from '../../../src/components/ui/Toast';

function resetStore() {
  useToastStore.setState({ toasts: [] });
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  it('renders a toast and assigns correct ARIA per variant', () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().addToast('Saved', 'success');
    });
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('error variant uses role="alert" + aria-live=assertive', () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().addToast('Boom', 'error');
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('auto-dismisses after 4 seconds (toast removed from store)', () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().addToast('Auto', 'info');
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    // The store entry is dropped; AnimatePresence may still render the exit
    // frame, but the data layer truth is what matters.
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('pauses auto-dismiss while hovered, resumes on leave', () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().addToast('Hover me', 'info');
    });
    const toast = screen.getByText('Hover me').closest('[role="status"]')!;
    // Advance halfway then hover
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.mouseEnter(toast);
    // Advance well past the original 4s — should still be present in store
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    // Leave, then advance remainder (~2s)
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(2100); });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('dismiss button removes toast immediately from store', () => {
    render(<Toaster />);
    act(() => {
      useToastStore.getState().addToast('Close me', 'info');
    });
    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
