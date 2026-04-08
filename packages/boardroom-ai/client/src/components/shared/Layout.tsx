import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { pageTransition } from '../../lib/motion';
import { Sidebar, MobileDrawer } from './Sidebar';
import { AppHeader } from './AppHeader';
import { TrialBanner } from './TrialBanner';
import { ShortcutsModal } from './ShortcutsModal';
import { useNotificationAggregator } from '../../hooks/useNotificationAggregator';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

export function Layout() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useNotificationAggregator();
  const shortcuts = useKeyboardShortcuts();

  return (
    <div className="flex h-screen bg-bg-base font-sans text-text-primary">
      <Sidebar />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppHeader onMenuToggle={() => setDrawerOpen(true)} />
        <TrialBanner />
        <main className="flex-1 overflow-y-auto p-4 md:p-6" id="main-content">
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
