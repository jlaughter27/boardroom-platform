import { Button } from '../ui';

interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onDismiss, onRetry }: ErrorBannerProps) {
  return (
    <div className="bg-danger-muted border border-danger/30 rounded-lg p-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="text-danger mt-0.5">{'\u2717'}</span>
        <p className="text-sm text-foreground">{message}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onRetry && (
          <Button variant="danger" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss error">
            {'\u2715'}
          </Button>
        )}
      </div>
    </div>
  );
}
