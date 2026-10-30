import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as api from '../../src/lib/api';
import DecisionSessionPage from '../../src/pages/DecisionSessionPage';
import { useSessionStore } from '../../src/stores/session.store';

/**
 * A failed "Commit decision" must say so inside the commit card, in plain
 * words — not only as a raw upstream toast ("OmniMind POST /decisions: 500").
 * Invented data only.
 */

vi.mock('../../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public body?: unknown) { super(message); this.name = 'ApiError'; }
  },
  getSession: vi.fn(),
  getCustomPersonas: vi.fn(),
  getDecisions: vi.fn(),
  getDecision: vi.fn(),
  getMemory: vi.fn(),
  createSession: vi.fn(),
  streamSSE: vi.fn(),
  createSynthesisStream: vi.fn(),
  checkAmbiguity: vi.fn(),
  commitDecision: vi.fn(),
}));
vi.mock('../../src/components/decision/WhatChangedCard', () => ({ WhatChangedCard: () => null }));

const REPORT = {
  disagreementMap: 'Split on timing.',
  decisiveTradeoff: 'Speed vs. volunteer load.',
  recommendation: 'Host the fair in March.',
  nextActions: ['Book the hall'],
  topRisks: [],
  assumptionsToMonitor: [],
  sourceMemoryIds: [],
};

beforeEach(() => {
  useSessionStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(api.getCustomPersonas).mockResolvedValue([]);
  vi.mocked(api.getDecisions).mockResolvedValue([]);
  vi.mocked(api.getSession).mockResolvedValue({
    id: 's-1', question: 'When should we hold the harvest fair?', mode: 'decide', personaResponses: {},
    ceoSynthesis: REPORT, sufficiencyScore: null, decisionId: null, createdAt: '2025-01-05T00:00:00.000Z',
  } as never);
});

describe('DecisionSessionPage — commit failure', () => {
  it('shows a plain error inside the commit card and keeps the form', async () => {
    vi.mocked(api.commitDecision).mockRejectedValue(new api.ApiError('OmniMind POST /decisions: 500', 502, { error: 'upstream_error' }));
    render(
      <MemoryRouter initialEntries={['/decisions/s-1']}>
        <Routes><Route path="/decisions/:id" element={<DecisionSessionPage />} /></Routes>
      </MemoryRouter>,
    );
    const card = await screen.findByTestId('decision-commit-card');
    fireEvent.change(within(card).getByLabelText(/Expected outcome/), { target: { value: '80 families attend' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Commit decision' }));

    await waitFor(() => expect(within(card).getByText('Your decision was not saved. Your answers are still here — try again in a moment.')).toBeInTheDocument());
    expect(within(card).queryByText(/OmniMind/)).toBeNull();
    expect(within(card).getByLabelText(/Expected outcome/)).toHaveValue('80 families attend');

    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss error' }));
    expect(within(card).queryByText(/Your decision was not saved/)).toBeNull();
  });
});
