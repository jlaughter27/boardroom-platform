import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';

function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', isDark);
  localStorage.setItem('theme', theme);
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('theme') as Theme | null;
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  activeModal: string | null;
  openModal: (id: string) => void;
  closeModal: () => void;
  dismissedQuestions: Set<string>;
  dismissQuestion: (id: string) => void;
  configuratorOpen: boolean;
  openConfigurator: () => void;
  closeConfigurator: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  activeModal: null,
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  dismissedQuestions: new Set<string>(),
  dismissQuestion: (id) =>
    set((state) => {
      const next = new Set(state.dismissedQuestions);
      next.add(id);
      return { dismissedQuestions: next };
    }),

  configuratorOpen: false,
  openConfigurator: () => set({ configuratorOpen: true }),
  closeConfigurator: () => set({ configuratorOpen: false }),

  theme: getInitialTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

// Listen for system preference changes when theme is 'system'
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const { theme } = useUIStore.getState();
  if (theme === 'system') applyTheme('system');
});

// Apply theme on initial load (in case FOUC script didn't run or theme is 'system')
applyTheme(getInitialTheme());
