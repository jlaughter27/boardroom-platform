import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { useCommandPaletteStore } from '../ui/CommandPalette';
import { Avatar } from '../ui/Avatar';
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
  const { user } = useAuthStore();
  const { toggle } = useCommandPaletteStore();

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
        <NotificationCenter />

        {/* User avatar */}
        {user && (
          <Avatar name={user.name || 'User'} size="sm" className="cursor-pointer" />
        )}
      </div>
    </header>
  );
}
