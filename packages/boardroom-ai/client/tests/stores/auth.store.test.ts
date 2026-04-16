import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAuthStore } from '../../src/stores/auth.store';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  getMe: vi.fn(),
}));

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset the store state before each test. `isLoading` defaults to true
    // in the real store because the app checks auth on mount — the "initial
    // state" test asserts that, so we must preserve it here.
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct initial values', () => {
      const { result } = renderHook(() => useAuthStore());
      expect(result.current.user).toBe(null);
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(true); // true initially
      expect(result.current.error).toBe(null);
    });
  });

  describe('login', () => {
    it('successfully logs in user', async () => {
      const mockUser = { id: '123', email: 'test@example.com', name: 'Test User' };
      vi.mocked(api.login).mockResolvedValue({ userId: '123', name: 'Test User' });
      vi.mocked(api.getMe).mockResolvedValue(mockUser);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'password123');
      });

      expect(api.login).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(api.getMe).toHaveBeenCalled();
      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('handles login failure', async () => {
      const error = new Error('Invalid credentials');
      vi.mocked(api.login).mockRejectedValue(error);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'wrongpass');
      });

      expect(result.current.error).toBe('Invalid credentials');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBe(null);
    });

    it('handles non-Error rejection', async () => {
      vi.mocked(api.login).mockRejectedValue('String error');

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'password');
      });

      expect(result.current.error).toBe('Login failed');
    });
  });

  describe('register', () => {
    it('successfully registers user', async () => {
      const mockUser = { id: '123', email: 'new@example.com', name: 'New User' };
      vi.mocked(api.register).mockResolvedValue({ userId: '123', name: 'New User' });
      vi.mocked(api.getMe).mockResolvedValue(mockUser);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.register('new@example.com', 'password123', 'New User');
      });

      expect(api.register).toHaveBeenCalledWith('new@example.com', 'password123', 'New User');
      expect(api.getMe).toHaveBeenCalled();
      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('handles registration failure', async () => {
      const error = new Error('Email already exists');
      vi.mocked(api.register).mockRejectedValue(error);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.register('existing@example.com', 'password123', 'Existing User');
      });

      expect(result.current.error).toBe('Email already exists');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBe(null);
    });
  });

  describe('logout', () => {
    it('successfully logs out user', async () => {
      // First, set a logged-in state
      useAuthStore.setState({
        user: { id: '123', email: 'test@example.com', name: 'Test User' },
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      vi.mocked(api.logout).mockResolvedValue({ status: 'ok' });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(api.logout).toHaveBeenCalled();
      expect(result.current.user).toBe(null);
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('checkAuth', () => {
    it('successfully authenticates existing user', async () => {
      const mockUser = { id: '123', email: 'test@example.com', name: 'Test User' };
      vi.mocked(api.getMe).mockResolvedValue(mockUser);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.checkAuth();
      });

      expect(api.getMe).toHaveBeenCalled();
      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });

    it('handles unauthenticated user', async () => {
      vi.mocked(api.getMe).mockRejectedValue(new Error('Not authenticated'));

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.checkAuth();
      });

      expect(result.current.user).toBe(null);
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('clearError', () => {
    it('clears error state', () => {
      useAuthStore.setState({ error: 'Some error' });

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBe(null);
    });
  });
});
