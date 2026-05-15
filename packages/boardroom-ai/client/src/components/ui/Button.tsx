import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/**
 * Button — CVA-driven button primitive.
 *
 * Design-system rules (audit ID top-10 #3, P0 #12/#13):
 *  - Canonical height is `h-9` (36px) on md/sm/lg snaps to h-8/h-9/h-11.
 *  - Radius is `rounded-md` (8px) — pillow `rounded-xl` was retired per audit.
 *  - `danger`/`success` hovers DARKEN (red-700, emerald-700), do not lighten.
 *  - All variants have explicit default/hover/active/focus-visible/disabled
 *    states. `aria-busy` is honored when `loading` is set.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center font-medium select-none',
    'transition-colors duration-fast',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-busy:cursor-progress',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 shadow-sm',
        secondary:
          'bg-card text-foreground border border-border hover:bg-muted active:bg-accent',
        ghost:
          'text-muted-foreground hover:text-foreground hover:bg-muted active:bg-accent',
        danger:
          'bg-destructive text-white hover:bg-red-700 active:bg-red-800 dark:hover:bg-red-600 dark:active:bg-red-700',
        success:
          'bg-success text-white hover:bg-emerald-700 active:bg-emerald-800 dark:hover:bg-emerald-600 dark:active:bg-emerald-700',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-md gap-1.5',
        md: 'h-9 px-4 text-sm rounded-md gap-2',
        lg: 'h-11 px-6 text-base rounded-md gap-2.5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, children, loading, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export { buttonVariants };
