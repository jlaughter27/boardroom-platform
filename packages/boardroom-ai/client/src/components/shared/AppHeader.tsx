import { useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { useSessionStore } from '../../stores/session.store';
import { useCommandPaletteStore } from '../../stores/commandPalette.store';
import { Avatar } from '../ui/Avatar';
import { Logo } from './Logo';
import { NotificationCenter } from './NotificationCenter';

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
          ? currentSession.question.slice(0, 40) + '\u2026'
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
    <header className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between h-14 px-4 md:px-6 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile hamburger */}
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
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
        <h1 className="text-lg font-semibold text-foreground truncate">{title}</h1>
        {breadcrumbs.length > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{'\u203A'}</span>
                {crumb.path ? (
                  <Link to={crumb.path} className="text-muted-foreground hover:text-primary transition-colors">
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

      <div className="flex items-center gap-3">
        {/* Search icon (mobile) */}
        <button
          onClick={toggle}
          className="sm:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Search"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
        {/* Cmd+K hint (desktop) */}
        <button
          onClick={toggle}
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          <kbd className="font-mono">{'\u2318'}K</kbd>
        </button>

        {/* Notifications */}
        <NotificationCenter />

        {/* User avatar */}
        {user && (
          <Avatar name={user.name || 'User'} size="sm" className="cursor-pointer" />
        )}
      </div>
    </header>
  );
}
