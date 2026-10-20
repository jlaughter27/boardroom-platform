import { useEffect, useId, type ComponentType } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChartColumn,
  ChevronLeft,
  Database,
  Drama,
  LayoutDashboard,
  Plug,
  Scale,
  Settings,
  Users,
  Waypoints,
  type LucideProps,
} from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';
import { useAuthStore } from '../../stores/auth.store';
import { Avatar } from '../ui/Avatar';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { DURATION, EASE_IN_OUT, EASE_OUT, EASE_SHEET, instant, springs } from '../../lib/motion';
import { cn } from '../../lib/cn';

interface NavItemDef {
  to: string;
  label: string;
  /** Lucide glyph — one set, one stroke weight (1.75), 18 px in navigation. */
  icon: ComponentType<LucideProps>;
  /** Only shown to users with `isAdmin` (C-103). */
  adminOnly?: boolean;
}

const primaryNav: NavItemDef[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/decisions', label: 'Decisions', icon: Scale },
  { to: '/memory', label: 'Memory', icon: Database },
  { to: '/people', label: 'People', icon: Users },
  { to: '/graph', label: 'Graph', icon: Waypoints },
];

const secondaryNav: NavItemDef[] = [
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/personas', label: 'Personas', icon: Drama },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/admin', label: 'Admin', adminOnly: true, icon: ChartColumn },
];

const NAV_ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

/**
 * Set when the last navigation was activated from the keyboard (Enter / Space
 * on a focused link report `detail === 0`). The active indicator then moves
 * instantly — keyboard-driven changes get no animation (motion rule 3).
 * Module-scoped on purpose: the indicator renders in the *new* active item,
 * not the one that was clicked.
 */
let lastNavFromKeyboard = false;

function NavItem({ item, collapsed, onNavigate, layoutId }: { item: NavItemDef; collapsed: boolean; onNavigate?: () => void; layoutId: string }) {
  const location = useLocation();
  const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
  const Icon = item.icon;

  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className="group relative block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      onClick={(e) => { lastNavFromKeyboard = e.detail === 0; onNavigate?.(); }}
      aria-label={collapsed ? item.label : undefined}
    >
      <div
        className={cn(
          'relative flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium',
          'transition-[color] duration-fast ease-out',
          isActive ? 'text-white' : 'text-white/55 hover:text-white/85',
          collapsed && 'justify-center px-2'
        )}
      >
        {/* Hover wash — a separate layer so the sliding active pill never fights it. */}
        {!isActive && <span aria-hidden="true" className="absolute inset-0 rounded-md transition-[background-color] duration-fast ease-out group-hover:bg-white/[0.07]" />}
        {isActive && (
          // One shared pill slides between items on the snappy spring; a 2 px
          // leading bar inside it keeps the "current page" mark legible when collapsed.
          <motion.span
            layoutId={layoutId}
            aria-hidden="true"
            data-testid="nav-indicator"
            className="absolute inset-0 rounded-md bg-white/10 shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.06),0_0_0_1px_hsl(0_0%_100%/0.06)]"
            transition={lastNavFromKeyboard ? instant : springs.snappy}
          >
            <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-capsule bg-primary" />
          </motion.span>
        )}
        <span className="relative flex shrink-0 translate-y-[0.5px]"><Icon {...NAV_ICON} /></span>
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: DURATION.normal, ease: EASE_OUT }}
              className="relative overflow-hidden whitespace-nowrap"
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
  // One indicator per sidebar instance (desktop aside and mobile drawer each have their own).
  const indicatorId = useId();

  return (
    <>
      {/* Brand */}
      <div className="flex items-center justify-between h-14 px-4 border-b border-sidebar-hairline">
        <div className="flex items-center gap-2.5 min-w-0">
          <Logo variant="icon" size={28} className="text-primary shrink-0" />
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                className="font-display text-lg font-semibold tracking-title whitespace-nowrap"
              >
                <span className="text-primary">Board</span>
                <span className="text-white">Room AI</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <button
          onClick={toggleSidebar}
          className={cn(
            'hidden lg:flex h-7 w-7 items-center justify-center rounded-md text-white/40',
            'transition-[background-color,color,transform] duration-fast ease-out hover:bg-white/10 hover:text-white/80 active:scale-[0.97]'
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <motion.span
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: DURATION.normal, ease: EASE_IN_OUT }}
            className="flex"
          >
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          </motion.span>
        </button>
      </div>

      {/* Primary navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {primaryNav.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} layoutId={indicatorId} />
        ))}

        <div className="py-3">
          <div className="border-t border-sidebar-hairline" />
        </div>

        {secondaryNav
          .filter((item) => !item.adminOnly || user?.isAdmin)
          .map((item) => (
            <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} layoutId={indicatorId} />
          ))}
      </nav>

      {/* Theme toggle */}
      {!collapsed && (
        <div className="px-3 pb-2">
          <ThemeToggle />
        </div>
      )}

      {/* User section */}
      <div className="border-t border-sidebar-hairline p-3">
        {user && (
          <div className={cn(
            'flex items-center gap-3',
            collapsed && 'justify-center'
          )}>
            <Avatar name={user.name || 'User'} size="sm" />
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: DURATION.normal, ease: EASE_OUT }}
                  className="flex-1 overflow-hidden"
                >
                  <p className="text-sm font-medium text-white truncate">{user.name}</p>
                  <button
                    onClick={() => logout()}
                    className="text-xs text-white/40 transition-colors duration-fast ease-out hover:text-white/70"
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

  // Desktop sidebar (hidden below md). Width changes while on screen → ease-in-out.
  return (
    <motion.aside
      animate={{ width: sidebarCollapsed ? 64 : 240 }}
      transition={{ duration: DURATION.slow, ease: EASE_IN_OUT }}
      className="hidden md:flex flex-col bg-sidebar h-screen overflow-hidden flex-shrink-0 shadow-sidebar-highlight"
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
            transition={{ duration: DURATION.normal, ease: EASE_OUT }}
            className="fixed inset-0 bg-black/40 z-modal-backdrop md:hidden"
            onClick={onClose}
          />
          {/* Drawer — a sheet from the leading edge */}
          <motion.aside
            initial={{ x: -240 }}
            animate={{ x: 0 }}
            exit={{ x: -240 }}
            transition={{ duration: DURATION.sheet, ease: EASE_SHEET }}
            className="fixed left-0 top-0 bottom-0 w-60 flex flex-col bg-sidebar z-modal shadow-xl md:hidden"
          >
            <SidebarContent collapsed={false} onNavigate={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
