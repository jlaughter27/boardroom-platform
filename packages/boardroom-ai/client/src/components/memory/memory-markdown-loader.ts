import { lazy } from 'react';

/**
 * The markdown renderer (react-markdown + remark-gfm, ~170 kB raw / ~52 kB gz)
 * lives in its own chunk: the explorer list paints without it, and the list
 * prefetches it when idle so it is ready by the time a memory is opened.
 */
let pending: Promise<typeof import('./MemoryMarkdown')> | null = null;

function load() {
  pending ??= import('./MemoryMarkdown').catch((err) => { pending = null; throw err; });
  return pending;
}

export const LazyMemoryMarkdown = lazy(() => load().then((m) => ({ default: m.MemoryMarkdown })));

/** Warm the renderer chunk without blocking (called once the memory list is on screen). */
export function preloadMemoryMarkdown(): void {
  const run = () => { load().catch(() => { /* retried on first open */ }); };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 2000 });
  else setTimeout(run, 200);
}
