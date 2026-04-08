import { create } from 'zustand';

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
  reset: () => void;
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

  reset: () =>
    set({
      sidebarCollapsed: false,
      activeModal: null,
      dismissedQuestions: new Set<string>(),
      configuratorOpen: false,
    }),
}));
