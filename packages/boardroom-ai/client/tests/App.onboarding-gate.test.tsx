/**
 * OnboardingGate (M1-D3): only a missing profile sends a user to onboarding.
 * A 5xx, a network error or an open OmniMind breaker (503) keeps an onboarded
 * user in the shell with a retry banner.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useOutletContext } from 'react-router-dom';
import * as api from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import type { UserProfile } from '@boardroom/shared';
import { OnboardingGate, describeProfileFailure } from '../src/App';
import type { ShellOutletContext } from '../src/components/shared/Layout';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, getUserProfile: vi.fn() };
});

const profile = (onboardingComplete: boolean) => ({ id: 'up-1', userId: 'u-1', onboardingComplete }) as unknown as UserProfile;

/** Stands in for Layout: renders the pane notice the gate hands down (RD-9d). */
function Shell() {
  const ctx = useOutletContext<ShellOutletContext | undefined>();
  return <><p>dashboard shell</p>{ctx?.paneNotice}</>;
}

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<OnboardingGate />}>
          <Route path="/" element={<Shell />} />
        </Route>
        <Route path="/onboarding" element={<p>onboarding page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('<OnboardingGate />', () => {
  it('a 503 (breaker open / service down) renders the shell with a retry banner and does not navigate', async () => {
    vi.mocked(api.getUserProfile).mockRejectedValue(new ApiError('OmniMind circuit breaker OPEN', 503));
    renderGate();
    expect(await screen.findByTestId('profile-unavailable-banner')).toBeInTheDocument();
    expect(screen.getByText('dashboard shell')).toBeInTheDocument();
    expect(screen.queryByText('onboarding page')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable right now (503)');
  });

  it('a 404 (no profile yet) navigates to onboarding', async () => {
    vi.mocked(api.getUserProfile).mockRejectedValue(new ApiError('Not found', 404));
    renderGate();
    expect(await screen.findByText('onboarding page')).toBeInTheDocument();
    expect(screen.queryByText('dashboard shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('profile-unavailable-banner')).not.toBeInTheDocument();
  });

  it('an unfinished profile navigates to onboarding', async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue(profile(false));
    renderGate();
    expect(await screen.findByText('onboarding page')).toBeInTheDocument();
  });

  it('a finished profile renders the shell without a banner', async () => {
    vi.mocked(api.getUserProfile).mockResolvedValue(profile(true));
    renderGate();
    expect(await screen.findByText('dashboard shell')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-unavailable-banner')).not.toBeInTheDocument();
  });

  it('a network error (fetch rejects) keeps the shell and explains it', async () => {
    vi.mocked(api.getUserProfile).mockRejectedValue(new TypeError('Failed to fetch'));
    renderGate();
    expect(await screen.findByTestId('profile-unavailable-banner')).toHaveTextContent('could not be reached');
    expect(screen.getByText('dashboard shell')).toBeInTheDocument();
  });

  it('Retry re-fetches: success clears the banner and keeps the user in place', async () => {
    vi.mocked(api.getUserProfile)
      .mockRejectedValueOnce(new ApiError('Bad gateway', 502))
      .mockResolvedValueOnce(profile(true));
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByTestId('profile-unavailable-banner')).not.toBeInTheDocument());
    expect(screen.getByText('dashboard shell')).toBeInTheDocument();
    expect(api.getUserProfile).toHaveBeenCalledTimes(2);
  });

  it('Retry that finds no profile (404) then navigates to onboarding', async () => {
    vi.mocked(api.getUserProfile)
      .mockRejectedValueOnce(new ApiError('Service unavailable', 503))
      .mockRejectedValueOnce(new ApiError('Not found', 404));
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('onboarding page')).toBeInTheDocument();
  });

  it('describeProfileFailure words each failure class', () => {
    expect(describeProfileFailure(new ApiError('x', 503))).toMatch(/unavailable right now \(503\)/);
    expect(describeProfileFailure(new ApiError('x', 500))).toMatch(/returned an error \(500\)/);
    expect(describeProfileFailure(new TypeError('Failed to fetch'))).toMatch(/could not be reached/);
  });
});
