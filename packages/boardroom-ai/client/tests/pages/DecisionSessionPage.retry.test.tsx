import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { BoardRoomSSEEvent, PersonaResponse } from '@boardroom/shared';
import * as api from '../../src/lib/api';
import DecisionSessionPage from '../../src/pages/DecisionSessionPage';
import { useSessionStore } from '../../src/stores/session.store';

/**
 * M1-C2 on the page: `persona_error` → an error card with Retry (never
 * "Thinking..."), Retry re-dispatches only that advisor, and the CEO step says
 * who is missing ("Synthesize without Critic").
 */

vi.mock('../../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: unknown) { super(message); this.name = 'ApiError'; }
  },
  getSession: vi.fn(),
  getCustomPersonas: vi.fn(),
  getDecisions: vi.fn(),
  createSession: vi.fn(),
  streamSSE: vi.fn(),
  createSynthesisStream: vi.fn(),
  checkAmbiguity: vi.fn(),
}));
vi.mock('../../src/components/decision/WhatChangedCard', () => ({ WhatChangedCard: () => null }));

type StreamEvent = BoardRoomSSEEvent & Record<string, unknown>;
async function* events(list: BoardRoomSSEEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of list) yield e as StreamEvent;
}

const answer = (personaId: string): PersonaResponse => ({
  personaId, situationReading: `${personaId} reading`, keyAssumptions: [], analysis: `${personaId} analysis`,
  recommendation: `${personaId} recommends`, uncertainties: [], sourceMemoryIds: [], confidence: 0.7, dissentFlag: false,
});

const QUESTION = 'Should we move to per-seat pricing?';
const stored = (personaResponses: Record<string, PersonaResponse> = {}) => ({
  id: 's-1', question: QUESTION, mode: 'decide', personaResponses, ceoSynthesis: null, sufficiencyScore: null, decisionId: null, createdAt: '2026-10-22T00:00:00Z',
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/decisions/s-1']}>
      <Routes><Route path="/decisions/:id" element={<DecisionSessionPage />} /></Routes>
    </MemoryRouter>,
  );
}

const cardOf = (name: string) => screen.getAllByTestId('persona-card').find((c) => within(c).queryAllByText(name, { exact: false }).length > 0)!;

beforeEach(() => {
  useSessionStore.getState().reset();
  vi.mocked(api.getCustomPersonas).mockResolvedValue([]);
  vi.mocked(api.getDecisions).mockResolvedValue([]);
});

describe('DecisionSessionPage — failed advisor (M1-C2)', () => {
  it('persona_error → an error card with Retry, never "Thinking...", and the CTA names the missing advisor', async () => {
    vi.mocked(api.getSession).mockResolvedValue(stored() as never);
    vi.mocked(api.streamSSE).mockReturnValue(events([
      { type: 'persona_start', personaId: 'optimist', model: 'haiku' },
      { type: 'persona_start', personaId: 'critic', model: 'haiku' },
      { type: 'persona_start', personaId: 'alternate', model: 'sonnet' },
      { type: 'persona_start', personaId: 'technician', model: 'haiku' },
      { type: 'persona_complete', personaId: 'optimist', response: answer('optimist') },
      { type: 'persona_complete', personaId: 'alternate', response: answer('alternate') },
      { type: 'persona_complete', personaId: 'technician', response: answer('technician') },
      // Last, so the polite region's final message is the failure (each update replaces the previous one).
      { type: 'persona_error', personaId: 'critic', error: 'Persona response failed validation' },
      { type: 'dispatch_complete', personaCount: 3, durationMs: 10 },
    ]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Analyze' }));

    const cta = await screen.findByRole('button', { name: 'Synthesize without Critic' });
    expect(cta).toBeEnabled();
    const critic = cardOf('The Critic');
    expect(critic.dataset.state).toBe('error');
    expect(within(critic).getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(within(critic).getByText('Persona response failed validation')).toBeInTheDocument();
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument();
    expect(screen.getByTestId('persona-announcer')).toHaveTextContent(/The Critic couldn't finish/);

    // Retry → POST /dispatch { personaIds: ['critic'] }; the card streams, then completes; the CTA is whole again.
    vi.mocked(api.streamSSE).mockReturnValue(events([
      { type: 'persona_start', personaId: 'critic', model: 'haiku' },
      { type: 'persona_complete', personaId: 'critic', response: answer('critic') },
      { type: 'dispatch_complete', personaCount: 1, durationMs: 5 },
    ]));
    fireEvent.click(within(critic).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.streamSSE).toHaveBeenLastCalledWith('/api/sessions/s-1/dispatch', 'POST', { personaIds: ['critic'] }, expect.any(AbortSignal)));
    expect(await screen.findByText('critic recommends')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Synthesize with CEO/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a reloaded session with a missing advisor shows it failed with Retry, not "Thinking..."', async () => {
    vi.mocked(api.getSession).mockResolvedValue(stored({ optimist: answer('optimist'), alternate: answer('alternate'), technician: answer('technician') }) as never);
    renderPage();
    expect(await screen.findByText('optimist recommends')).toBeInTheDocument();
    const critic = cardOf('The Critic');
    expect(critic.dataset.state).toBe('error');
    expect(within(critic).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Synthesize without Critic' })).toBeInTheDocument();
  });

  it('the synthesis says which advisors it was made without', async () => {
    vi.mocked(api.getSession).mockResolvedValue(stored({ optimist: answer('optimist'), alternate: answer('alternate'), technician: answer('technician') }) as never);
    vi.mocked(api.createSynthesisStream).mockReturnValue(events([
      { type: 'synthesis_start', model: 'sonnet' } as BoardRoomSSEEvent,
      { type: 'delta', text: '{"disagreementMap":' } as BoardRoomSSEEvent,
    ]) as never);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Synthesize without Critic' }));
    expect(await screen.findByTestId('synthesis-without')).toHaveTextContent('Synthesized without Critic');
  });
});
