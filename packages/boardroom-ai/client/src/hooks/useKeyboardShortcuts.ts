import { useEffect, useCallback, useRef } from 'react';
import { useTransitionNavigate } from './useRouteTransition';
import { useCommandPaletteStore } from '../stores/commandPalette.store';
import { useGraphStore } from '../stores/graph.store';
import { useUIStore } from '../stores/ui.store';

export interface ShortcutDef {
  key: string;
  meta?: boolean;
  shift?: boolean;
  /**
   * Two-key chord: press `chord` (no modifiers), then `key` within
   * CHORD_TIMEOUT_MS. Used for shortcuts that browsers reserve (⌘⇧K is the
   * Firefox Web Console and cannot be prevented from page script).
   */
  chord?: string;
  label: string;
  description: string;
  action: () => void;
}

export const CHORD_TIMEOUT_MS = 1000;

let shortcutsModalToggle: (() => void) | null = null;

export function setShortcutsModalToggle(fn: () => void) {
  shortcutsModalToggle = fn;
}

export function useKeyboardShortcuts() {
  const navigate = useTransitionNavigate();
  const { toggle: togglePalette } = useCommandPaletteStore();
  const { openModal } = useUIStore();
  const pendingChord = useRef<{ key: string; at: number } | null>(null);

  /** ⌘⇧K (or the `g m` chord) — open the palette straight into "Search memory" (hybrid search + graph spotlight). */
  const openMemorySearch = () => {
    useGraphStore.getState().setPaletteMode('memory');
    const palette = useCommandPaletteStore.getState();
    if (!palette.open) palette.toggle();
  };

  const shortcuts: ShortcutDef[] = [
    { key: 'k', meta: true, label: '⌘K', description: 'Command palette', action: togglePalette },
    { key: 'k', meta: true, shift: true, label: '⌘⇧K', description: 'Search memory', action: openMemorySearch },
    { key: 'm', chord: 'g', label: 'G then M', description: 'Search memory (works in Firefox, where ⌘⇧K is taken)', action: openMemorySearch },
    { key: 'n', meta: true, label: '⌘N', description: 'New Decision Session', action: () => navigate('/decisions/new') },
    { key: 'g', meta: true, shift: true, label: '⌘⇧G', description: 'Go to Dashboard', action: () => navigate('/') },
    { key: 'm', meta: true, shift: true, label: '⌘⇧M', description: 'Go to Memory', action: () => navigate('/memory') },
    { key: 'd', meta: true, shift: true, label: '⌘⇧D', description: 'Go to Decisions', action: () => navigate('/decisions') },
    { key: 'p', meta: true, shift: true, label: '⌘⇧P', description: 'Go to People', action: () => navigate('/people') },
    { key: '/', meta: true, label: '⌘/', description: 'Keyboard shortcuts', action: () => shortcutsModalToggle?.() ?? openModal('shortcuts') },
  ];

  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable;
      if (typing) {
        pendingChord.current = null;
        // Allow Escape and Cmd+K even in inputs
        if (e.key !== 'Escape' && !(e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) return;
      }

      const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      const key = e.key.toLowerCase();

      // Second key of a pending chord
      const pending = pendingChord.current;
      if (pending && plain) {
        pendingChord.current = null;
        if (Date.now() - pending.at <= CHORD_TIMEOUT_MS) {
          const chord = shortcuts.find((s) => s.chord === pending.key && s.key === key);
          if (chord) { e.preventDefault(); chord.action(); return; }
        }
      }

      for (const s of shortcuts) {
        if (s.chord) continue;
        const metaMatch = s.meta ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey);
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey;

        if (key === s.key.toLowerCase() && metaMatch && shiftMatch) {
          e.preventDefault();
          s.action();
          return;
        }
      }

      // First key of a chord (never prevented — a lone `g` must keep working elsewhere)
      if (plain && shortcuts.some((s) => s.chord === key)) {
        pendingChord.current = { key, at: Date.now() };
        return;
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
