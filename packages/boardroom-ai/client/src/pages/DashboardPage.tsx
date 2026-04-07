import { GoalHierarchy } from '../components/dashboard/GoalHierarchy';

export default function DashboardPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-6">Dashboard</h1>
      {/* ProactiveQuestions will go here in Task 3 */}
      {/* WeekCalendarStrip will go here in Task 3 */}
      <GoalHierarchy />
    </div>
  );
}
