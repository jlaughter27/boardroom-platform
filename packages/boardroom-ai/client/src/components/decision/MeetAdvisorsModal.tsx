import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '../ui';
import { PERSONA_META, PERSONA_DISPLAY_ORDER } from '../../lib/persona-metadata';
import { useReducedMotion } from '../../lib/motion';

const STORAGE_KEY = 'boardroom:seenAdvisorsTour';

/**
 * Check whether the current user has already dismissed the tour.
 * localStorage is the launch-day stand-in for an OmniMind UserProfile flag.
 * See: docs/_audits/2026-05-15-launch-prep/track-d-followups.md
 *
 * @internal exported for tests
 */
export function hasSeenAdvisorsTour(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // localStorage can throw in private mode / blocked storage — treat as
    // "seen" so we don't loop showing the modal.
    return true;
  }
}

/** @internal exported for tests */
export function markAdvisorsTourSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    /* swallow */
  }
}

/** @internal exported for tests */
export function resetAdvisorsTour(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* swallow */
  }
}

interface MeetAdvisorsModalProps {
  open: boolean;
  onClose: (dontShowAgain: boolean) => void;
}

export function MeetAdvisorsModal({ open, onClose }: MeetAdvisorsModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();

  // Focus trap + ESC to close
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus the primary action on open
    closeButtonRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(dontShowAgain);
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKey);
    // Lock body scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, dontShowAgain]);

  if (typeof document === 'undefined') return null;

  const cardDelay = (i: number) => (reducedMotion ? 0 : i * 0.03);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
          onClick={() => onClose(dontShowAgain)}
          data-testid="meet-advisors-backdrop"
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="meet-advisors-title"
            aria-describedby="meet-advisors-desc"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="relative w-full max-w-3xl my-8 bg-card border border-border rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-2">
              <h2 id="meet-advisors-title" className="text-xl font-semibold text-foreground">
                Meet your advisors
              </h2>
              <p id="meet-advisors-desc" className="text-sm text-muted-foreground mt-1">
                Seven specialists weigh in on every decision. Each looks for something different —
                that is the whole point.
              </p>
            </div>

            {/* Persona grid */}
            <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {PERSONA_DISPLAY_ORDER.map((id, i) => {
                const meta = PERSONA_META[id];
                return (
                  <motion.div
                    key={id}
                    initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: cardDelay(i), ease: [0.4, 0, 0.2, 1] }}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: meta.color }}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-foreground">{meta.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">{meta.role}</p>
                    <p className="text-xs text-muted-foreground/80 italic mt-2 leading-snug">
                      &ldquo;{meta.sampleQuestion}&rdquo;
                    </p>
                  </motion.div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-border mt-2 pt-4">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dontShowAgain}
                  onChange={(e) => setDontShowAgain(e.target.checked)}
                  className="rounded border-border accent-primary"
                />
                Don&rsquo;t show this again
              </label>
              <Button
                ref={closeButtonRef}
                variant="primary"
                onClick={() => onClose(dontShowAgain)}
              >
                Got it — let&rsquo;s go
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
