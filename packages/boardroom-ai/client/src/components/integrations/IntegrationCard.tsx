import { Card, Badge, Button } from '../ui';

interface IntegrationCardProps {
  name: string;
  description: string;
  icon: string;
  status: 'connected' | 'disconnected' | 'error' | 'coming_soon';
  lastSyncAt?: string | null;
  onConnect?: () => void;
  onDisconnect?: () => void;
  loading?: boolean;
}

const STATUS_VARIANT: Record<string, 'success' | 'default' | 'danger'> = {
  connected: 'success',
  disconnected: 'default',
  error: 'danger',
  coming_soon: 'default',
};

const STATUS_LABELS = {
  connected: 'Connected',
  disconnected: 'Not Connected',
  error: 'Error',
  coming_soon: 'Coming Soon',
} as const;

export function IntegrationCard({
  name,
  description,
  icon,
  status,
  lastSyncAt,
  onConnect,
  onDisconnect,
  loading,
}: IntegrationCardProps) {
  const isComingSoon = status === 'coming_soon';

  return (
    <Card className={`p-5 ${isComingSoon ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="text-foreground font-semibold text-sm">{name}</h3>
            <p className="text-muted-foreground text-xs mt-0.5">{description}</p>
          </div>
        </div>
        <Badge variant={STATUS_VARIANT[status] ?? 'default'}>
          {STATUS_LABELS[status]}
        </Badge>
      </div>

      {lastSyncAt && status === 'connected' && (
        <p className="text-xs text-muted-foreground mt-3">
          Last synced: {new Date(lastSyncAt).toLocaleString()}
        </p>
      )}

      <div className="mt-4">
        {status === 'connected' && onDisconnect && (
          <Button variant="danger" size="sm" onClick={onDisconnect} disabled={loading}>
            {loading ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        )}
        {status === 'disconnected' && onConnect && (
          <Button variant="primary" size="sm" onClick={onConnect} disabled={loading}>
            {loading ? 'Connecting...' : 'Connect'}
          </Button>
        )}
        {status === 'error' && onConnect && (
          <Button variant="danger" size="sm" onClick={onConnect} disabled={loading}>
            {loading ? 'Reconnecting...' : 'Reconnect'}
          </Button>
        )}
        {isComingSoon && (
          <span className="text-xs text-muted-foreground">Available in a future update</span>
        )}
      </div>
    </Card>
  );
}
