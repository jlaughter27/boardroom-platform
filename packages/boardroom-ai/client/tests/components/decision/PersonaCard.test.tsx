import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PersonaResponse } from '@boardroom/shared';
import { PersonaCard } from '../../../src/components/decision/PersonaCard';

/**
 * M1-C1 — a streaming card shows prose (situationReading, then analysis),
 * never the raw JSON, and every state keeps the same reserved box.
 */

const response: PersonaResponse = {
  personaId: 'critic',
  situationReading: 'Two of your largest accounts have one power user and twenty viewers. Per-seat punishes exactly that shape.',
  keyAssumptions: ['Viewers matter to renewals', 'Seat-sharing will rise'],
  analysis: 'Seat pricing invites seat-sharing and viewer tiers you then have to police. The accounts most at risk are the ones that currently pay the most on usage. Churn risk concentrates where revenue concentrates, and the switching cost lands during the Q1 renewal window.',
  recommendation: 'Pilot a viewer/editor split with the two largest accounts first.',
  uncertainties: ['Whether viewers drive renewals'],
  sourceMemoryIds: ['m-1'],
  confidence: 0.71,
  dissentFlag: true,
};
const raw = JSON.stringify(response);

describe('PersonaCard — streaming shows prose, never JSON (M1-C1)', () => {
  it('no streaming prefix renders "{", a JSON key or personaId', () => {
    const { rerender, container } = render(<PersonaCard personaId="critic" isStreaming streamingText="" />);
    for (let i = 0; i <= raw.length; i += 7) {
      rerender(<PersonaCard personaId="critic" isStreaming streamingText={raw.slice(0, i)} />);
      const text = container.textContent ?? '';
      expect(text, `offset ${i}`).not.toContain('{');
      expect(text, `offset ${i}`).not.toContain('"situationReading"');
      expect(text, `offset ${i}`).not.toContain('situationReading');
      expect(text, `offset ${i}`).not.toContain('personaId');
      expect(text, `offset ${i}`).not.toContain('keyAssumptions');
    }
  });

  it('shows a skeleton until the first prose arrives, then situationReading, then analysis', () => {
    const { rerender } = render(<PersonaCard personaId="critic" isStreaming streamingText={'{"personaId":"critic","situ'} />);
    expect(screen.getByTestId('persona-skeleton')).toBeInTheDocument();

    rerender(<PersonaCard personaId="critic" isStreaming streamingText={'{"personaId":"critic","situationReading":"Two of your largest'} />);
    expect(screen.queryByTestId('persona-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText(/Two of your largest/)).toBeInTheDocument();
    expect(screen.queryByText('Analysis')).not.toBeInTheDocument();

    const mid = raw.indexOf('"analysis"') + '"analysis":"Seat pricing'.length;
    rerender(<PersonaCard personaId="critic" isStreaming streamingText={raw.slice(0, mid)} />);
    expect(screen.getByText('Analysis')).toBeInTheDocument();
    expect(screen.getByText(/^Seat pricing/)).toBeInTheDocument();
  });

  it('reserves 32rem: exactly for streaming, at least for finished cards; waiting cards 20rem on phones (RD-9b)', () => {
    const { rerender } = render(<PersonaCard personaId="critic" isStreaming={false} />);
    const waiting = screen.getByTestId('persona-card');
    expect(waiting.dataset.state).toBe('waiting');
    expect(waiting.className.split(' ')).toEqual(expect.arrayContaining(['min-h-[20rem]', 'sm:min-h-[32rem]']));

    rerender(<PersonaCard personaId="critic" isStreaming streamingText={raw.slice(0, 80)} />);
    const streaming = screen.getByTestId('persona-card');
    expect(streaming.dataset.state).toBe('streaming');
    expect(streaming.className.split(' ')).toContain('h-[32rem]');
    expect(streaming).toHaveAttribute('aria-busy', 'true');

    rerender(<PersonaCard personaId="critic" isStreaming={false} response={response} streamingText={raw} />);
    const done = screen.getByTestId('persona-card');
    expect(done.dataset.state).toBe('complete');
    expect(done.className.split(' ')).toContain('min-h-[32rem]');
  });

  it('the finished card renders the validated payload and clamps long analysis behind a toggle', () => {
    render(<PersonaCard personaId="critic" isStreaming={false} response={response} />);
    expect(screen.getByText(response.recommendation)).toBeInTheDocument();
    const analysis = screen.getByText(response.analysis);
    expect(analysis.className).toContain('line-clamp-5');
    fireEvent.click(screen.getByRole('button', { name: 'Show full analysis' }));
    expect(analysis.className).not.toContain('line-clamp-5');
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });
});
