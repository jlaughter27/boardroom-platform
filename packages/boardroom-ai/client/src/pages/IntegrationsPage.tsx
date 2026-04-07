import { useEffect, useState } from 'react';
import { IntegrationCard } from '../components/integrations/IntegrationCard';
import { EmailScanner } from '../components/integrations/EmailScanner';
import * as api from '../lib/api';

interface IntegrationStatus {
  type: string;
  status: string;
  lastSyncAt: string | null;
  error: string | null;
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadIntegrations() {
    try {
      const data = await api.getIntegrations();
      setIntegrations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIntegrations();
  }, []);

  const gmail = integrations.find(i => i.type === 'gmail');
  const calendar = integrations.find(i => i.type === 'google_calendar');

  async function connectGmail() {
    setActionLoading('gmail');
    try {
      const { url } = await api.getGmailAuthUrl();
      if (url) {
        window.location.href = url;
      } else {
        setError('Gmail integration is not configured on the server.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get auth URL');
    } finally {
      setActionLoading(null);
    }
  }

  async function disconnectGmailHandler() {
    setActionLoading('gmail');
    try {
      await api.disconnectGmail();
      await loadIntegrations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setActionLoading(null);
    }
  }

  async function connectCalendar() {
    setActionLoading('calendar');
    try {
      const { url } = await api.getCalendarAuthUrl();
      if (url) {
        window.location.href = url;
      } else {
        setError('Google Calendar integration is not configured on the server.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get auth URL');
    } finally {
      setActionLoading(null);
    }
  }

  async function disconnectCalendarHandler() {
    setActionLoading('calendar');
    try {
      await api.disconnectCalendar();
      await loadIntegrations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-gray-400">Loading...</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Integrations</h1>
        <p className="text-sm text-gray-500 mt-1">
          Connect external services to import data into your cognitive memory.
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 flex items-center justify-between">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-red-500 hover:text-red-300">
            Dismiss
          </button>
        </div>
      )}

      {/* Integration cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <IntegrationCard
          name="Gmail"
          description="Extract decisions, commitments, and facts from emails"
          icon={"\u{2709}\u{FE0F}"}
          status={(gmail?.status as 'connected' | 'disconnected' | 'error') ?? 'disconnected'}
          lastSyncAt={gmail?.lastSyncAt}
          onConnect={connectGmail}
          onDisconnect={disconnectGmailHandler}
          loading={actionLoading === 'gmail'}
        />
        <IntegrationCard
          name="Google Calendar"
          description="Sync calendar events for context-aware decisions"
          icon={"\u{1F4C5}"}
          status={(calendar?.status as 'connected' | 'disconnected' | 'error') ?? 'disconnected'}
          lastSyncAt={calendar?.lastSyncAt}
          onConnect={connectCalendar}
          onDisconnect={disconnectCalendarHandler}
          loading={actionLoading === 'calendar'}
        />
        <IntegrationCard
          name="Slack"
          description="Import key conversations and decisions from Slack"
          icon={"\u{1F4AC}"}
          status="coming_soon"
        />
        <IntegrationCard
          name="Notion"
          description="Sync pages and databases from your Notion workspace"
          icon={"\u{1F4D3}"}
          status="coming_soon"
        />
      </div>

      {/* Email scanner section — only shown when Gmail is connected */}
      {gmail?.status === 'connected' && (
        <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
          <EmailScanner />
        </section>
      )}
    </div>
  );
}
