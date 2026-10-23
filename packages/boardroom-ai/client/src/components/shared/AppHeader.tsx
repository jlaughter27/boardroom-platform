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
  '/graph': 'Knowledge Graph',
  '/settings': 'Settings',
  '/personas': 'Custom Personas',
  '/integrations': 'Integrations',
  '/admin': 'Admin',
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

interface AppHeaderProps {
  onMenuToggle?: () => void;
  /**
   * True once the page has scrolled under the header (Layout derives it from
   * an IntersectionObserver sentinel, never a scroll listener). At rest the
   * header sits flush with the page; scrolled, it turns into material that
   * reads the content beneath and draws its bottom hairline.
   */
  scrolled?: boolean;
}

export function AppHeader({ onMenuToggle, scrolled = false }: AppHeaderProps) {
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
    // The header is the navigation layer. Height never changes between states,
    // so nothing below it reflows; only the surface and the hairline do.
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        'sticky top-0 z-sticky flex h-14 shrink-0 items-center justify-between px-4 md:px-6',
        // Secondary text in the header always uses the on-glass step, so nothing shifts colour when the material switches on.
        '[--color-muted-foreground:var(--color-muted-foreground-on-glass)]',
        'border-b transition-[background-color,border-color] duration-normal ease-out',
        scrolled
          ? 'material !shadow-none border-hairline'
          : 'bg-background border-transparent'
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
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
        <p className="min-w-0 truncate text-lg md:shrink-0 font-semibold leading-9 tracking-title text-foreground" data-testid="app-header-title">{title}</p>
        {/* Breadcrumbs are a desktop affordance: below md the row has room for
            the title only, and a wrapped crumb trail overlapped the page. Each
            crumb stays on one line and the trail truncates instead of wrapping. */}
        {breadcrumbs.length > 0 && (
          <div className="hidden min-w-0 items-center gap-1.5 whitespace-nowrap text-sm leading-9 md:flex" data-testid="app-header-breadcrumbs">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-muted-foreground">{'›'}</span>
                {crumb.path ? (
                  <Link to={crumb.path} className="shrink-0 text-muted-foreground transition-colors duration-fast ease-out hover:text-primary">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="truncate text-foreground">{crumb.label}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Every control on the right shares one 36 px row: search pill, bell and avatar sit on the same centre line. */}
      <div className="flex h-9 items-center gap-1.5">
        {/* Search icon (mobile) */}
        <button onClick={toggle} className={cn(ICON_BUTTON, 'sm:hidden')} aria-label="Search">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {/* Cmd+K hint (desktop) — a capsule pill, the same height as the icon buttons */}
        <button
          onClick={toggle}
          className={cn(
            'hidden sm:inline-flex h-9 items-center gap-1.5 rounded-capsule border border-hairline-strong px-3 text-xs text-muted-foreground',
            'transition-[background-color,color,border-color,transform] duration-fast ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          aria-label="Open command palette"
        >
          <Search size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="leading-none">Search</span>
          <kbd className="font-mono leading-none text-[11px]">{'⌘'}K</kbd>
        </button>

        {/* Notifications */}
        <NotificationCenter />

        {/* User avatar — centred in the same 36 px cell as the icon buttons */}
        {user && (
          <span className="ml-1 grid h-9 w-9 place-items-center">
            <Avatar name={user.name || 'User'} size="md" className="cursor-pointer" />
          </span>
        )}
      </div>
    </header>
  );
}
