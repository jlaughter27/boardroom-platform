import { GoalHierarchy } from '../components/dashboard/GoalHierarchy';
import { ProactiveQuestions } from '../components/dashboard/ProactiveQuestions';
import { OutcomeReviewBanner } from '../components/dashboard/OutcomeReviewBanner';
import { WeekCalendarStrip } from '../components/dashboard/WeekCalendarStrip';
import { WeeklyMemoCard } from '../components/dashboard/WeeklyMemoCard';
import { CortexInsightsPanel } from '../components/dashboard/CortexInsightsPanel';
import { CognitiveLoadBanner } from '../components/dashboard/CognitiveLoadBanner';

export default function DashboardPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-white">Dashboard</h1>
      <CognitiveLoadBanner />
      <ProactiveQuestions />
      <OutcomeReviewBanner />
      <WeekCalendarStrip />
      <WeeklyMemoCard />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <GoalHierarchy />
        </div>
        <div>
          <CortexInsightsPanel />
        </div>
      </div>
    </div>
  );
}
