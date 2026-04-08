import { useEffect, useState } from 'react';
import { getCalendarStatus, getCalendarAuthUrl, disconnectCalendar } from '../../lib/api';
import type { CalendarSyncStatus } from '@boardroom/shared';

export function CalendarSettings() {
  const [status, setStatus] = useState<CalendarSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const s = await getCalendarStatus();
        setStatus(s);
      } catch {
        // Silently fail — calendar integration is optional
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleConnect() {
    try {
      const { url } = await getCalendarAuthUrl();
      if (url) {
        window.location.href = url;
      }
    } catch {
      // Could not get auth URL
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectCalendar();
      setStatus({ connected: false, lastSyncAt: null, calendarId: null, error: null });
    } catch {
      // Failed to disconnect
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <section className="bg-bg-surface rounded-lg border border-line-subtle p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Google Calendar</h2>
        <div className="text-sm text-text-tertiary">Loading...</div>
      </section>
    );
  }

  // Not configured on the server
  if (status?.error === 'Google Calendar not configured') {
    return (
      <section className="bg-bg-surface rounded-lg border border-line-subtle p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Google Calendar</h2>
        <p className="text-sm text-text-tertiary">
          Google Calendar integration is not available. Contact your administrator to configure Google OAuth credentials.
        </p>
      </section>
    );
  }

  // Connected
  if (status?.connected) {
    return (
      <section className="bg-bg-surface rounded-lg border border-line-subtle p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Google Calendar</h2>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-success font-medium">Connected</span>
          </div>
          {status.calendarId && (
            <div>
              <span className="text-xs text-text-tertiary">Calendar: </span>
              <span className="text-xs text-text-secondary">{status.calendarId}</span>
            </div>
          )}
          {status.lastSyncAt && (
            <div>
              <span className="text-xs text-text-tertiary">Last sync: </span>
              <span className="text-xs text-text-secondary">
                {new Date(status.lastSyncAt).toLocaleString()}
              </span>
            </div>
          )}
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 text-danger text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </div>
      </section>
    );
  }

  // Not connected
  return (
    <section className="bg-bg-surface rounded-lg border border-line-subtle p-6">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Google Calendar</h2>
      <p className="text-sm text-text-tertiary mb-4">
        Connect your Google Calendar to see upcoming events alongside your tasks and commitments.
      </p>
      <button
        onClick={handleConnect}
        className="px-4 py-2 bg-accent hover:bg-accent text-text-primary text-sm rounded-lg transition-colors"
      >
        Connect Google Calendar
      </button>
    </section>
  );
}
