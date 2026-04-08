import { motion } from 'motion/react';
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
import { staggerContainer, staggerItem } from '../lib/motion';
import { useNavigate } from 'react-router-dom';

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

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  // Subtitle from cognitive load or fallback
  const subtitle = warnings.length > 0
    ? warnings[0].message
    : 'All systems nominal';

  if (isLoading) {
    return (
      <PageWrapper>
        <div className="p-6 max-w-5xl mx-auto">
          <DashboardSkeleton />
        </div>
      </PageWrapper>
    );
  }

  const hasWidgetData = visibleWidgets.length > 0;

  return (
    <PageWrapper>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">
              {getGreeting()}, {firstName}
            </h1>
            <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>
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
                    <span className="text-3xl mb-3 block">{item.icon}</span>
                    <h3 className="text-sm font-medium text-text-primary mb-1">{item.title}</h3>
                    <p className="text-xs text-text-tertiary">{item.desc}</p>
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
      </div>
    </PageWrapper>
  );
}
