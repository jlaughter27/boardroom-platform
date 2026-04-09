import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore } from '../../stores/ui.store';
import { useAuthStore } from '../../stores/auth.store';
import { Avatar } from '../ui/Avatar';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '../../lib/cn';

interface NavItemDef {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const primaryNav: NavItemDef[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
      </svg>
    ),
  },
  {
    to: '/decisions',
    label: 'Decisions',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    to: '/memory',
    label: 'Memory',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
  },
  {
    to: '/people',
    label: 'People',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const secondaryNav: NavItemDef[] = [
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    to: '/personas',
    label: 'Personas',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    to: '/integrations',
    label: 'Integrations',
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
  },
];

function NavItem({ item, collapsed, onNavigate }: { item: NavItemDef; collapsed: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);

  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className="relative block"
      onClick={onNavigate}
    >
      <div
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors relative min-h-[44px]',
          isActive
            ? 'text-white bg-white/10'
            : 'text-white/50 hover:text-white/80 hover:bg-white/10',
          collapsed && 'justify-center px-2'
        )}
      >
        {isActive && (
          <motion.div
            layoutId="nav-indicator"
            className="absolute left-0 top-1 bottom-1 w-0.5 bg-white rounded-full"
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          />
        )}
        <span className="flex-shrink-0">{item.icon}</span>
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="overflow-hidden whitespace-nowrap"
            >
              {item.label}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </NavLink>
  );
}

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { toggleSidebar } = useUIStore();
  const { user, logout } = useAuthStore();

  return (
    <>
      {/* Brand */}
      <div className="flex items-center justify-between h-14 px-4 border-b border-white/10">
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="font-display text-lg font-bold tracking-tight"
            >
              <span className="text-blue-400">Board</span><span className="text-white">Room AI</span>
            </motion.span>
          )}
        </AnimatePresence>
        <button
          onClick={toggleSidebar}
          className="hidden lg:block text-white/40 hover:text-white/80 p-1.5 rounded-md hover:bg-white/10 transition-colors"
          aria-label="Toggle sidebar"
        >
          <motion.svg
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </motion.svg>
        </button>
      </div>

      {/* Primary navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {primaryNav.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}

        <div className="py-3">
          <div className="border-t border-white/10" />
        </div>

        {secondaryNav.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>

      {/* Theme toggle */}
      {!collapsed && (
        <div className="px-3 pb-2">
          <ThemeToggle />
        </div>
      )}

      {/* User section */}
      <div className="border-t border-white/10 p-3">
        {user && (
          <div className={cn(
            'flex items-center gap-3',
            collapsed && 'justify-center'
          )}>
            <Avatar name={user.name || 'User'} size="sm" />
            <AnimatePresence>
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="flex-1 overflow-hidden"
                >
                  <p className="text-sm font-medium text-white truncate">{user.name}</p>
                  <button
                    onClick={() => logout()}
                    className="text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </>
  );
}

export function Sidebar() {
  const { sidebarCollapsed } = useUIStore();

  // Desktop sidebar (hidden below md)
  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 64 : 240 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className="hidden md:flex flex-col bg-[#1c1b1a] border-r border-[#2a2a28] h-screen overflow-hidden flex-shrink-0 shadow-sm"
    >
      <SidebarContent collapsed={sidebarCollapsed} />
    </motion.aside>
  );
}

export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();

  // Close on route change
  useEffect(() => {
    if (open) onClose();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/50 z-[var(--z-modal-backdrop)] md:hidden"
            onClick={onClose}
          />
          {/* Drawer */}
          <motion.aside
            initial={{ x: -240 }}
            animate={{ x: 0 }}
            exit={{ x: -240 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="fixed left-0 top-0 bottom-0 w-60 flex flex-col bg-[#1c1b1a] border-r border-white/10 z-[var(--z-modal)] md:hidden"
          >
            <SidebarContent collapsed={false} onNavigate={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
