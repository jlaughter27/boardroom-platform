import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  [
    // The label and the loading spinner share one grid cell, so swapping them
    // never changes the button's width.
    'relative inline-grid grid-cols-1 place-items-center font-medium select-none whitespace-nowrap',
    // Only the properties that actually change — never every property at once.
    'transition-[background-color,color,border-color,box-shadow,transform] duration-fast ease-out',
    // Press feedback: the surface should feel like it is listening.
    'active:scale-[0.97]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    'disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md',
        // Hover on quiet buttons is a hairline darken + a shadow step, not a colour jump.
        secondary: 'bg-card text-foreground border border-border shadow-sm hover:border-hairline-strong hover:shadow-md',
        ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted',
        danger: 'bg-destructive text-white shadow-sm hover:bg-destructive/90 hover:shadow-md',
        success: 'bg-success text-background shadow-sm hover:bg-success/90 hover:shadow-md',
        // Material surface — for buttons that float over content (toolbars, headers).
        glass: 'material text-foreground hover:shadow-lg',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
      },
      shape: {
        default: '',
        capsule: 'rounded-capsule',
      },
    },
    compoundVariants: [
      { shape: 'default', size: 'sm', className: 'rounded-md' },
      { shape: 'default', size: 'md', className: 'rounded-control' },
      { shape: 'default', size: 'lg', className: 'rounded-control' },
    ],
    defaultVariants: { variant: 'primary', size: 'md', shape: 'default' },
  }
);

const LABEL_GAP = { sm: 'gap-1.5', md: 'gap-2', lg: 'gap-2.5' } as const;

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Replace the label with a spinner (keeps the width, sets `aria-busy`, disables the button). */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, shape, loading = false, disabled, children, ...props }, ref) => {
    const gap = LABEL_GAP[size ?? 'md'];
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, shape, className }))}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        {...props}
      >
        <span
          data-slot="label"
          aria-hidden={loading || undefined}
          className={cn(
            'col-start-1 row-start-1 inline-flex items-center justify-center transition-opacity duration-fast ease-out',
            gap,
            loading && 'opacity-0'
          )}
        >
          {children}
        </span>
        {loading && (
          <span className="col-start-1 row-start-1 inline-flex items-center justify-center" role="status" aria-label="Loading">
            <LoaderCircle className="animate-spin" size={size === 'lg' ? 18 : 16} strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
export { buttonVariants };
