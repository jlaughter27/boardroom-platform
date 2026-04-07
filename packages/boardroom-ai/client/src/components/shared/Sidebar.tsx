import { NavLink } from 'react-router-dom';
import { useUIStore } from '../../stores/ui.store';
import { useAuthStore } from '../../stores/auth.store';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '\u{1F4CA}' },
  { to: '/decisions', label: 'Decision Lab', icon: '\u{26A1}' },
];

const memoryItems = [
  { to: '/memory', label: 'Explorer', icon: '\u{1F4DD}' },
  { to: '/people', label: 'People', icon: '\u{1F465}' },
];

const bottomItems = [
  { to: '/integrations', label: 'Integrations', icon: '\u{1F50C}' },
  { to: '/personas', label: 'Custom Personas', icon: '\u{1F9E0}' },
  { to: '/settings', label: 'Settings', icon: '\u{2699}\u{FE0F}' },
];

function NavItem({
  to,
  label,
  icon,
  collapsed,
}: {
  to: string;
  label: string;
  icon: string;
  collapsed: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-gray-800 text-white'
            : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
        } ${collapsed ? 'justify-center' : ''}`
      }
    >
      <span className="text-lg leading-none">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { user, logout } = useAuthStore();

  return (
    <aside
      className={`flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-200 ${
        sidebarCollapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-gray-800">
        {!sidebarCollapsed && (
          <span className="font-semibold text-white text-sm tracking-wide">
            BOARDROOM AI
          </span>
        )}
        <button
          onClick={toggleSidebar}
          className="text-gray-400 hover:text-white p-1"
          aria-label="Toggle sidebar"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => (
          <NavItem key={item.to} {...item} collapsed={sidebarCollapsed} />
        ))}

        {/* Divider + Memory section */}
        <div className="pt-4 pb-2">
          <div className="border-t border-gray-800" />
          {!sidebarCollapsed && (
            <span className="block px-3 pt-3 pb-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Memory
            </span>
          )}
        </div>

        {memoryItems.map((item) => (
          <NavItem key={item.to} {...item} collapsed={sidebarCollapsed} />
        ))}
      </nav>

      {/* Bottom section */}
      <div className="px-2 pb-4 space-y-1 border-t border-gray-800 pt-2">
        {bottomItems.map((item) => (
          <NavItem key={item.to} {...item} collapsed={sidebarCollapsed} />
        ))}

        {/* User info + logout */}
        {user && !sidebarCollapsed && (
          <div className="flex items-center justify-between px-3 py-2 mt-2">
            <span className="text-xs text-gray-500 truncate">
              {user.name}
            </span>
            <button
              onClick={() => logout()}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
