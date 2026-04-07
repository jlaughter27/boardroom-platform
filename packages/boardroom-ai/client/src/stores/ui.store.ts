import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  activeModal: string | null;
  openModal: (id: string) => void;
  closeModal: () => void;
  dismissedQuestions: Set<string>;
  dismissQuestion: (id: string) => void;
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
}));
