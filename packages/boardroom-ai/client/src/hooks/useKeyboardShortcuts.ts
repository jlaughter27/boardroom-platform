import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCommandPaletteStore } from '../stores/commandPalette.store';
import { useUIStore } from '../stores/ui.store';

export interface ShortcutDef {
  key: string;
  meta?: boolean;
  shift?: boolean;
  label: string;
  description: string;
  action: () => void;
}

let shortcutsModalToggle: (() => void) | null = null;

export function setShortcutsModalToggle(fn: () => void) {
  shortcutsModalToggle = fn;
}

export function useKeyboardShortcuts() {
  const navigate = useNavigate();
  const { toggle: togglePalette } = useCommandPaletteStore();
  const { openModal } = useUIStore();

  const shortcuts: ShortcutDef[] = [
    { key: 'k', meta: true, label: '\u2318K', description: 'Command palette', action: togglePalette },
    { key: 'n', meta: true, label: '\u2318N', description: 'New Decision Session', action: () => navigate('/decisions/new') },
    { key: 'g', meta: true, shift: true, label: '\u2318\u21E7G', description: 'Go to Dashboard', action: () => navigate('/') },
    { key: 'm', meta: true, shift: true, label: '\u2318\u21E7M', description: 'Go to Memory', action: () => navigate('/memory') },
    { key: 'd', meta: true, shift: true, label: '\u2318\u21E7D', description: 'Go to Decisions', action: () => navigate('/decisions') },
    { key: 'p', meta: true, shift: true, label: '\u2318\u21E7P', description: 'Go to People', action: () => navigate('/people') },
    { key: '/', meta: true, label: '\u2318/', description: 'Keyboard shortcuts', action: () => shortcutsModalToggle?.() ?? openModal('shortcuts') },
  ];

  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        // Allow Escape and Cmd+K even in inputs
        if (e.key !== 'Escape' && !(e.key === 'k' && (e.metaKey || e.ctrlKey))) return;
      }

      for (const s of shortcuts) {
        const metaMatch = s.meta ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey);
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;

        if (e.key.toLowerCase() === s.key.toLowerCase() && metaMatch && shiftMatch) {
          e.preventDefault();
          s.action();
          return;
        }
      }

      // Global Escape
      if (e.key === 'Escape') {
        const { activeModal, closeModal } = useUIStore.getState();
        if (activeModal) {
          closeModal();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, togglePalette, openModal],
  );

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);

  return shortcuts;
}
