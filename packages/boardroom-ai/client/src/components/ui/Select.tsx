import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/cn';

interface Option {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface SelectProps {
  options: Option[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Select({ options, value, onChange, placeholder = 'Select...', className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open && focusIndex >= 0) {
        onChange?.(options[focusIndex].value);
        setOpen(false);
      } else {
        setOpen(true);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setFocusIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex w-full items-center justify-between h-9 px-3 rounded-xl border border-border',
          'bg-card text-sm transition-all duration-fast',
          'focus:ring-2 focus:ring-ring focus:border-primary/40 outline-none',
          selected ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {selected?.icon}
          {selected?.label || placeholder}
        </span>
        <svg className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-[var(--z-dropdown)] mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden"
          >
            {options.map((option, i) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange?.(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                  'hover:bg-muted',
                  option.value === value && 'text-primary bg-primary/10',
                  i === focusIndex && 'bg-muted',
                  option.value !== value && 'text-foreground'
                )}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
