import { useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { useSessionStore } from '../../stores/session.store';
import { useCommandPaletteStore } from '../ui/CommandPalette';
import { Avatar } from '../ui/Avatar';
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


export function AppHeader() {
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
    <header className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between h-14 px-6 border-b border-line-subtle bg-bg-base/80 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
        {breadcrumbs.length > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="text-text-tertiary">{'\u203A'}</span>
                {crumb.path ? (
                  <Link to={crumb.path} className="text-text-secondary hover:text-accent transition-colors">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-text-primary">{crumb.label}</span>
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
        <NotificationCenter />

        {/* User avatar */}
        {user && (
          <Avatar name={user.name || 'User'} size="sm" className="cursor-pointer" />
        )}
      </div>
    </header>
  );
}
