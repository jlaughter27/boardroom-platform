import { Suspense } from 'react';
import type { WidgetConfig, WidgetType } from '@boardroom/shared';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { LoadingSpinner } from '../shared/LoadingSpinner';

// Import all dashboard components
import { GoalHierarchy } from './GoalHierarchy';
import { WeekCalendarStrip } from './WeekCalendarStrip';
import { ProactiveQuestions } from './ProactiveQuestions';
import { WeeklyMemoCard } from './WeeklyMemoCard';
import { CortexInsightsPanel } from './CortexInsightsPanel';
import { OutcomeReviewBanner } from './OutcomeReviewBanner';
import { CognitiveLoadBanner } from './CognitiveLoadBanner';
import { RecentDecisions } from './RecentDecisions';
import { QuickTakeWidget } from './QuickTakeWidget';

// Map widget types to components
const WIDGET_MAP: Record<WidgetType, React.ComponentType> = {
  goal_hierarchy: GoalHierarchy,
  calendar_strip: WeekCalendarStrip,
  proactive_questions: ProactiveQuestions,
  weekly_memo: WeeklyMemoCard,
  cortex_insights: CortexInsightsPanel,
  recent_decisions: RecentDecisions,
  outcome_reviews: OutcomeReviewBanner,
  cognitive_load: CognitiveLoadBanner,
  quick_take: QuickTakeWidget,
};

// Size classes for the grid
const SIZE_CLASSES: Record<WidgetConfig['size'], string> = {
  small: 'col-span-1',
  medium: 'col-span-1 lg:col-span-1',
  large: 'col-span-1 lg:col-span-2',
  full: 'col-span-full',
};

export function WidgetRenderer({ config }: { config: WidgetConfig }) {
  const Component = WIDGET_MAP[config.type];
  if (!Component) return null;

  return (
    <div className={SIZE_CLASSES[config.size]}>
      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner size="md" />}>
          <Component />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
