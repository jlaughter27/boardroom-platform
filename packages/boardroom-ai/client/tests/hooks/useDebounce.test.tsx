import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDebounce } from '../../src/hooks/useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 500));
    expect(result.current).toBe('initial');
  });

  it('does not update immediately when value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 500 },
      }
    );

    expect(result.current).toBe('initial');

    rerender({ value: 'updated', delay: 500 });
    expect(result.current).toBe('initial'); // Still initial after immediate render
  });

  it('updates after delay when value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 500 },
      }
    );

    rerender({ value: 'updated', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe('initial'); // Still initial after 250ms

    act(() => {
      vi.advanceTimersByTime(250); // Total 500ms
    });
    expect(result.current).toBe('updated'); // Now updated after full delay
  });

  it('handles multiple rapid changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 500 },
      }
    );

    rerender({ value: 'change1', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'change2', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'change3', delay: 500 });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'final', delay: 500 });

    expect(result.current).toBe('initial'); // Still initial after 300ms

    act(() => {
      vi.advanceTimersByTime(200); // Total 500ms from last change
    });
    expect(result.current).toBe('final'); // Only final value after delay
  });

  it('cleans up timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const { unmount } = renderHook(() => useDebounce('test', 500));

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('respects different delay values', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 1000 },
      }
    );

    rerender({ value: 'updated', delay: 1000 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe('initial'); // Still initial after 500ms (half of 1000ms delay)

    act(() => {
      vi.advanceTimersByTime(500); // Total 1000ms
    });
    expect(result.current).toBe('updated'); // Now updated after full 1000ms delay
  });

  it('updates immediately when delay is 0', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      {
        initialProps: { value: 'initial', delay: 0 },
      }
    );

    rerender({ value: 'updated', delay: 0 });
    expect(result.current).toBe('updated'); // Immediate update with 0 delay
  });
});
