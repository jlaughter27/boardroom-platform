import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        secondary: 'bg-card text-foreground border border-border hover:bg-muted',
        ghost: 'text-muted-foreground hover:text-foreground hover:bg-muted',
        danger: 'bg-destructive text-white hover:bg-red-400',
        success: 'bg-success text-background hover:bg-emerald-300',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-xl gap-1.5',
        md: 'h-9 px-4 text-sm rounded-xl gap-2',
        lg: 'h-11 px-6 text-base rounded-xl gap-2.5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
export { buttonVariants };
