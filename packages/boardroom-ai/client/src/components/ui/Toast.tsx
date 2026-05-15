import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { create } from 'zustand';
import { Check, X, AlertTriangle, Info, X as Close } from 'lucide-react';
import { cn } from '../../lib/cn';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

const AUTO_DISMISS_MS = 4000;

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, variant?: ToastVariant) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, variant = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    // Auto-dismiss handled in ToastItem so we can pause on hover.
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-success/30 bg-success-muted',
  error: 'border-danger/30 bg-danger-muted',
  warning: 'border-warning/30 bg-warning-muted',
  info: 'border-info/30 bg-info-muted',
};

const variantTextColors: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
};

const variantIcons: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: Check,
  error: X,
  warning: AlertTriangle,
  info: Info,
};

/**
 * ToastItem — auto-dismisses after AUTO_DISMISS_MS but pauses while the user
 * is hovering (or keyboard-focused on) the toast. Resumes from the remaining
 * time on leave/blur. Sets correct ARIA role/live-region per variant.
 *
 * Audit refs: P0 #15 (pause-on-hover), top-10 #1 (lucide icons replacing
 * unicode `✓ ✗ ⚠ ℹ`).
 */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const startRef = useRef<number>(Date.now());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (paused) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        remainingRef.current -= Date.now() - startRef.current;
      }
      return;
    }
    startRef.current = Date.now();
    timeoutRef.current = setTimeout(onDismiss, Math.max(0, remainingRef.current));
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [paused, onDismiss]);

  const Icon = variantIcons[toast.variant];
  const isError = toast.variant === 'error';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 50, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 50, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'flex items-center gap-3 rounded-md border px-4 py-3 shadow-lg backdrop-blur-sm',
        'text-sm text-foreground',
        variantStyles[toast.variant]
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', variantTextColors[toast.variant])} aria-hidden />
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-sm',
          'text-muted-foreground hover:text-foreground transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        )}
      >
        <Close className="h-3.5 w-3.5" aria-hidden />
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div
      className="fixed top-4 right-4 z-[var(--z-toast)] flex flex-col gap-2 w-80 pointer-events-none"
      aria-label="Notifications"
    >
      <div className="pointer-events-auto flex flex-col gap-2">
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
    </div>
  );
}
