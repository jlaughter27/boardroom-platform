import { useEffect, useState, useCallback } from 'react';
import { Modal } from './Modal';
import { setShortcutsModalToggle, type ShortcutDef } from '../../hooks/useKeyboardShortcuts';

interface ShortcutsModalProps {
  shortcuts: ShortcutDef[];
}

/** ⌘/ — the keyboard shortcut sheet. Rendered on the shared Modal (Base UI Dialog). */
export function ShortcutsModal({ shortcuts }: ShortcutsModalProps) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    setShortcutsModalToggle(toggle);
    return () => setShortcutsModalToggle(() => {});
  }, [toggle]);

  return (
    <Modal isOpen={open} onClose={() => setOpen(false)} title="Keyboard Shortcuts" size="sm">
      <div className="-mx-2 space-y-0.5">
        {shortcuts.map((s) => (
          <div
            key={s.label}
            className="flex items-center justify-between gap-4 rounded-md px-2 py-2 transition-colors duration-fast ease-out hover:bg-muted"
          >
            <span className="text-sm text-muted-foreground">{s.description}</span>
            <kbd className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {s.label}
            </kbd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 rounded-md px-2 py-2 transition-colors duration-fast ease-out hover:bg-muted">
          <span className="text-sm text-muted-foreground">Close modal / panel</span>
          <kbd className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            Esc
          </kbd>
        </div>
      </div>
    </Modal>
  );
}
