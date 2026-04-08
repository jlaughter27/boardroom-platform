import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { pageTransition } from '../../lib/motion';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';
import { TrialBanner } from './TrialBanner';

export function Layout() {
  const location = useLocation();
  return (
    <div className="flex h-screen bg-bg-base font-sans text-text-primary">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppHeader />
        <TrialBanner />
        <main className="flex-1 overflow-y-auto p-6" id="main-content">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} {...pageTransition}>
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
