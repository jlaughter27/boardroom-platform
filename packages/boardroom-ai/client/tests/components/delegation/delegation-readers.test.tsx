import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { Commitment } from '@boardroom/shared';
import { useEntitiesStore } from '../../../src/stores/entities.store';
import { useUIStore } from '../../../src/stores/ui.store';
import { useCognitiveLoad } from '../../../src/hooks/useCognitiveLoad';
import { useProactiveQuestions } from '../../../src/hooks/useProactiveQuestions';
import { commitmentsTile } from '../../../src/components/dashboard/CockpitRow';
import { isOpenCommitment } from '../../../src/components/dashboard/CommitmentHorizon';
import { WeekCalendarStrip } from '../../../src/components/dashboard/WeekCalendarStrip';
import { buildChangeEvents } from '../../../src/components/decision/WhatChangedCard';

/** RD-12 — every reader that must NOT count a delegation as the user's own load, one test each. */

vi.mock('../../../src/lib/api', () => ({ getCalendarEvents: vi.fn(async () => []) }));

const day = 86_400_000;
const overdueIso = () => new Date(Date.now() - 2 * day).toISOString();
const c = (id: string, owedBy: 'USER' | 'STAKEHOLDER', deadline = overdueIso()) =>
  ({ id, userId: 'u1', description: `Item ${id}`, stakeholderId: 'p1', deadline, status: 'OPEN', sourceSessionId: null, linkedProjectId: null, createdAt: new Date(Date.now() - 5 * day).toISOString(), completedAt: null, owedBy }) as unknown as Commitment;

beforeEach(() => {
  useEntitiesStore.setState({ tasks: [], goals: [], projects: [], commitments: [] } as never);
  useUIStore.setState({ dismissedQuestions: new Set<string>() } as never);
});

describe('readers ignore an overdue STAKEHOLDER commitment', () => {
  it('useCognitiveLoad: delegations never push the overdue count over the alert line', () => {
    // 3 own overdue items is at the threshold (no alert); a 4th that is a delegation must not tip it.
    useEntitiesStore.setState({ commitments: [c('a', 'USER'), c('b', 'USER'), c('c', 'USER'), c('d', 'STAKEHOLDER')] } as never);
    const { result } = renderHook(() => useCognitiveLoad());
    expect(result.current.find((w) => w.type === 'too_many_overdue')).toBeUndefined();
    useEntitiesStore.setState({ commitments: [c('a', 'USER'), c('b', 'USER'), c('c', 'USER'), c('d', 'USER')] } as never);
    const again = renderHook(() => useCognitiveLoad());
    expect(again.result.current.find((w) => w.type === 'too_many_overdue')).toBeDefined();
  });

  it('useProactiveQuestions: no "overdue commitment" question for a delegation', () => {
    useEntitiesStore.setState({ commitments: [c('mine', 'USER'), c('theirs', 'STAKEHOLDER')] } as never);
    const { result } = renderHook(() => useProactiveQuestions());
    const ids = result.current.filter((q) => q.type === 'overdue_commitment').map((q) => q.entityId);
    expect(ids).toEqual(['mine']);
  });

  it('CockpitRow commitmentsTile: a delegation is not counted', () => {
    const now = Date.now();
    expect(commitmentsTile([c('theirs', 'STAKEHOLDER')], now)).toMatchObject({ value: '0', tone: 'neutral' });
    expect(commitmentsTile([c('mine', 'USER')], now).hint).toBe('1 overdue');
  });

  it('CommitmentHorizon isOpenCommitment excludes delegations', () => {
    expect(isOpenCommitment(c('mine', 'USER'))).toBe(true);
    expect(isOpenCommitment(c('theirs', 'STAKEHOLDER'))).toBe(false);
    expect(isOpenCommitment({ ...c('legacy', 'USER'), owedBy: undefined } as Commitment)).toBe(true);
  });

  it('WeekCalendarStrip skips delegations', async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    useEntitiesStore.setState({ commitments: [c('mine', 'USER', today.toISOString()), c('theirs', 'STAKEHOLDER', today.toISOString())] } as never);
    render(<WeekCalendarStrip />);
    await waitFor(() => expect(screen.getByText('Item mine')).toBeInTheDocument());
    expect(screen.queryByText('Item theirs')).toBeNull();
  });
});

describe('WhatChangedCard labels delegations', () => {
  it("prefixes 'Waiting on: '", () => {
    const events = buildChangeEvents({ since: '2026-10-01T00:00:00Z', memories: [], decisions: [], commitments: [c('mine', 'USER'), c('theirs', 'STAKEHOLDER')], capsule: null } as never);
    const titles = events.map((e) => e.title);
    expect(titles).toContain('Item mine');
    expect(titles).toContain('Waiting on: Item theirs');
  });
});
