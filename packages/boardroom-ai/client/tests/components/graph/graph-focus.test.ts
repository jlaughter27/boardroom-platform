import { describe, it, expect } from 'vitest';
import {
  FOCUS_HISTORY_MAX, breadcrumbs, canGoBack, canGoForward, createFocusHistory, currentFocus, goBack, goForward, pushFocus,
} from '../../../src/components/graph/graph-focus';

describe('graph-focus — focus history', () => {
  it('pushes, walks back and forward, and ignores re-focusing the current node', () => {
    let h = createFocusHistory();
    expect(currentFocus(h)).toBeNull();
    expect(canGoBack(h)).toBe(false);
    h = pushFocus(h, 'a');
    h = pushFocus(h, 'b');
    h = pushFocus(h, 'b'); // no-op
    h = pushFocus(h, 'c');
    expect(h.entries).toEqual(['a', 'b', 'c']);
    expect(currentFocus(h)).toBe('c');
    expect(canGoBack(h)).toBe(true);
    expect(canGoForward(h)).toBe(false);

    h = goBack(h);
    expect(currentFocus(h)).toBe('b');
    expect(canGoForward(h)).toBe(true);
    h = goBack(h);
    expect(currentFocus(h)).toBe('a');
    expect(goBack(h)).toBe(h); // at the start: unchanged object
    h = goForward(h);
    expect(currentFocus(h)).toBe('b');
  });

  it('drops forward entries when focusing after going back (browser semantics)', () => {
    let h = pushFocus(pushFocus(pushFocus(createFocusHistory(), 'a'), 'b'), 'c');
    h = goBack(h); // at b
    h = pushFocus(h, 'd');
    expect(h.entries).toEqual(['a', 'b', 'd']);
    expect(canGoForward(h)).toBe(false);
  });

  it('caps the history at 20 by dropping the oldest', () => {
    let h = createFocusHistory();
    for (let i = 0; i < FOCUS_HISTORY_MAX + 5; i++) h = pushFocus(h, `n${i}`);
    expect(h.entries).toHaveLength(FOCUS_HISTORY_MAX);
    expect(h.entries[0]).toBe('n5');
    expect(currentFocus(h)).toBe(`n${FOCUS_HISTORY_MAX + 4}`);
  });

  it('breadcrumbs show the trail up to the current entry', () => {
    let h = createFocusHistory();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) h = pushFocus(h, id);
    expect(breadcrumbs(h, 5)).toEqual(['c', 'd', 'e', 'f', 'g']);
    h = goBack(goBack(h));
    expect(breadcrumbs(h, 3)).toEqual(['c', 'd', 'e']);
    expect(breadcrumbs(createFocusHistory())).toEqual([]);
  });
});
