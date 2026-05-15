import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../../src/components/ui/Button';

describe('Button', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('bg-primary'); // default variant
    expect(button).toHaveClass('h-9'); // default size (md)
  });

  it('renders with different variants', () => {
    const { rerender } = render(<Button variant="primary">Primary</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-primary');

    rerender(<Button variant="secondary">Secondary</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-card');

    rerender(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole('button')).toHaveClass('text-muted-foreground');

    rerender(<Button variant="danger">Danger</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-destructive');
  });

  it('renders with different sizes', () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-8');

    rerender(<Button size="md">Medium</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-9');

    rerender(<Button size="lg">Large</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-11');
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveClass('disabled:pointer-events-none');
    expect(button).toHaveClass('disabled:opacity-50');
  });

  it('passes additional props to button element', () => {
    render(
      <Button data-testid="custom-button" aria-label="Custom label">
        Custom
      </Button>
    );
    const button = screen.getByTestId('custom-button');
    expect(button).toHaveAttribute('aria-label', 'Custom label');
  });

  it('danger and success hover variants DARKEN (not lighten) — audit P0 #12/#13', () => {
    const { rerender } = render(<Button variant="danger">Danger</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/hover:bg-red-700/);
    expect(btn.className).not.toMatch(/hover:bg-red-400/);
    rerender(<Button variant="success">Success</Button>);
    expect(screen.getByRole('button').className).toMatch(/hover:bg-emerald-700/);
  });

  it('uses rounded-md across all sizes (canonical control radius)', () => {
    const { rerender } = render(<Button size="sm">sm</Button>);
    expect(screen.getByRole('button')).toHaveClass('rounded-md');
    rerender(<Button size="md">md</Button>);
    expect(screen.getByRole('button')).toHaveClass('rounded-md');
    rerender(<Button size="lg">lg</Button>);
    expect(screen.getByRole('button')).toHaveClass('rounded-md');
  });

  it('loading prop disables the button and sets aria-busy', () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('combines custom className with variant classes', () => {
    render(
      <Button className="custom-class" variant="secondary">
        Combined
      </Button>
    );
    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-card'); // from variant
    expect(button).toHaveClass('custom-class'); // from className prop
  });
});
