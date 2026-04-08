import { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { create } from 'zustand';
import { cn } from '../../lib/cn';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

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
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
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

const variantIcons: Record<ToastVariant, string> = {
  success: '\u2713',
  error: '\u2717',
  warning: '\u26A0',
  info: '\u2139',
};

const variantTextColors: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 50, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 50, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm',
        'text-sm text-text-primary',
        variantStyles[toast.variant]
      )}
    >
      <span className={cn('text-base', variantTextColors[toast.variant])}>
        {variantIcons[toast.variant]}
      </span>
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="text-text-tertiary hover:text-text-primary transition-colors"
      >
        &times;
      </button>
    </motion.div>
  );
}

export function Toaster() {
  const { toasts, removeToast } = useToastStore();

  return (
    <div className="fixed top-4 right-4 z-[var(--z-toast)] flex flex-col gap-2 w-80">
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
