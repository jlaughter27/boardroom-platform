import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'motion/react';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { create } from 'zustand';
import { DURATION, EASE_OUT, springs, useReducedMotion } from '../../lib/motion';
import { cn } from '../../lib/cn';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Auto-dismiss after this many ms (paused while hovered or focused). */
  duration: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant, duration?: number) => void;
  removeToast: (id: string) => void;
}

const DEFAULT_DURATION = 4000;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, variant = 'info', duration = DEFAULT_DURATION) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant, duration }] }));
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

const VARIANT_ICON = {
  success: CircleCheck,
  error: CircleX,
  warning: TriangleAlert,
  info: Info,
} as const;

const VARIANT_COLOR: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
};

/** Swipe past this many px, or faster than this px/s, dismisses. */
const SWIPE_DISTANCE = 80;
const SWIPE_VELOCITY = 500;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const Icon = VARIANT_ICON[toast.variant];

  // Timer that pauses while the toast is hovered, focused or being dragged.
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pause = useCallback(() => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
  }, []);
  const resume = useCallback(() => {
    if (timer.current !== undefined) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(onDismiss, remaining.current);
  }, [onDismiss]);
  useEffect(() => {
    resume();
    return () => { if (timer.current !== undefined) clearTimeout(timer.current); };
  }, [resume]);

  return (
    <motion.div
      layout
      role="status"
      initial={reduced ? false : { opacity: 0, x: 48 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
      transition={{ ...springs.snappy, layout: springs.snappy }}
      style={{ x }}
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.08, right: 0.7 }}
      dragTransition={{ bounceStiffness: springs.gesture.stiffness, bounceDamping: springs.gesture.damping }}
      onDragStart={pause}
      onDragEnd={(_, info) => {
        if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) {
          // Carry the gesture's velocity into the fling, then remove.
          void animate(x, 400, { ...springs.gesture, velocity: info.velocity.x }).then(onDismiss);
        } else {
          resume();
        }
      }}
      onPointerEnter={pause}
      onPointerLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className={cn(
        'material rounded-xl flex items-center gap-3 py-2.5 pl-3.5 pr-2 text-sm text-foreground',
        'touch-pan-y select-none'
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" className={cn('shrink-0', VARIANT_COLOR[toast.variant])} />
      <span className="flex-1 min-w-0">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className={cn(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground',
          'transition-[background-color,color,transform] duration-fast ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </motion.div>
  );
}

/** The toast column is `w-80`; keep this many px clear of an open dialog's edge. */
const TOAST_WIDTH = 320;
const GAP = 16;

export type ToastPlacement =
  | { kind: 'corner' }
  | { kind: 'beside'; right: number }
  | { kind: 'top' };

/**
 * Where the toast stack goes so it never covers an open dialog or sheet — in
 * particular its footer, where the primary action lives (a toast fired by that
 * action, e.g. "Copied, but not recorded", used to sit right on top of Retry,
 * and hovering it paused the timer, so it stayed there).
 *
 * - No modal open: the bottom-right corner.
 * - A modal that leaves room on its left (the 1440 px side sheet, a centred
 *   dialog): bottom, just left of the modal.
 * - A modal that spans the width (a phone bottom sheet): top-centre.
 */
export function toastPlacement(doc: Document = document, viewportWidth = window.innerWidth): ToastPlacement {
  const dialogs = [...doc.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')];
  if (dialogs.length === 0) return { kind: 'corner' };
  const left = Math.min(...dialogs.map((d) => d.getBoundingClientRect().left));
  if (left >= TOAST_WIDTH + GAP * 2) return { kind: 'beside', right: Math.round(viewportWidth - left + GAP) };
  return { kind: 'top' };
}

function samePlacement(a: ToastPlacement, b: ToastPlacement): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'beside' || b.kind !== 'beside' || a.right === b.right;
}

/** Re-place while toasts are visible: on DOM changes (a dialog opening or closing in its portal) and on resize. */
function useToastPlacement(active: boolean): ToastPlacement {
  const [placement, setPlacement] = useState<ToastPlacement>({ kind: 'corner' });
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let pending = false;
    const update = () => {
      const next = toastPlacement();
      setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      frame = requestAnimationFrame(() => { pending = false; update(); });
    };
    update();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    return () => {
      mo.disconnect();
      window.removeEventListener('resize', schedule);
      if (pending) cancelAnimationFrame(frame);
    };
  }, [active]);
  return placement;
}

const PLACEMENT_CLASS: Record<ToastPlacement['kind'], string> = {
  corner: 'bottom-4 right-4',
  beside: 'bottom-4',
  top: 'top-4 left-1/2 -translate-x-1/2',
};

export function Toaster() {
  const { toasts, removeToast } = useToastStore();
  const placement = useToastPlacement(toasts.length > 0);
  const style: CSSProperties | undefined = placement.kind === 'beside' ? { right: placement.right } : undefined;

  return (
    <div
      className={cn(
        'pointer-events-none fixed z-toast flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 [&>*]:pointer-events-auto',
        PLACEMENT_CLASS[placement.kind]
      )}
      style={style}
      aria-live="polite"
      data-testid="toaster"
      data-placement={placement.kind}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => removeToast(toast.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
