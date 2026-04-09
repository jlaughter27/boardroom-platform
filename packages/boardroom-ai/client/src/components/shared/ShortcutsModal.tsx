import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { scaleIn } from '../../lib/motion';
import { setShortcutsModalToggle, type ShortcutDef } from '../../hooks/useKeyboardShortcuts';

interface ShortcutsModalProps {
  shortcuts: ShortcutDef[];
}

export function ShortcutsModal({ shortcuts }: ShortcutsModalProps) {
  const [open, setOpen] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    setShortcutsModalToggle(toggle);
    return () => setShortcutsModalToggle(() => {});
  }, [toggle]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={backdropRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === backdropRef.current) setOpen(false);
          }}
        >
          <motion.div
            {...scaleIn}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            className="w-full max-w-md bg-card border border-border rounded-xl shadow-lg p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 id="shortcuts-title" className="text-lg font-semibold text-foreground">
                Keyboard Shortcuts
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="p-1 text-muted-foreground hover:text-muted-foreground transition-colors"
                aria-label="Close shortcuts"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-1">
              {shortcuts.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted transition-colors"
                >
                  <span className="text-sm text-muted-foreground">{s.description}</span>
                  <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 text-xs font-mono text-foreground">
                    {s.label}
                  </kbd>
                </div>
              ))}
              <div className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted transition-colors">
                <span className="text-sm text-muted-foreground">Close modal / panel</span>
                <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 text-xs font-mono text-foreground">
                  Esc
                </kbd>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
