import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as api from '../../src/lib/api';
import DecisionSessionPage from '../../src/pages/DecisionSessionPage';
import { useSessionStore } from '../../src/stores/session.store';

/**
 * RD-12 — Entry A: a committed session's Next Actions offer Delegate even when
 * its decision is older than the newest page of GET /decisions (the committed
 * decision is resolved by id). Invented data only.
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
}));
vi.mock('../../src/components/decision/WhatChangedCard', () => ({ WhatChangedCard: () => null }));

const REPORT = {
  disagreementMap: 'Split on timing.',
  decisiveTradeoff: 'Speed vs. volunteer load.',
  recommendation: 'Host the fair in March.',
  nextActions: ['Book the hall', 'Send the volunteer rota'],
  topRisks: [],
  assumptionsToMonitor: [],
  sourceMemoryIds: [],
};

const OLD_DECISION = {
  id: 'd-old', userId: 'u1', title: 'Fair format', chosenPath: 'Host it in March', rationale: 'More volunteers free',
  expectedOutcome: '80 families attend', status: 'DECIDED', createdAt: '2025-01-05T00:00:00.000Z', updatedAt: '2025-01-05T00:00:00.000Z',
};
const NEWEST_20 = Array.from({ length: 20 }, (_, i) => ({ ...OLD_DECISION, id: `d-new-${i}`, title: `Newer ${i}` }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/decisions/:id" element={<DecisionSessionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSessionStore.getState().reset();
  vi.mocked(api.getCustomPersonas).mockResolvedValue([]);
  vi.mocked(api.getDecisions).mockResolvedValue(NEWEST_20 as never);
  vi.mocked(api.getDecision).mockResolvedValue(OLD_DECISION as never);
  vi.mocked(api.getSession).mockResolvedValue({
    id: 's-1', question: 'When should we hold the harvest fair?', mode: 'decide', personaResponses: {},
    ceoSynthesis: REPORT, sufficiencyScore: null, decisionId: 'd-old', createdAt: '2025-01-05T00:00:00.000Z',
  } as never);
});

describe('DecisionSessionPage — Delegate on an older committed decision (RD-12)', () => {
  it('resolves the committed decision by id, so Next Actions offer Delegate', async () => {
    renderAt('/decisions/s-1');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delegate: Send the volunteer rota' }).length).toBeGreaterThan(0));
    expect(api.getDecision).toHaveBeenCalledWith('d-old');
    expect(screen.queryByTestId('delegate-disabled-reason')).toBeNull();
  });

  it('an uncommitted session shows the disabled reason and never fetches a decision', async () => {
    vi.mocked(api.getSession).mockResolvedValue({
      id: 's-1', question: 'When should we hold the harvest fair?', mode: 'decide', personaResponses: {},
      ceoSynthesis: REPORT, sufficiencyScore: null, decisionId: null, createdAt: '2025-01-05T00:00:00.000Z',
    } as never);
    renderAt('/decisions/s-1');
    expect((await screen.findAllByTestId('delegate-disabled-reason'))[0]).toHaveTextContent('Commit the decision to delegate its actions.');
    expect(api.getDecision).not.toHaveBeenCalled();
  });
});
