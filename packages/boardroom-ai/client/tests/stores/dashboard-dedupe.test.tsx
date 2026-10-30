/**
 * M2-C1 — one dashboard load fired the same GET from several owners:
 *   /profile                ×2  OnboardingGate, then useWidgetLayout
 *   /outcome-reviews/pending ×3  OutcomeReviewBanner, useNotificationAggregator, cockpit (viz)
 *   /commitments            ×2  Layout (entities store), cockpit + nudges (viz)
 * Sequential duplicates are not caught by in-flight coalescing, so each now
 * shares one owner: the profile store (gate primes it, the layout hook reads
 * it) and the viz store (TTL + in-flight) for reviews and commitments.
 * Invented data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, renderHook, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UserProfile } from '@boardroom/shared';
import * as api from '../../src/lib/api';
import { OnboardingGate } from '../../src/App';
import { useWidgetLayout } from '../../src/hooks/useWidgetLayout';
import { useProfileStore } from '../../src/stores/profile.store';
import { useVizStore } from '../../src/stores/viz.store';
import { useEntitiesStore } from '../../src/stores/entities.store';
import { OutcomeReviewBanner } from '../../src/components/dashboard/OutcomeReviewBanner';
import { useNotificationAggregator } from '../../src/hooks/useNotificationAggregator';

vi.mock('../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/api')>();
  return {
    ...actual,
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    getPendingReviews: vi.fn(),
    getCommitments: vi.fn(),
    skipReview: vi.fn(),
  };
});

const layout = [{ id: 'w1', type: 'goal_hierarchy', position: 0, visible: true }];
const profile = { id: 'up-1', userId: 'u-1', onboardingComplete: true, dashboardLayout: layout } as unknown as UserProfile;
const nudge = { id: 'n1', decisionId: 'd1', decisionTitle: 'Hire a contractor', nudgeType: '30_day', scheduledFor: '2026-10-01T00:00:00Z', status: 'PENDING' };

function WidgetProbe() {
  const { widgets, isLoading } = useWidgetLayout();
  return <p data-testid="widgets">{isLoading ? 'loading' : widgets.map((w) => w.id).join(',')}</p>;
}

function AggregatorProbe() {
  useNotificationAggregator();
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  useProfileStore.getState().reset();
  useVizStore.getState().reset();
  useEntitiesStore.getState().reset();
});

describe('profile: the gate primes it, the dashboard layout reuses it', () => {
  it('gate + dashboard layout → one GET /profile', async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue(profile);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OnboardingGate />}>
            <Route path="/" element={<WidgetProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('widgets')).toHaveTextContent('w1'));
    expect(api.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it('the gate always reads fresh (an onboarding that just completed is not judged on a cached profile)', async () => {
    useProfileStore.getState().setProfile({ ...profile, onboardingComplete: false } as UserProfile);
    vi.mocked(api.getUserProfile).mockResolvedValue(profile);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OnboardingGate />}>
            <Route path="/" element={<p>shell</p>} />
          </Route>
          <Route path="/onboarding" element={<p>onboarding</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('shell')).toBeInTheDocument();
    expect(api.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it('the layout hook still fetches when nothing primed the store', async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue(profile);
    render(<WidgetProbe />);
    await waitFor(() => expect(screen.getByTestId('widgets')).toHaveTextContent('w1'));
    expect(api.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it('a saved layout updates the shared profile', async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue(profile);
    const next = [{ id: 'w2', type: 'goal_hierarchy', position: 0, visible: true }];
    vi.mocked(api.updateUserProfile).mockResolvedValue({ ...profile, dashboardLayout: next } as unknown as UserProfile);
    const { result } = renderHook(() => useWidgetLayout());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => { await result.current.updateLayout(next as never); });
    expect(useProfileStore.getState().profile?.dashboardLayout).toEqual(next);
  });
});

describe('outcome reviews: banner, notifications and cockpit share one request', () => {
  it('three owners → one GET /outcome-reviews/pending', async () => {
    vi.mocked(api.getPendingReviews).mockResolvedValue([nudge] as never);
    render(<><AggregatorProbe /><OutcomeReviewBanner /></>);
    void useVizStore.getState().load('pendingReviews');
    expect(await screen.findByText('Hire a contractor')).toBeInTheDocument();
    expect(api.getPendingReviews).toHaveBeenCalledTimes(1);
  });

  it('a later mount within the TTL reuses the result (sequential, not only concurrent)', async () => {
    vi.mocked(api.getPendingReviews).mockResolvedValue([nudge] as never);
    await useVizStore.getState().load('pendingReviews');
    render(<OutcomeReviewBanner />);
    expect(await screen.findByText('Hire a contractor')).toBeInTheDocument();
    expect(api.getPendingReviews).toHaveBeenCalledTimes(1);
  });

  it('a failed load is not cached: the next owner retries', async () => {
    vi.mocked(api.getPendingReviews).mockRejectedValueOnce(new Error('down')).mockResolvedValue([nudge] as never);
    await useVizStore.getState().load('pendingReviews');
    render(<OutcomeReviewBanner />);
    expect(await screen.findByText('Hire a contractor')).toBeInTheDocument();
    expect(api.getPendingReviews).toHaveBeenCalledTimes(2);
  });
});

describe('commitments: the Layout fetch and the cockpit share one request', () => {
  it('entities.fetchCommitments + viz load → one GET /commitments, both stores filled', async () => {
    const rows = [{ id: 'c1', title: 'Send the deck' }];
    vi.mocked(api.getCommitments).mockResolvedValue(rows as never);
    await useEntitiesStore.getState().fetchCommitments();
    const viz = await useVizStore.getState().load('commitments');
    expect(api.getCommitments).toHaveBeenCalledTimes(1);
    expect(useEntitiesStore.getState().commitments).toEqual(rows);
    expect(viz).toEqual(rows);
  });

  it('fetchCommitments always refetches (it runs after a delegation write)', async () => {
    vi.mocked(api.getCommitments).mockResolvedValue([] as never);
    await useVizStore.getState().load('commitments');
    await useEntitiesStore.getState().fetchCommitments();
    expect(api.getCommitments).toHaveBeenCalledTimes(2);
  });

  it('a failure still surfaces on the entities store', async () => {
    vi.mocked(api.getCommitments).mockRejectedValue(new Error('Request failed: 503'));
    await useEntitiesStore.getState().fetchCommitments();
    expect(useEntitiesStore.getState().error).toBe('Request failed: 503');
  });
});
