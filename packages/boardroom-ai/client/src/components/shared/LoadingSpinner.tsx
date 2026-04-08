interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
} as const;

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  return (
    <div
      className={`animate-spin rounded-full border-2 border-border border-t-primary ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
