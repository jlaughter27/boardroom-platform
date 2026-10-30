import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Commitment, Decision, LlmUsageSummary, Memory, OutcomeReviewNudge } from '@boardroom/shared';
import * as api from '../../../src/lib/api';
import { useVizStore } from '../../../src/stores/viz.store';
import { CockpitRow, memoriesTile, commitmentsTile, reviewsTile, spendTile, decisionsTile } from '../../../src/components/dashboard/CockpitRow';

vi.mock('../../../src/lib/api', () => ({
  listMemoriesSince: vi.fn(),
  getCommitments: vi.fn(),
  getDecisions: vi.fn(),
  getPendingReviews: vi.fn(),
  getLlmUsageSummary: vi.fn(),
}));

const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const mem = (iso: string) => ({ id: iso, createdAt: iso } as unknown as Memory);
const com = (id: string, deadline: string | null, status: Commitment['status'] = 'OPEN' as Commitment['status']) => ({ id, deadline, status, description: id, stakeholderId: null } as unknown as Commitment);
const nudge = (id: string, scheduledFor: string, status: OutcomeReviewNudge['status'] = 'pending') => ({ id, scheduledFor, status } as unknown as OutcomeReviewNudge);

describe('tile builders', () => {
  it('memoriesTile: this week vs last, 8-week trend', () => {
    const t = memoriesTile([mem('2026-10-19T01:00:00Z'), mem('2026-10-20T01:00:00Z'), mem('2026-10-13T01:00:00Z'), mem('2026-06-01T00:00:00Z')], NOW);
    expect(t.value).toBe('2');
    expect(t.delta).toEqual({ value: 1, unit: 'count', vs: 'vs last week' });
    expect(t.trend).toHaveLength(8);
    expect(t.trend![7]).toBe(2);
    expect(t.hint).toBe('3 in 8 weeks');
  });
  it('commitmentsTile: due ≤ 7 d, overdue drives the tone', () => {
    const t = commitmentsTile([com('a', '2026-10-22T00:00:00Z'), com('b', '2026-10-28T00:00:00Z'), com('c', '2026-10-10T00:00:00Z'), com('d', '2026-10-21T00:00:00Z', 'COMPLETED' as Commitment['status'])], NOW);
    expect(t.value).toBe('1');
    expect(t.hint).toBe('1 overdue');
    expect(t.tone).toBe('danger');
    expect(commitmentsTile([], NOW).tone).toBe('neutral');
  });
  it('reviewsTile: pending + sent count, oldest wait in days', () => {
    const t = reviewsTile([nudge('1', '2026-10-10T00:00:00Z'), nudge('2', '2026-10-19T00:00:00Z', 'sent'), nudge('3', '2026-09-01T00:00:00Z', 'completed')], NOW);
    expect(t.value).toBe('2');
    expect(t.hint).toBe('oldest waiting 10 d');
    expect(t.tone).toBe('danger');
    expect(reviewsTile([], NOW)).toMatchObject({ value: '0', tone: 'success' });
  });
  it('spendTile: month to date, delta vs same days last month, weekly trend', () => {
    const usage: LlmUsageSummary = { days: 62, totalUsd: 0, byPurpose: [], byModel: [], byDay: [
      { date: '2026-10-02', usd: 4, calls: 1 }, { date: '2026-10-19', usd: 6, calls: 1 }, { date: '2026-09-05', usd: 3, calls: 1 }, { date: '2026-09-28', usd: 9, calls: 1 },
    ] };
    const t = spendTile(usage, NOW);
    expect(t.value).toBe('$10.0');
    expect(t.delta).toMatchObject({ value: 7, unit: 'usd', upIsGood: false });
    expect(t.trend).toHaveLength(8);
    expect(t.trend![7]).toBe(6);
  });
  it('decisionsTile: committed in 8 weeks with this-week delta', () => {
    const t = decisionsTile([{ id: 'd', decidedAt: '2026-10-19T00:00:00Z', createdAt: '2026-10-01T00:00:00Z' } as unknown as Decision], NOW);
    expect(t.value).toBe('1');
    expect(t.delta?.value).toBe(1);
  });
});

describe('<CockpitRow />', () => {
  beforeEach(() => {
    useVizStore.getState().reset();
    vi.mocked(api.listMemoriesSince).mockResolvedValue([mem(new Date().toISOString())]);
    vi.mocked(api.getCommitments).mockResolvedValue([]);
    vi.mocked(api.getPendingReviews).mockResolvedValue([]);
    vi.mocked(api.getDecisions).mockResolvedValue([]);
    vi.mocked(api.getLlmUsageSummary).mockResolvedValue({ days: 62, totalUsd: 1, byDay: [], byPurpose: [], byModel: [] });
  });

  it('renders four tiles for an admin, including LLM spend', async () => {
    render(<MemoryRouter><CockpitRow isAdmin /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('tile-spend')).not.toHaveAttribute('aria-busy'));
    expect(screen.getByTestId('tile-memories').textContent).toContain('1');
    expect(screen.getByTestId('tile-commitments')).toBeInTheDocument();
    expect(screen.getByTestId('tile-reviews').textContent).toContain('none due');
    expect(screen.queryByTestId('tile-decisions')).toBeNull();
    expect(api.getLlmUsageSummary).toHaveBeenCalledWith(62);
  });

  it('swaps the spend tile for decisions cadence when not admin, and never calls the usage endpoint', async () => {
    render(<MemoryRouter><CockpitRow isAdmin={false} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('tile-decisions')).not.toHaveAttribute('aria-busy'));
    expect(api.getLlmUsageSummary).not.toHaveBeenCalled();
    expect(api.getDecisions).toHaveBeenCalled();
  });

  it('degrades a tile to a placeholder when its endpoint fails', async () => {
    vi.mocked(api.getCommitments).mockRejectedValue(new Error('500'));
    render(<MemoryRouter><CockpitRow isAdmin={false} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('tile-commitments').textContent).toContain('unavailable'));
    expect(screen.getByTestId('tile-commitments').textContent).toContain('—');
  });
});
