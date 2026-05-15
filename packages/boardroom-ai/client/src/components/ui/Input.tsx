import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

/**
 * Input — single-line text input primitive.
 *
 * Design-system rules:
 *  - Canonical height `h-9` (36px) matches Button + Select trigger.
 *  - Radius `rounded-md` (8px) — pairs with Button.
 *  - Focus uses ring only (no doubled-up border tint).
 *  - Numeric inputs auto-get tabular-nums per audit ID top-10 #7.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, type, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const isNumeric = type === 'number';
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-muted-foreground">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={cn(
            'bg-card border border-border rounded-md px-3 h-9 text-sm text-foreground',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background',
            'transition-colors duration-fast',
            isNumeric && 'tabular-nums',
            error && 'border-destructive focus:ring-destructive/40',
            className
          )}
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
