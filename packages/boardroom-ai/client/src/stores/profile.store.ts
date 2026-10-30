import { create } from 'zustand';
import type { UserProfile } from '@boardroom/shared';
import * as api from '../lib/api';

/**
 * The signed-in user's profile, shared so one dashboard load reads it once
 * (M2-C1). OnboardingGate always loads fresh (`force`) and so primes it; the
 * dashboard layout hook reuses it within `PROFILE_TTL_MS`. Writes made through
 * `setProfile` keep it current. Reset on logout.
 */
export const PROFILE_TTL_MS = 60_000;

interface ProfileState {
  profile: UserProfile | null;
  fetchedAt: number;
  /** Resolve the profile: cached within the TTL unless `force`; concurrent callers share one request. Rejects on failure. */
  load: (opts?: { force?: boolean }) => Promise<UserProfile>;
  setProfile: (profile: UserProfile) => void;
  reset: () => void;
}

let inflight: Promise<UserProfile> | null = null;
let generation = 0;

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  fetchedAt: 0,

  load: ({ force = false } = {}) => {
    const { profile, fetchedAt } = get();
    if (!force && profile && Date.now() - fetchedAt < PROFILE_TTL_MS) return Promise.resolve(profile);
    if (inflight) return inflight;
    const gen = generation;
    const p = api.getUserProfile()
      .then((fresh) => {
        if (gen === generation) set({ profile: fresh, fetchedAt: Date.now() });
        return fresh;
      })
      .finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  },

  setProfile: (profile) => set({ profile, fetchedAt: Date.now() }),

  reset: () => {
    generation++;
    inflight = null;
    set({ profile: null, fetchedAt: 0 });
  },
}));
