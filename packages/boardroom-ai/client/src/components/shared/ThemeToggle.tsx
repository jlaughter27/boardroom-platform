import { useUIStore } from '../../stores/ui.store';

export function ThemeToggle() {
  const { theme, setTheme } = useUIStore();

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const icon = theme === 'dark' ? '\u263E' : theme === 'light' ? '\u2600' : '\u25D0';
  const label = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors text-xs"
      aria-label={`Theme: ${label}. Click to change.`}
    >
      <span className="text-sm">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
