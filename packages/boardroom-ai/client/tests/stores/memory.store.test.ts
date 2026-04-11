import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMemoryStore } from '../../src/stores/memory.store';
import * as api from '../../src/lib/api';
import type { Memory } from '@boardroom/shared';

vi.mock('../../src/lib/api', () => ({
  listMemories: vi.fn(),
  updateMemory: vi.fn(),
  archiveMemory: vi.fn(),
}));

vi.mock('../../src/components/ui/Toast', () => ({
  useToastStore: {
    getState: () => ({
      addToast: vi.fn(),
    }),
  },
}));

const mockMemory: Memory = {
  id: '1',
  userId: 'user1',
  content: 'Test memory content',
  summary: 'Test summary',
  domain: 'work',
  memoryClass: 'meeting',
  tags: ['test', 'meeting'],
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockMemory2: Memory = {
  id: '2',
  userId: 'user1',
  content: 'Second memory content',
  summary: 'Second summary',
  domain: 'personal',
  memoryClass: 'note',
  tags: ['personal'],
  status: 'active',
  createdAt: '2024-01-02T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

describe('useMemoryStore', () => {
  beforeEach(() => {
    // Reset the store state before each test
    useMemoryStore.setState({
      memories: [],
      selectedMemory: null,
      filters: {},
      isLoading: false,
      total: 0,
      offset: 0,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct initial values', () => {
      const { result } = renderHook(() => useMemoryStore());
      expect(result.current.memories).toEqual([]);
      expect(result.current.selectedMemory).toBe(null);
      expect(result.current.filters).toEqual({});
      expect(result.current.isLoading).toBe(false);
      expect(result.current.total).toBe(0);
      expect(result.current.offset).toBe(0);
      expect(result.current.error).toBe(null);
    });
  });

  describe('search', () => {
    it('successfully searches memories', async () => {
      const mockResponse = {
        items: [mockMemory, mockMemory2],
        total: 2,
        limit: 20,
        offset: 0,
      };
      vi.mocked(api.listMemories).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.search({ q: 'test' });
      });

      expect(api.listMemories).toHaveBeenCalledWith({
        q: 'test',
        limit: 20,
        offset: 0,
      });
      expect(result.current.memories).toEqual([mockMemory, mockMemory2]);
      expect(result.current.total).toBe(2);
      expect(result.current.offset).toBe(2);
      expect(result.current.filters).toEqual({ q: 'test' });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('handles search failure', async () => {
      const error = new Error('Failed to fetch');
      vi.mocked(api.listMemories).mockRejectedValue(error);

      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.search({ q: 'test' });
      });

      expect(result.current.error).toBe('Failed to fetch');
      expect(result.current.isLoading).toBe(false);
      expect(result.current.memories).toEqual([]);
    });

    it('uses existing filters when no override provided', async () => {
      const mockResponse = {
        items: [mockMemory],
        total: 1,
        limit: 20,
        offset: 0,
      };
      vi.mocked(api.listMemories).mockResolvedValue(mockResponse);

      // First set filters
      useMemoryStore.setState({ filters: { domain: 'work' } });
      
      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.search(); // No override
      });

      expect(api.listMemories).toHaveBeenCalledWith({
        domain: 'work',
        limit: 20,
        offset: 0,
      });
    });
  });

  describe('loadMore', () => {
    it('loads more memories when there are more to load', async () => {
      // Initial state with some memories already loaded
      useMemoryStore.setState({
        memories: [mockMemory],
        total: 3,
        offset: 1,
        filters: { q: 'test' },
      });

      const mockResponse = {
        items: [mockMemory2],
        total: 3,
        limit: 20,
        offset: 1,
      };
      vi.mocked(api.listMemories).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.loadMore();
      });

      expect(api.listMemories).toHaveBeenCalledWith({
        q: 'test',
        limit: 20,
        offset: 1,
      });
      expect(result.current.memories).toEqual([mockMemory, mockMemory2]);
      expect(result.current.offset).toBe(2);
    });

    it('does not load more when already loading', async () => {
      useMemoryStore.setState({ isLoading: true });
      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.loadMore();
      });

      expect(api.listMemories).not.toHaveBeenCalled();
    });

    it('does not load more when all memories loaded', async () => {
      useMemoryStore.setState({ offset: 10, total: 10 });
      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.loadMore();
      });

      expect(api.listMemories).not.toHaveBeenCalled();
    });
  });

  describe('select and clearSelection', () => {
    it('selects a memory by id', () => {
      useMemoryStore.setState({
        memories: [mockMemory, mockMemory2],
      });

      const { result } = renderHook(() => useMemoryStore());

      act(() => {
        result.current.select('2');
      });

      expect(result.current.selectedMemory).toEqual(mockMemory2);
    });

    it('returns null when memory not found', () => {
      useMemoryStore.setState({
        memories: [mockMemory],
        selectedMemory: mockMemory,
      });

      const { result } = renderHook(() => useMemoryStore());

      act(() => {
        result.current.select('non-existent');
      });

      expect(result.current.selectedMemory).toBe(null);
    });

    it('clears selection', () => {
      useMemoryStore.setState({
        selectedMemory: mockMemory,
      });

      const { result } = renderHook(() => useMemoryStore());

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedMemory).toBe(null);
    });
  });

  describe('updateMemory', () => {
    it('successfully updates a memory', async () => {
      const updatedMemory = { ...mockMemory, summary: 'Updated summary' };
      vi.mocked(api.updateMemory).mockResolvedValue(updatedMemory);

      useMemoryStore.setState({
        memories: [mockMemory, mockMemory2],
        selectedMemory: mockMemory,
      });

      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.updateMemory('1', { summary: 'Updated summary' });
      });

      expect(api.updateMemory).toHaveBeenCalledWith('1', { summary: 'Updated summary' });
      expect(result.current.memories[0]).toEqual(updatedMemory);
      expect(result.current.selectedMemory).toEqual(updatedMemory);
    });

    it('updates only the relevant memory when selected memory is different', async () => {
      const updatedMemory = { ...mockMemory, summary: 'Updated summary' };
      vi.mocked(api.updateMemory).mockResolvedValue(updatedMemory);

      useMemoryStore.setState({
        memories: [mockMemory, mockMemory2],
        selectedMemory: mockMemory2, // Different memory selected
      });

      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.updateMemory('1', { summary: 'Updated summary' });
      });

      expect(result.current.memories[0]).toEqual(updatedMemory);
      expect(result.current.selectedMemory).toEqual(mockMemory2); // Still the same
    });
  });

  describe('archiveMemory', () => {
    it('successfully archives a memory', async () => {
      vi.mocked(api.archiveMemory).mockResolvedValue(undefined);

      useMemoryStore.setState({
        memories: [mockMemory, mockMemory2],
        selectedMemory: mockMemory,
        total: 2,
      });

      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.archiveMemory('1');
      });

      expect(api.archiveMemory).toHaveBeenCalledWith('1');
      expect(result.current.memories).toEqual([mockMemory2]);
      expect(result.current.selectedMemory).toBe(null);
      expect(result.current.total).toBe(1);
    });

    it('does not clear selection when archiving different memory', async () => {
      vi.mocked(api.archiveMemory).mockResolvedValue(undefined);

      useMemoryStore.setState({
        memories: [mockMemory, mockMemory2],
        selectedMemory: mockMemory2,
        total: 2,
      });

      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        await result.current.archiveMemory('1');
      });

      expect(result.current.memories).toEqual([mockMemory2]);
      expect(result.current.selectedMemory).toEqual(mockMemory2); // Still selected
    });
  });

  describe('setFilters', () => {
    it('sets filters and triggers search', async () => {
      const mockResponse = {
        items: [mockMemory],
        total: 1,
        limit: 20,
        offset: 0,
      };
      vi.mocked(api.listMemories).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useMemoryStore());

      await act(async () => {
        result.current.setFilters({ domain: 'work', memoryClass: 'meeting' });
      });

      expect(result.current.filters).toEqual({ domain: 'work', memoryClass: 'meeting' });
      expect(api.listMemories).toHaveBeenCalledWith({
        domain: 'work',
        memoryClass: 'meeting',
        limit: 20,
        offset: 0,
      });
    });

    it('removes empty filter values', async () => {
      const mockResponse = {
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      };
      vi.mocked(api.listMemories).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      // Set initial filters
      useMemoryStore.setState({ filters: { domain: 'work', q: 'test' } });
      
      await act(async () => {
        useMemoryStore.getState().setFilters({ domain: '', q: undefined });
      });

      // Empty values should be removed
      const filters = useMemoryStore.getState().filters;
      expect(filters.domain).toBeUndefined();
      expect(filters.q).toBeUndefined();
    });
  });

  describe('clearError', () => {
    it('clears error state', () => {
      useMemoryStore.setState({ error: 'Some error' });
      
      const { result } = renderHook(() => useMemoryStore());

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBe(null);
    });
  });
});
