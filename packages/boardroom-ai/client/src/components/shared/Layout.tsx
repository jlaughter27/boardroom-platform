import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { pageTransition } from '../../lib/motion';
import { Sidebar, MobileDrawer } from './Sidebar';
import { AppHeader } from './AppHeader';
import { TrialBanner } from './TrialBanner';
import { ShortcutsModal } from './ShortcutsModal';
import { useNotificationAggregator } from '../../hooks/useNotificationAggregator';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useEntitiesStore } from '../../stores/entities.store';

export function Layout() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useNotificationAggregator();
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
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 bg-primary text-primary-foreground px-4 py-2 rounded-md"
      >
        Skip to content
      </a>
      <Sidebar />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppHeader onMenuToggle={() => setDrawerOpen(true)} />
        <TrialBanner />
        <main className="flex-1 overflow-y-auto p-4 md:p-6" id="main-content" role="main">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} {...pageTransition}>
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <ShortcutsModal shortcuts={shortcuts} />
    </div>
  );
}
