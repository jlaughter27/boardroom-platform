import { usePageTitle } from '../hooks/usePageTitle';
import { WidgetRenderer } from '../components/dashboard/WidgetRenderer';
import { DashboardConfigurator } from '../components/dashboard/DashboardConfigurator';
import { useWidgetLayout } from '../hooks/useWidgetLayout';
import { useUIStore } from '../stores/ui.store';
import { useEntitiesStore } from '../stores/entities.store';
import { useCortexStore } from '../stores/cortex.store';
import { useAuthStore } from '../stores/auth.store';
import { useCognitiveLoad } from '../hooks/useCognitiveLoad';
import { PageWrapper, PageHeader, Skeleton, Button, Card, EmptyState } from '../components/ui';
import { SlidersHorizontal } from 'lucide-react';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { useNavigate } from 'react-router-dom';
import { AINudge } from '../components/shared/AINudge';
import { LlmCostWidget } from '../components/dashboard/LlmCostWidget';
import { CockpitRow } from '../components/dashboard/CockpitRow';
import { MemoryPulseWidget } from '../components/dashboard/MemoryPulseWidget';
import { WhatsMovingWidget } from '../components/dashboard/WhatsMovingWidget';
import { ErrorBoundary } from '../components/shared/ErrorBoundary';
import { MeetingBriefsCard } from '../components/dashboard/MeetingBriefsCard';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-48 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { visibleWidgets, widgets, isLoading, updateLayout, resetToDefault } =
    useWidgetLayout();
  const { configuratorOpen, openConfigurator, closeConfigurator } = useUIStore();
  usePageTitle('Dashboard');
  const { error: entitiesError, clearError: clearEntitiesError } = useEntitiesStore();
  const { error: cortexError, clearError: clearCortexError } = useCortexStore();
  const user = useAuthStore((s) => s.user);
  const warnings = useCognitiveLoad();
  const navigate = useNavigate();

  const decisions = useEntitiesStore((s) => s.decisions);
  const latestMemo = useCortexStore((s) => s.latestMemo);
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  // Nudge: no decisions in 7+ days
  const lastDecisionDate = decisions.length > 0
    ? Math.max(...decisions.map((d) => new Date(d.createdAt).getTime()))
    : 0;
  const daysSinceLastDecision = lastDecisionDate
    ? Math.floor((Date.now() - lastDecisionDate) / (1000 * 60 * 60 * 24))
    : Infinity;
  const showDecisionNudge = daysSinceLastDecision >= 7;

  // Nudge: weekly memo available today
  const memoIsToday = latestMemo
    ? (() => {
        const d = new Date(latestMemo.generatedAt);
        const now = new Date();
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
      })()
    : false;

  // Subtitle from cognitive load or fallback
  const subtitle = warnings.length > 0
    ? warnings[0].message
    : 'All systems nominal';

  const hasWidgetData = visibleWidgets.length > 0;

  return (
    <PageWrapper>
      {/* No entrance animation on dashboard load (Apple-grade UI standards): the
          skeleton swaps for content in place; only changed values animate. */}
      {isLoading ? (
        <div className="p-6 max-w-6xl mx-auto">
          <DashboardSkeleton />
        </div>
      ) : (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header — the warm-gold accent bar anchors the greeting with brand colour
            without adding another logo (Sidebar already carries one). On phones the
            Customize control drops to its own row so the greeting keeps the full width. */}
        <PageHeader
          accent
          className="mb-0"
          title={<>{getGreeting()}, {firstName}</>}
          subtitle={subtitle}
          actions={
            <Button variant="ghost" size="sm" onClick={openConfigurator}>
              <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
              Customize
            </Button>
          }
        />

        {/* Errors */}
        {(entitiesError || cortexError) && (
          <ErrorBanner
            message={entitiesError || cortexError || ''}
            onDismiss={() => { clearEntitiesError(); clearCortexError(); }}
          />
        )}

        {/* AI Nudges */}
        {showDecisionNudge && (
          <AINudge
            title="You haven't run a decision analysis in 7+ days"
            description="Regular decision analysis helps build your cognitive profile and improves AI recommendations."
            action={{ label: 'Start a Decision', onClick: () => navigate('/decisions') }}
            dismissKey="nudge-no-recent-decision"
            variant="suggestion"
          />
        )}
        {memoIsToday && (
          <AINudge
            title="Your weekly memo is available"
            description={`Thinking quality score: ${latestMemo?.thinkingQualityScore}/10. Review your patterns and insights.`}
            action={{ label: 'Read Memo', onClick: () => document.getElementById('weekly-memo')?.scrollIntoView({ behavior: 'smooth' }) }}
            dismissKey="nudge-weekly-memo"
            variant="info"
          />
        )}

        {/* RD-13 — meeting prep for the next 24 h (renders nothing when the calendar is not configured). */}
        <ErrorBoundary fallback={null}><MeetingBriefsCard /></ErrorBoundary>

        {/* Cockpit — the numbers first (viz lane). Each piece fails closed on its own. */}
        <ErrorBoundary fallback={null}>
          <CockpitRow isAdmin={Boolean(user?.isAdmin)} />
        </ErrorBoundary>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5" data-testid="pulse-row">
          <div className="lg:col-span-2 min-w-0">
            <ErrorBoundary fallback={null}><MemoryPulseWidget /></ErrorBoundary>
          </div>
          <div className="lg:col-span-3 min-w-0">
            <ErrorBoundary fallback={null}><WhatsMovingWidget /></ErrorBoundary>
          </div>
        </div>

        {/* Widget grid or empty state */}
        {hasWidgetData ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visibleWidgets.map((widget) => (
              <div key={widget.id}>
                <WidgetRenderer config={widget} />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <EmptyState
              variant="no-data"
              title="Your dashboard will come alive"
              description="Start making decisions and tracking goals to populate your dashboard with insights."
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { title: 'Create a Goal', desc: 'Set your first objective to track', icon: '\uD83C\uDFAF', route: '/' },
                { title: 'Start a Decision', desc: 'Analyze your first decision with AI', icon: '\u2696\uFE0F', route: '/decisions' },
                { title: 'Add Team Members', desc: 'Build your stakeholder network', icon: '\uD83D\uDC65', route: '/people' },
              ].map((item) => (
                <div key={item.title}>
                  <Card hover onClick={() => navigate(item.route)} className="text-center py-6">
                    {/* Warm-gold halo around the icon — turns placeholder emoji
                        into a branded "quick action" chip. */}
                    <span
                      className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl ring-1 ring-inset ring-primary/20"
                      aria-hidden
                    >
                      {item.icon}
                    </span>
                    <h3 className="text-sm font-medium text-foreground mb-1">{item.title}</h3>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LLM cost — admin only (Phase 6) */}
        {user?.isAdmin && (
          <ErrorBoundary fallback={null}>
            <LlmCostWidget />
          </ErrorBoundary>
        )}

        {configuratorOpen && (
          <DashboardConfigurator
            widgets={widgets}
            onSave={updateLayout}
            onReset={resetToDefault}
            onClose={closeConfigurator}
          />
        )}
      </div>
      )}
    </PageWrapper>
  );
}
