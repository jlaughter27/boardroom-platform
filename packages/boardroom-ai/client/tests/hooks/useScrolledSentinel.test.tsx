import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useScrolledSentinel } from '../../src/hooks/useScrolledSentinel';

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let callback: IOCallback | null = null;
let observed: Element | null = null;
let options: IntersectionObserverInit | undefined;
const disconnect = vi.fn();

function Harness() {
  const root = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const scrolled = useScrolledSentinel(root, sentinel);
  return (
    <main ref={root} data-testid="main">
      <div ref={sentinel} data-testid="sentinel" />
      <span data-testid="state">{scrolled ? 'scrolled' : 'top'}</span>
    </main>
  );
}

describe('useScrolledSentinel', () => {
  const original = global.IntersectionObserver;
  beforeEach(() => {
    callback = null; observed = null; options = undefined; disconnect.mockClear();
    global.IntersectionObserver = vi.fn().mockImplementation((cb: IOCallback, opts: IntersectionObserverInit) => {
      callback = cb; options = opts;
      return { observe: (el: Element) => { observed = el; }, unobserve: vi.fn(), disconnect };
    }) as unknown as typeof IntersectionObserver;
  });
  afterEach(() => { global.IntersectionObserver = original; });

  it('observes the sentinel inside the scroll container and flips when it leaves view', () => {
    const { unmount } = render(<Harness />);
    expect(observed).toBe(screen.getByTestId('sentinel'));
    expect(options?.root).toBe(screen.getByTestId('main'));
    expect(screen.getByTestId('state').textContent).toBe('top');

    act(() => { callback?.([{ isIntersecting: false }]); });
    expect(screen.getByTestId('state').textContent).toBe('scrolled');

    act(() => { callback?.([{ isIntersecting: true }]); });
    expect(screen.getByTestId('state').textContent).toBe('top');

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('stays at the top when the environment has no IntersectionObserver', () => {
    // (React itself attaches a root-level scroll listener, so "no scroll listener"
    // is enforced on the source by ui-standards.test.ts, not here.)
    global.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
    render(<Harness />);
    expect(screen.getByTestId('state').textContent).toBe('top');
  });
});
