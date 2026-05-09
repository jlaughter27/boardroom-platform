import { create } from 'zustand';
import * as api from '../lib/api';
import { useEntitiesStore } from './entities.store';
import { useMemoryStore } from './memory.store';
import { useCortexStore } from './cortex.store';
import { useNotificationStore } from './notification.store';
import { useUIStore } from './ui.store';
import { useSessionStore } from './session.store';

import type { AuthUser } from '@boardroom/shared';

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // true initially — checking auth on mount
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      await api.login(email, password);
      const me = await api.getMe();
      set({ user: me, isAuthenticated: true, isLoading: false });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Login failed';
      set({ error: message, isLoading: false });
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true, error: null });
    try {
      await api.register(email, password, name);
      const me = await api.getMe();
      set({ user: me, isAuthenticated: true, isLoading: false });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Registration failed';
      set({ error: message, isLoading: false });
    }
  },

  logout: async () => {
    await api.logout();
    // Reset all stores to prevent data leakage between users
    useEntitiesStore.getState().reset();
    useMemoryStore.getState().reset();
    useCortexStore.getState().reset();
    useNotificationStore.getState().reset();
    useUIStore.getState().reset();
    useSessionStore.getState().reset();
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    try {
      const me = await api.getMe();
      set({ user: me, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
