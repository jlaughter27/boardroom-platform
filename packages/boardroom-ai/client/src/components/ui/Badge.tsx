import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-bg-hover text-text-secondary',
        success: 'bg-success-muted text-success',
        warning: 'bg-warning-muted text-warning',
        danger: 'bg-danger-muted text-danger',
        info: 'bg-info-muted text-info',
        accent: 'bg-accent-muted text-accent',
      },
      solid: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      { variant: 'success', solid: true, className: 'bg-success text-bg-base' },
      { variant: 'warning', solid: true, className: 'bg-warning text-bg-base' },
      { variant: 'danger', solid: true, className: 'bg-danger text-white' },
      { variant: 'info', solid: true, className: 'bg-info text-bg-base' },
      { variant: 'accent', solid: true, className: 'bg-accent text-white' },
    ],
    defaultVariants: { variant: 'default', solid: false },
  }
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: React.ReactNode;
  className?: string;
}

export function Badge({ children, variant, solid, className }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, solid, className }))}>
      {children}
    </span>
  );
}
