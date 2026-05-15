import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Lightbulb,
  Database,
  Users,
  Settings as SettingsIcon,
  UserCircle2,
  Plug,
  ShieldCheck,
  ChevronLeft,
} from 'lucide-react';
import { useUIStore } from '../../stores/ui.store';
import { useAuthStore } from '../../stores/auth.store';
import { Avatar } from '../ui/Avatar';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '../../lib/cn';

interface NavItemDef {
  to: string;
  label: string;
  icon: React.ReactNode;
}

const ICON_CLS = 'w-[18px] h-[18px]';

const primaryNav: NavItemDef[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className={ICON_CLS} aria-hidden /> },
  { to: '/decisions', label: 'Decisions', icon: <Lightbulb className={ICON_CLS} aria-hidden /> },
  { to: '/memory', label: 'Memory', icon: <Database className={ICON_CLS} aria-hidden /> },
  { to: '/people', label: 'People', icon: <Users className={ICON_CLS} aria-hidden /> },
];

// Items that show for every authenticated user.
const secondaryNavBase: NavItemDef[] = [
  { to: '/settings', label: 'Settings', icon: <SettingsIcon className={ICON_CLS} aria-hidden /> },
  { to: '/personas', label: 'Personas', icon: <UserCircle2 className={ICON_CLS} aria-hidden /> },
  { to: '/integrations', label: 'Integrations', icon: <Plug className={ICON_CLS} aria-hidden /> },
];

// Only rendered when /auth/me reports `isAdmin: true`.
const adminNavItem: NavItemDef = {
  to: '/admin',
  label: 'Admin',
  icon: <ShieldCheck className={ICON_CLS} aria-hidden />,
};

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
            ? 'text-sidebar-foreground bg-white/10'
            : 'text-sidebar-foreground-muted hover:text-sidebar-foreground hover:bg-white/10',
          collapsed && 'justify-center px-2'
        )}
      >
        {isActive && (
          <motion.div
            layoutId="nav-indicator"
            className="absolute left-0 top-1 bottom-1 w-0.5 bg-sidebar-foreground rounded-full"
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
  const secondaryNav: NavItemDef[] = user?.isAdmin
    ? [...secondaryNavBase, adminNavItem]
    : secondaryNavBase;

  return (
    <>
      {/* Brand */}
      <div className="flex items-center justify-between h-14 px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <Logo variant="icon" size={28} className="text-primary shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="font-display text-lg font-semibold tracking-tight whitespace-nowrap"
              >
                <span className="text-primary">Board</span>
                <span className="text-sidebar-foreground">Room AI</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <button
          onClick={toggleSidebar}
          className="hidden lg:block text-sidebar-foreground-muted hover:text-sidebar-foreground p-1.5 rounded-md hover:bg-white/10 transition-colors"
          aria-label="Toggle sidebar"
        >
          <motion.span
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="block"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden />
          </motion.span>
        </button>
      </div>

      {/* Primary navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {primaryNav.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
        ))}

        <div className="py-3">
          <div className="border-t border-sidebar-border" />
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
      <div className="border-t border-sidebar-border p-3">
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
                  <p className="text-sm font-medium text-sidebar-foreground truncate">{user.name}</p>
                  <button
                    onClick={() => logout()}
                    className="text-xs text-sidebar-foreground-muted hover:text-sidebar-foreground transition-colors"
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
      className="hidden md:flex flex-col bg-sidebar border-r border-sidebar-border h-screen overflow-hidden flex-shrink-0 shadow-sm"
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
            className="fixed left-0 top-0 bottom-0 w-60 flex flex-col bg-sidebar border-r border-sidebar-border z-[var(--z-modal)] md:hidden"
          >
            <SidebarContent collapsed={false} onNavigate={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
