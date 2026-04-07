import { GoalHierarchy } from '../components/dashboard/GoalHierarchy';
import { ProactiveQuestions } from '../components/dashboard/ProactiveQuestions';
import { WeekCalendarStrip } from '../components/dashboard/WeekCalendarStrip';

export default function DashboardPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-white">Dashboard</h1>
      <ProactiveQuestions />
      <WeekCalendarStrip />
      <GoalHierarchy />
    </div>
  );
}
