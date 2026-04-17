import { motion, AnimatePresence } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { WidgetRenderer } from '../components/dashboard/WidgetRenderer';
import { DashboardConfigurator } from '../components/dashboard/DashboardConfigurator';
import { useWidgetLayout } from '../hooks/useWidgetLayout';
import { useUIStore } from '../stores/ui.store';
import { useEntitiesStore } from '../stores/entities.store';
import { useCortexStore } from '../stores/cortex.store';
import { useAuthStore } from '../stores/auth.store';
import { useCognitiveLoad } from '../hooks/useCognitiveLoad';
import { PageWrapper, Skeleton, Button, Card, EmptyState } from '../components/ui';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { fadeIn, staggerContainer, staggerItem } from '../lib/motion';
import { useNavigate } from 'react-router-dom';
import { AINudge } from '../components/shared/AINudge';

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
        const d = new Date(latestMemo.createdAt);
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
      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div key="skeleton" {...fadeIn} className="p-6 max-w-5xl mx-auto">
            <DashboardSkeleton />
          </motion.div>
        ) : (
      <motion.div key="content" {...fadeIn} className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Warm-gold accent bar — anchors the greeting with brand color
                without adding another logo (Sidebar already carries one). */}
            <span
              className="h-10 w-1 rounded-full bg-gradient-to-b from-primary to-primary-warm"
              aria-hidden
            />
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                {getGreeting()}, {firstName}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={openConfigurator}>
            <svg className="w-4 h-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5 4a1 1 0 00-2 0v7.268a2 2 0 000 3.464V16a1 1 0 102 0v-1.268a2 2 0 000-3.464V4zM11 4a1 1 0 10-2 0v1.268a2 2 0 000 3.464V16a1 1 0 102 0V8.732a2 2 0 000-3.464V4zM16 3a1 1 0 011 1v7.268a2 2 0 010 3.464V16a1 1 0 11-2 0v-1.268a2 2 0 010-3.464V4a1 1 0 011-1z" />
            </svg>
            Customize
          </Button>
        </div>

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

        {/* Widget grid or empty state */}
        {hasWidgetData ? (
          <motion.div
            {...staggerContainer}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4"
          >
            {visibleWidgets.map((widget) => (
              <motion.div key={widget.id} {...staggerItem}>
                <WidgetRenderer config={widget} />
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <div className="space-y-6">
            <EmptyState
              variant="no-data"
              title="Your dashboard will come alive"
              description="Start making decisions and tracking goals to populate your dashboard with insights."
            />
            <motion.div
              {...staggerContainer}
              className="grid grid-cols-1 md:grid-cols-3 gap-4"
            >
              {[
                { title: 'Create a Goal', desc: 'Set your first objective to track', icon: '\uD83C\uDFAF', route: '/' },
                { title: 'Start a Decision', desc: 'Analyze your first decision with AI', icon: '\u2696\uFE0F', route: '/decisions' },
                { title: 'Add Team Members', desc: 'Build your stakeholder network', icon: '\uD83D\uDC65', route: '/people' },
              ].map((item) => (
                <motion.div key={item.title} {...staggerItem}>
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
                </motion.div>
              ))}
            </motion.div>
          </div>
        )}

        {configuratorOpen && (
          <DashboardConfigurator
            widgets={widgets}
            onSave={updateLayout}
            onReset={resetToDefault}
            onClose={closeConfigurator}
          />
        )}
      </motion.div>
        )}
      </AnimatePresence>
    </PageWrapper>
  );
}
