import { useEffect, useState } from 'react';
import { usePageTitle } from '../hooks/usePageTitle';
import { IntegrationCard } from '../components/integrations/IntegrationCard';
import { EmailScanner } from '../components/integrations/EmailScanner';
import { PageWrapper, Card, Skeleton } from '../components/ui';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import * as api from '../lib/api';

interface IntegrationStatus {
  type: string;
  status: string;
  lastSyncAt: string | null;
  error: string | null;
}

export default function IntegrationsPage() {
  usePageTitle('Integrations');
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

  useEffect(() => { loadIntegrations(); }, []);

  const gmail = integrations.find((i) => i.type === 'gmail');
  const calendar = integrations.find((i) => i.type === 'google_calendar');

  async function connectGmail() {
    setActionLoading('gmail');
    try {
      const { url } = await api.getGmailAuthUrl();
      if (url) window.location.href = url;
      else setError('Gmail integration is not configured on the server.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get auth URL');
    } finally { setActionLoading(null); }
  }

  async function disconnectGmailHandler() {
    setActionLoading('gmail');
    try { await api.disconnectGmail(); await loadIntegrations(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to disconnect'); }
    finally { setActionLoading(null); }
  }

  async function connectCalendar() {
    setActionLoading('calendar');
    try {
      const { url } = await api.getCalendarAuthUrl();
      if (url) window.location.href = url;
      else setError('Google Calendar integration is not configured on the server.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get auth URL');
    } finally { setActionLoading(null); }
  }

  async function disconnectCalendarHandler() {
    setActionLoading('calendar');
    try { await api.disconnectCalendar(); await loadIntegrations(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to disconnect'); }
    finally { setActionLoading(null); }
  }

  if (loading) {
    return (
      <PageWrapper>
        <div className="max-w-3xl mx-auto py-8 px-4 space-y-4">
          <Skeleton className="h-8 w-40" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Integrations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Connect your tools to enrich your decision context
          </p>
        </div>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <IntegrationCard
            name="Gmail"
            description="Extract decisions, commitments, and facts from emails"
            icon={'\u2709\uFE0F'}
            status={(gmail?.status as 'connected' | 'disconnected' | 'error') ?? 'disconnected'}
            lastSyncAt={gmail?.lastSyncAt}
            onConnect={connectGmail}
            onDisconnect={disconnectGmailHandler}
            loading={actionLoading === 'gmail'}
          />
          <IntegrationCard
            name="Google Calendar"
            description="Sync calendar events for context-aware decisions"
            icon={'\uD83D\uDCC5'}
            status={(calendar?.status as 'connected' | 'disconnected' | 'error') ?? 'disconnected'}
            lastSyncAt={calendar?.lastSyncAt}
            onConnect={connectCalendar}
            onDisconnect={disconnectCalendarHandler}
            loading={actionLoading === 'calendar'}
          />
          <IntegrationCard
            name="Slack"
            description="Import key conversations and decisions from Slack"
            icon={'\uD83D\uDCAC'}
            status="coming_soon"
          />
          <IntegrationCard
            name="Notion"
            description="Sync pages and databases from your Notion workspace"
            icon={'\uD83D\uDCD3'}
            status="coming_soon"
          />
        </div>

        {gmail?.status === 'connected' && (
          <Card className="p-6">
            <EmailScanner />
          </Card>
        )}
      </div>
    </PageWrapper>
  );
}
