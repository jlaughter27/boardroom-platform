import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonaCard } from '../../../src/components/decision/PersonaCard';

/** M1-C2 — a failed advisor gets an error card with Retry, never "Thinking...". */

describe('PersonaCard — failed advisor (M1-C2)', () => {
  it('renders the error, a Retry button, and no "Thinking..."', () => {
    const onRetry = vi.fn();
    render(<PersonaCard personaId="critic" isStreaming={false} error="Persona response failed validation" onRetry={onRetry} />);
    const card = screen.getByTestId('persona-card');
    expect(card.dataset.state).toBe('error');
    expect(card.className).toContain('min-h-[32rem]');
    expect(screen.getByText(/The Critic couldn.t finish/)).toBeInTheDocument();
    expect(screen.getByTestId('persona-error-detail')).toHaveTextContent('Persona response failed validation');
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Retry is disabled, with the reason, while another dispatch is streaming', () => {
    render(<PersonaCard personaId="critic" isStreaming={false} error="boom" onRetry={() => {}} retryDisabled />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(screen.getByText('Available when the other advisors finish.')).toBeInTheDocument();
  });

  it('a retry in flight shows the streaming card, not the error', () => {
    render(<PersonaCard personaId="critic" isStreaming streamingText="" error="boom" onRetry={() => {}} />);
    expect(screen.getByTestId('persona-card').dataset.state).toBe('streaming');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a queued advisor waits on a static skeleton: no "Thinking..." and no endless animation', () => {
    const { container } = render(<PersonaCard personaId="critic" isStreaming={false} />);
    expect(screen.getByTestId('persona-card').dataset.state).toBe('waiting');
    expect(screen.getByText('Waiting to start')).toBeInTheDocument();
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument();
    expect(container.querySelector('[style*="opacity"]')).toBeNull();
  });
});
