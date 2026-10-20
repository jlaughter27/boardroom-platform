import { useEffect, useRef, useState, ViewTransition } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar, MobileDrawer } from './Sidebar';
import { AppHeader } from './AppHeader';
import { TrialBanner } from './TrialBanner';
import { ShortcutsModal } from './ShortcutsModal';
import { useNotificationAggregator } from '../../hooks/useNotificationAggregator';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useRouteTransitionTypes } from '../../hooks/useRouteTransition';
import { useScrolledSentinel } from '../../hooks/useScrolledSentinel';
import { useEntitiesStore } from '../../stores/entities.store';

/** `view-transition-name` of the routed page root (see `::view-transition-*(page)` in index.css). */
export const PAGE_TRANSITION_NAME = 'page';

export function Layout() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrolled = useScrolledSentinel(mainRef, sentinelRef);
  useNotificationAggregator();
  useRouteTransitionTypes();
  const shortcuts = useKeyboardShortcuts();

  // Decisions + commitments feed the dashboard nudges, cognitive-load warnings,
  // proactive questions and the command palette, but nothing fetched them (C-108).
  const fetchDecisions = useEntitiesStore((s) => s.fetchDecisions);
  const fetchCommitments = useEntitiesStore((s) => s.fetchCommitments);
  useEffect(() => {
    fetchDecisions();
    fetchCommitments();
  }, [fetchDecisions, fetchCommitments]);

  return (
    <div className="flex h-screen bg-background font-sans text-foreground">
      {/* Skip to content */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-toast bg-primary text-primary-foreground px-4 py-2 rounded-md"
      >
        Skip to content
      </a>
      <Sidebar />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppHeader onMenuToggle={() => setDrawerOpen(true)} scrolled={scrolled} />
        <TrialBanner />
        <main ref={mainRef} className="relative flex-1 overflow-y-auto p-4 md:p-6" id="main-content" role="main">
          {/* Scroll sentinel: the header reads the page behind it once this 1 px marker leaves view. */}
          <div ref={sentinelRef} aria-hidden="true" data-testid="scroll-sentinel" className="absolute inset-x-0 top-0 h-px" />
          {/*
            Route change = one View Transition on the page root: the router already
            wraps navigation in startTransition, `useRouteTransitionTypes` tags the
            direction, and index.css slides + fades `page` 10 px on --ease-out in
            180 ms (opacity only under reduced motion). In-place content updates
            never animate (`update="none"`); browsers without the API just swap.
            h-full lets full-height pages (the graph) size from the viewport;
            auto-height pages are unaffected and still scroll `main`.
          */}
          <ViewTransition key={location.pathname} name={PAGE_TRANSITION_NAME} update="none">
            <div className="h-full" data-page-root>
              <Outlet />
            </div>
          </ViewTransition>
        </main>
      </div>
      <ShortcutsModal shortcuts={shortcuts} />
    </div>
  );
}
