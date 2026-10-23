import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PersonaResponse } from '@boardroom/shared';
import * as api from '../../src/lib/api';
import DecisionSessionPage from '../../src/pages/DecisionSessionPage';
import { hydrateRebuttals, useSessionStore } from '../../src/stores/session.store';

/**
 * RD-9a — `GET /sessions/:id` returns the debate's round-2 rebuttals; a reload
 * must show the same "Defended" / "Conceded" badges and rebuttal blocks the
 * live stream did (they used to vanish on reload).
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

const answer = (personaId: string, dissentFlag = false): PersonaResponse => ({
  personaId, situationReading: `${personaId} reading`, keyAssumptions: [], analysis: `${personaId} analysis`,
  recommendation: `${personaId} recommends`, uncertainties: [], sourceMemoryIds: [], confidence: 0.7, dissentFlag,
});

const stored = (rebuttals: unknown) => ({
  id: 's-1', question: 'Should we move to per-seat pricing?', mode: 'decide',
  personaResponses: { optimist: answer('optimist'), critic: answer('critic', true), alternate: answer('alternate', true), technician: answer('technician') },
  ceoSynthesis: null, sufficiencyScore: null, decisionId: null, createdAt: '2026-10-22T00:00:00Z',
  rebuttals,
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/decisions/s-1']}>
    <Routes><Route path="/decisions/:id" element={<DecisionSessionPage />} /></Routes>
  </MemoryRouter>,
);
const cardOf = (name: string) => screen.getAllByTestId('persona-card').find((c) => within(c).queryAllByText(name, { exact: false }).length > 0)!;

beforeEach(() => {
  useSessionStore.getState().reset();
  vi.mocked(api.getCustomPersonas).mockResolvedValue([]);
  vi.mocked(api.getDecisions).mockResolvedValue([]);
});

describe('DecisionSessionPage — rebuttals restored on reload (RD-9a)', () => {
  it('a reloaded session shows each stored rebuttal on its card (badge + block), and only there', async () => {
    vi.mocked(api.getSession).mockResolvedValue(stored({
      critic: { personaId: 'critic', stance: 'defend', reason: 'Renewal risk is still the binding constraint.', revisedConfidence: 0.8 },
      alternate: { personaId: 'alternate', stance: 'concede', reason: 'The pilot data moved me.', revisedRecommendation: 'Run the per-seat pilot first.', revisedConfidence: 0.55 },
    }) as never);
    renderPage();

    await screen.findAllByTestId('persona-card');
    const critic = cardOf('The Critic');
    expect(within(critic).getByTestId('rebuttal-block')).toHaveTextContent('Renewal risk is still the binding constraint.');
    expect(within(critic).getAllByText('Defended').length).toBeGreaterThan(0);

    const alternate = cardOf('The Alternate');
    expect(within(alternate).getByTestId('rebuttal-block')).toHaveTextContent('Run the per-seat pilot first.');
    expect(within(alternate).getAllByText('Conceded').length).toBeGreaterThan(0);

    expect(within(cardOf('The Optimist')).queryByTestId('rebuttal-block')).not.toBeInTheDocument();
    expect(Object.keys(useSessionStore.getState().rebuttals).sort()).toEqual(['alternate', 'critic']);
  });

  it('a session stored before the debate (no rebuttals field) still loads cleanly', async () => {
    vi.mocked(api.getSession).mockResolvedValue(stored(undefined) as never);
    renderPage();
    await screen.findAllByTestId('persona-card');
    expect(screen.queryByTestId('rebuttal-block')).not.toBeInTheDocument();
    expect(useSessionStore.getState().rebuttals).toEqual({});
  });
});

describe('hydrateRebuttals', () => {
  it('keeps valid rows keyed by persona (personaId from the key), drops malformed ones', () => {
    const out = hydrateRebuttals({
      critic: { stance: 'defend', reason: 'Still risky.', revisedConfidence: 0.8 },
      alternate: { stance: 'maybe', reason: 'x', revisedConfidence: 0.5 },          // bad stance
      doer: { stance: 'concede', reason: '', revisedConfidence: 0.4 },               // empty reason
      ceo: { stance: 'defend', reason: 'ok', revisedConfidence: 7 },                 // out of range
      technician: 'not an object',
    });
    expect(out).toEqual({ critic: { personaId: 'critic', stance: 'defend', reason: 'Still risky.', revisedConfidence: 0.8 } });
  });

  it('anything that is not a map yields no rebuttals', () => {
    for (const raw of [undefined, null, 'x', 3, [], [{ stance: 'defend' }]]) expect(hydrateRebuttals(raw)).toEqual({});
  });
});
