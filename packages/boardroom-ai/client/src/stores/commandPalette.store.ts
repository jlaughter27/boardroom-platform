import { create } from 'zustand';

interface CommandPaletteStore {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));
