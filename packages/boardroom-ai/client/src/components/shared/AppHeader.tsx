import { useLocation, Link } from 'react-router-dom';
import { Menu as MenuIcon, Search } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { useSessionStore } from '../../stores/session.store';
import { useCommandPaletteStore } from '../../stores/commandPalette.store';
import { Avatar } from '../ui/Avatar';
import { Logo } from './Logo';
import { NotificationCenter } from './NotificationCenter';
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

/** Icon-only header control: 36 px hit area, hairline hover, press feedback. */
const ICON_BUTTON = cn(
  'inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground',
  'transition-[background-color,color,transform] duration-fast ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
);

export function AppHeader({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const location = useLocation();
  const title = getPageTitle(location.pathname);
  const currentSession = useSessionStore((s) => s.currentSession);
  const { user } = useAuthStore();
  const { toggle } = useCommandPaletteStore();

  // Build breadcrumbs with dynamic session question
  const breadcrumbs = (() => {
    if (location.pathname.startsWith('/decisions/')) {
      const sessionLabel = currentSession?.question
        ? currentSession.question.length > 40
          ? currentSession.question.slice(0, 40) + '…'
          : currentSession.question
        : 'Session';
      return [
        { label: 'Decision Lab', path: '/decisions' },
        { label: sessionLabel },
      ];
    }
    return [] as { label: string; path?: string }[];
  })();

  return (
    // The header is the navigation layer: material surface that reads the page
    // scrolling beneath it; the hairline replaces a hard border.
    <header
      className={cn(
        'sticky top-0 z-sticky flex h-14 items-center justify-between px-4 md:px-6',
        'material-clear !shadow-none border-b border-hairline'
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile hamburger */}
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className={cn(ICON_BUTTON, 'md:hidden -ml-2')}
            aria-label="Open menu"
          >
            <MenuIcon size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        {/* Mobile-only brand mark — Sidebar holds the brand on desktop, but on
            mobile the sidebar collapses into the hamburger, so the header
            becomes the only always-visible brand surface. */}
        <Link
          to="/"
          className="md:hidden flex items-center gap-2 text-primary"
          aria-label="BoardRoom AI home"
        >
          <Logo variant="icon" size={24} />
        </Link>
        <h1 className="text-lg font-semibold tracking-title text-foreground truncate">{title}</h1>
        {breadcrumbs.length > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{'›'}</span>
                {crumb.path ? (
                  <Link to={crumb.path} className="text-muted-foreground transition-colors duration-fast ease-out hover:text-primary">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{crumb.label}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {/* Search icon (mobile) */}
        <button onClick={toggle} className={cn(ICON_BUTTON, 'sm:hidden')} aria-label="Search">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {/* Cmd+K hint (desktop) */}
        <button
          onClick={toggle}
          className={cn(
            'hidden sm:inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline-strong px-2.5 text-xs text-muted-foreground',
            'transition-[background-color,color,border-color,transform] duration-fast ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          aria-label="Open command palette"
        >
          <Search size={14} strokeWidth={1.75} aria-hidden="true" />
          <kbd className="font-mono">{'⌘'}K</kbd>
        </button>

        {/* Notifications */}
        <NotificationCenter />

        {/* User avatar */}
        {user && (
          <Avatar name={user.name || 'User'} size="sm" className="ml-1.5 cursor-pointer" />
        )}
      </div>
    </header>
  );
}
