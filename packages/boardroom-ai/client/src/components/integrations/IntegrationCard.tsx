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

const STATUS_STYLES = {
  connected: 'bg-green-900/50 text-green-400 border-green-800',
  disconnected: 'bg-gray-800 text-gray-400 border-gray-700',
  error: 'bg-red-900/50 text-red-400 border-red-800',
  coming_soon: 'bg-gray-800 text-gray-500 border-gray-700',
} as const;

const STATUS_LABELS = {
  connected: 'Connected',
  disconnected: 'Not connected',
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
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="text-white font-medium text-sm">{name}</h3>
            <p className="text-gray-500 text-xs mt-0.5">{description}</p>
          </div>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>

      {lastSyncAt && status === 'connected' && (
        <p className="text-xs text-gray-600 mt-3">
          Last synced: {new Date(lastSyncAt).toLocaleString()}
        </p>
      )}

      <div className="mt-4">
        {status === 'connected' && onDisconnect && (
          <button
            onClick={onDisconnect}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Disconnecting...' : 'Disconnect'}
          </button>
        )}
        {status === 'disconnected' && onConnect && (
          <button
            onClick={onConnect}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        )}
        {status === 'error' && onConnect && (
          <button
            onClick={onConnect}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Reconnecting...' : 'Reconnect'}
          </button>
        )}
        {status === 'coming_soon' && (
          <span className="text-xs text-gray-600">Available in a future update</span>
        )}
      </div>
    </div>
  );
}
