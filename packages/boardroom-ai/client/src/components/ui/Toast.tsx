import { useCallback, useEffect, useRef } from 'react';
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

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-toast flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 [&>*]:pointer-events-auto"
      aria-live="polite"
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
