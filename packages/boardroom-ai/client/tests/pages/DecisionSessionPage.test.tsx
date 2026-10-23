import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import * as api from '../../src/lib/api';
import DecisionSessionPage, { TAB_TITLE_MAX } from '../../src/pages/DecisionSessionPage';
import { useSessionStore } from '../../src/stores/session.store';

/**
 * M1-C3 — a reloaded or undispatched session hydrates from the server:
 * `/decisions/:id` shows the stored question read-only with Analyze / Edit
 * (never an empty composer), `/decisions/new` keeps the blank composer, and
 * the tab title says what the H1 says.
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

// The "what changed" card reads the entity store; it is covered by its own test.
vi.mock('../../src/components/decision/WhatChangedCard', () => ({ WhatChangedCard: () => null }));

const QUESTION = 'Should we move from usage-based to per-seat pricing before the Q1 renewals?';

function storedSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    question: QUESTION,
    mode: 'decide',
    personaResponses: {},
    ceoSynthesis: null,
    sufficiencyScore: null,
    decisionId: null,
    createdAt: '2026-10-22T00:00:00.000Z',
    ...overrides,
  };
}

/** Never-ending dispatch stream: the request is observable, the page stays mid-dispatch. */
async function* pendingStream(): AsyncGenerator<never> {
  await new Promise(() => {});
}

let currentPath = '';
function LocationProbe() {
  currentPath = useLocation().pathname;
  return null;
}

function renderAt(path: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/decisions/:id" element={<><DecisionSessionPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSessionStore.getState().reset();
  vi.mocked(api.getCustomPersonas).mockResolvedValue([]);
  vi.mocked(api.getDecisions).mockResolvedValue([]);
  vi.mocked(api.streamSSE).mockImplementation(() => pendingStream());
  document.title = 'BoardRoom AI';
});

describe('DecisionSessionPage — hydrating /decisions/:id (M1-C3)', () => {
  it('shows the stored question read-only with Analyze and Edit, and no empty textarea', async () => {
    vi.mocked(api.getSession).mockResolvedValue(storedSession() as never);
    renderAt('/decisions/s-1');

    expect(await screen.findByRole('heading', { level: 1, name: QUESTION })).toBeInTheDocument();
    expect(screen.getByTestId('session-review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('New Decision')).not.toBeInTheDocument();
    expect(api.getSession).toHaveBeenCalledWith('s-1');
  });

  it('never flashes the blank composer while the session is loading', () => {
    vi.mocked(api.getSession).mockReturnValue(new Promise(() => {}) as never);
    renderAt('/decisions/s-1');
    expect(screen.getByTestId('session-loading')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('New Decision')).not.toBeInTheDocument();
  });

  it('aligns the tab title with the H1 (the question, cut with an ellipsis)', async () => {
    vi.mocked(api.getSession).mockResolvedValue(storedSession() as never);
    renderAt('/decisions/s-1');
    await screen.findByTestId('session-review');
    await waitFor(() => expect(document.title).toBe(`${QUESTION.slice(0, TAB_TITLE_MAX - 1)}… — BoardRoom AI`));
    expect(QUESTION.startsWith(document.title.split('…')[0])).toBe(true);
  });

  it('Analyze dispatches the stored session in place', async () => {
    vi.mocked(api.getSession).mockResolvedValue(storedSession() as never);
    renderAt('/decisions/s-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Analyze' }));
    await waitFor(() => expect(api.streamSSE).toHaveBeenCalledWith('/api/sessions/s-1/dispatch', 'POST', undefined, expect.any(AbortSignal)));
    expect(api.createSession).not.toHaveBeenCalled();
    // Mid-dispatch the question stays the H1 (persona phase header).
    expect(await screen.findByRole('heading', { level: 1, name: QUESTION })).toBeInTheDocument();
  });

  it('Edit opens the composer prefilled; an unchanged Analyze runs the same session', async () => {
    vi.mocked(api.getSession).mockResolvedValue(storedSession() as never);
    renderAt('/decisions/s-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const box = await screen.findByRole('textbox') as HTMLTextAreaElement;
    expect(box.value).toBe(QUESTION);
    expect(screen.getByRole('heading', { level: 1, name: 'Edit Decision' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Edit Decision — BoardRoom AI'));
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    await waitFor(() => expect(api.streamSSE).toHaveBeenCalledWith('/api/sessions/s-1/dispatch', 'POST', undefined, expect.any(AbortSignal)));
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('Edit → Cancel returns to the read-only question', async () => {
    vi.mocked(api.getSession).mockResolvedValue(storedSession() as never);
    renderAt('/decisions/s-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByTestId('session-review')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('a changed question starts a new session at its own URL, which loads and dispatches it once', async () => {
    vi.mocked(api.getSession).mockImplementation(async (id: string) =>
      (id === 's-2' ? storedSession({ id: 's-2', question: 'Should we raise prices in Q2?' }) : storedSession()) as never);
    vi.mocked(api.createSession).mockResolvedValue({ sessionId: 's-2' } as never);
    renderAt('/decisions/s-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Should we raise prices in Q2?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    await waitFor(() => expect(currentPath).toBe('/decisions/s-2'));
    await waitFor(() => expect(api.streamSSE).toHaveBeenCalledWith('/api/sessions/s-2/dispatch', 'POST', undefined, expect.any(AbortSignal)));
    expect(api.streamSSE).toHaveBeenCalledTimes(1);
    expect(api.createSession).toHaveBeenCalledWith({ question: 'Should we raise prices in Q2?', mode: 'decide' });
  });

  it('a reload of an auto-dispatched URL does not dispatch again (no router state)', async () => {
    vi.mocked(api.getSession).mockResolvedValue(storedSession() as never);
    renderAt('/decisions/s-1');
    await screen.findByTestId('session-review');
    expect(api.streamSSE).not.toHaveBeenCalled();
  });

  it('a session that already has responses renders the persona grid, not the review', async () => {
    vi.mocked(api.getSession).mockResolvedValue(storedSession({
      personaResponses: {
        optimist: {
          personaId: 'optimist', situationReading: 'Demand is pulling you there.', keyAssumptions: [], analysis: 'Seats grow with hires.',
          recommendation: 'Move to per-seat.', uncertainties: [], sourceMemoryIds: [], confidence: 0.7, dissentFlag: false,
        },
      },
    }) as never);
    renderAt('/decisions/s-1');
    expect(await screen.findByText('Demand is pulling you there.')).toBeInTheDocument();
    expect(screen.queryByTestId('session-review')).not.toBeInTheDocument();
  });
});

describe('DecisionSessionPage — /decisions/new keeps the composer', () => {
  it('shows the blank composer and the "New Decision" title in the tab and the H1', async () => {
    renderAt('/decisions/new');
    expect(screen.getByRole('heading', { level: 1, name: 'New Decision' })).toBeInTheDocument();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByTestId('session-review')).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('New Decision — BoardRoom AI'));
    expect(api.getSession).not.toHaveBeenCalled();
  });

  it('Analyze creates the session and moves to its URL, which dispatches it', async () => {
    vi.mocked(api.createSession).mockResolvedValue({ sessionId: 's-9' } as never);
    vi.mocked(api.getSession).mockResolvedValue(storedSession({ id: 's-9', question: 'Hire a designer?' }) as never);
    renderAt('/decisions/new');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hire a designer?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    await waitFor(() => expect(currentPath).toBe('/decisions/s-9'));
    await waitFor(() => expect(api.streamSSE).toHaveBeenCalledWith('/api/sessions/s-9/dispatch', 'POST', undefined, expect.any(AbortSignal)));
    expect(api.streamSSE).toHaveBeenCalledTimes(1);
  });
});
