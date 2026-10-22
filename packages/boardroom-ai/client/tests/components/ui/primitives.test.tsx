import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Button } from '../../../src/components/ui/Button';
import { Card } from '../../../src/components/ui/Card';
import { Tabs } from '../../../src/components/ui/Tabs';
import { Toaster, useToastStore } from '../../../src/components/ui/Toast';
import { Progress } from '../../../src/components/ui/Progress';
import { AnimatedCount } from '../../../src/components/ui/AnimatedCount';
import { cn } from '../../../src/lib/cn';

describe('Button', () => {
  it('loading swaps the label for a spinner, sets aria-busy and disables the button', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    // The label stays in the DOM (same grid cell) so the width does not change.
    expect(button.querySelector('[data-slot="label"]')).toHaveTextContent('Save');
    expect(button.querySelector('[data-slot="label"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes glass and capsule variants and never animates everything', () => {
    render(<Button variant="glass" shape="capsule">Glass</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('material');
    expect(button).toHaveClass('rounded-capsule');
    expect(button.className).not.toMatch(/transition-all/);
    expect(button).toHaveClass('active:scale-[0.97]');
  });

  it('keeps the default control radius per size', () => {
    const { rerender } = render(<Button size="sm">S</Button>);
    expect(screen.getByRole('button')).toHaveClass('rounded-md');
    rerender(<Button size="md">M</Button>);
    expect(screen.getByRole('button')).toHaveClass('rounded-control');
  });
});

describe('Card', () => {
  it('publishes concentric-radius variables derived from its padding', () => {
    const { container } = render(<Card className="p-6">x</Card>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.getPropertyValue('--parent-pad')).toBe('1.5rem');
    expect(card.style.getPropertyValue('--parent-radius')).toBe('var(--radius-xl)');
  });

  it('hover is a shadow and hairline step, never a lift', () => {
    const { container } = render(<Card hover>x</Card>);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toMatch(/hover:shadow-md/);
    expect(card.className).not.toMatch(/translate/);
    expect(card.className).not.toMatch(/transition-all/);
  });

  it('maps elevation to the surface ladder', () => {
    const { container } = render(<Card elevation={2}>x</Card>);
    expect(container.firstElementChild).toHaveClass('bg-surface-2');
    expect(container.firstElementChild).toHaveClass('shadow-md');
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'Alpha', content: <p>Alpha body</p> },
    { id: 'b', label: 'Beta', content: <p>Beta body</p> },
  ];

  it('renders tablist semantics and switches panels on click', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} onChange={onChange} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Alpha body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Beta body')).toBeInTheDocument();
    expect(screen.queryByText('Alpha body')).not.toBeInTheDocument();
  });

  it('honours defaultTab', () => {
    render(<Tabs tabs={tabs} defaultTab="b" />);
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Toast', () => {
  it('auto-dismisses after its duration and pauses while hovered', () => {
    vi.useFakeTimers();
    try {
      useToastStore.setState({ toasts: [] });
      render(<Toaster />);
      act(() => { useToastStore.getState().addToast('Profile saved', 'success', 1000); });
      const toast = screen.getByText('Profile saved').closest('[role="status"]') as HTMLElement;
      expect(toast).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(600); });
      fireEvent.pointerEnter(toast);
      act(() => { vi.advanceTimersByTime(2000); });
      // Still there: the timer was paused on hover.
      expect(useToastStore.getState().toasts).toHaveLength(1);

      fireEvent.pointerLeave(toast);
      act(() => { vi.advanceTimersByTime(450); });
      expect(useToastStore.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      useToastStore.setState({ toasts: [] });
    }
  });

  it('has a dismiss button', () => {
    useToastStore.setState({ toasts: [] });
    render(<Toaster />);
    act(() => { useToastStore.getState().addToast('Token revoked', 'info'); });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('numeric readouts', () => {
  it('use tabular figures', () => {
    render(<AnimatedCount value={42} />);
    expect(screen.getByText('42')).toHaveClass('tnum');
    render(<Progress value={33.4} showValue label="Progress" />);
    expect(screen.getByText('33%')).toHaveClass('tnum');
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '33');
  });
});

describe('cn', () => {
  it('lets callers override token-named radii and shadows', () => {
    expect(cn('rounded-control', 'rounded-xl')).toBe('rounded-xl');
    expect(cn('rounded-xl', 'rounded-capsule')).toBe('rounded-capsule');
    expect(cn('shadow-sm', 'shadow-hairline')).toBe('shadow-hairline');
    expect(cn('z-dropdown', 'z-modal')).toBe('z-modal');
  });
});
