import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useCortexStore } from '../../stores/cortex.store';
import { useAuthStore } from '../../stores/auth.store';
import { useCommandPaletteStore } from '../ui/CommandPalette';
import { Avatar } from '../ui/Avatar';
import { cn } from '../../lib/cn';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/decisions': 'Decision Lab',
  '/memory': 'Memory Explorer',
  '/people': 'People Directory',
  '/settings': 'Settings',
  '/personas': 'Custom Personas',
  '/integrations': 'Integrations',
};

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/decisions/')) return 'Decision Session';
  return pageTitles[pathname] || 'BoardRoom AI';
}

function getBreadcrumbs(pathname: string): { label: string; path?: string }[] {
  if (pathname.startsWith('/decisions/')) {
    return [
      { label: 'Decision Lab', path: '/decisions' },
      { label: 'Session' },
    ];
  }
  return [];
}

export function AppHeader() {
  const location = useLocation();
  const title = getPageTitle(location.pathname);
  const breadcrumbs = getBreadcrumbs(location.pathname);
  const { contradictions } = useCortexStore();
  const { user } = useAuthStore();
  const { toggle } = useCommandPaletteStore();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const unreadCount = contradictions.length;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between h-14 px-6 border-b border-line-subtle bg-bg-base/80 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
        {breadcrumbs.length > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-text-tertiary">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="text-text-tertiary">/</span>
                {crumb.path ? (
                  <a href={crumb.path} className="hover:text-text-secondary transition-colors">
                    {crumb.label}
                  </a>
                ) : (
                  <span className="text-text-secondary">{crumb.label}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Cmd+K hint */}
        <button
          onClick={toggle}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-line text-xs text-text-tertiary hover:text-text-secondary hover:border-line-strong transition-colors"
        >
          <kbd className="font-mono">{'\u2318'}K</kbd>
        </button>

        {/* Notifications */}
        <div ref={notifRef} className="relative">
          <button
            onClick={() => setNotifOpen(!notifOpen)}
            className="relative p-2 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {notifOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-line bg-bg-elevated shadow-lg overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-line">
                  <h3 className="text-sm font-medium text-text-primary">Notifications</h3>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {contradictions.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-text-tertiary">
                      No notifications
                    </p>
                  ) : (
                    contradictions.slice(0, 5).map((c) => (
                      <div key={c.id} className="px-4 py-3 border-b border-line-subtle hover:bg-bg-hover transition-colors">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 flex-shrink-0 w-2 h-2 rounded-full bg-warning" />
                          <div>
                            <p className="text-sm text-text-primary">{c.description}</p>
                            <p className="text-xs text-text-tertiary mt-1">Contradiction detected</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User avatar */}
        {user && (
          <Avatar name={user.name || 'User'} size="sm" className="cursor-pointer" />
        )}
      </div>
    </header>
  );
}
