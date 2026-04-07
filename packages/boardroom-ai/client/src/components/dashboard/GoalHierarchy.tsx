import { useEffect, useState, useMemo } from 'react';
import { useEntitiesStore } from '../../stores/entities.store';
import { GoalNode } from './GoalNode';
import { EntityForm } from './EntityForm';

// Client-side mapping for goal→project and project→task relationships.
// In v1, we match by domain. The _goalId/_projectId fields stored during
// creation are not persisted server-side, so domain matching is the fallback.

export function GoalHierarchy() {
  const { goals, projects, tasks, isLoading, fetchGoals, fetchProjects, fetchTasks } =
    useEntitiesStore();
  const [showAddGoal, setShowAddGoal] = useState(false);
  const { createGoal } = useEntitiesStore();

  useEffect(() => {
    fetchGoals();
    fetchProjects();
    fetchTasks();
  }, []);

  // Group projects by domain to match with goals
  const projectsByGoal = useMemo(() => {
    const map: Record<string, typeof projects> = {};
    for (const goal of goals) {
      map[goal.id] = projects.filter((p) => p.domain === goal.domain);
    }
    // Projects with no matching goal domain get grouped under "unlinked"
    return map;
  }, [goals, projects]);

  // Group tasks by project (domain matching for v1)
  const tasksByProject = useMemo(() => {
    const map: Record<string, typeof tasks> = {};
    for (const project of projects) {
      map[project.id] = tasks.filter((t) => t.owner === project.title || t.status !== '__never__');
    }
    // For v1, just distribute tasks evenly or show all under each project
    // Better: use a simple index. Since there's no project_id on tasks,
    // show all tasks under all projects for now (will improve with join table API)
    for (const project of projects) {
      map[project.id] = tasks;
    }
    return map;
  }, [projects, tasks]);

  function handleAddGoal(data: Record<string, unknown>) {
    createGoal(data);
    setShowAddGoal(false);
  }

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-gray-900 rounded-lg border border-gray-800 p-4 animate-pulse"
          >
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-gray-800 rounded" />
              <div className="h-4 bg-gray-800 rounded w-48" />
              <div className="ml-auto h-4 bg-gray-800 rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Empty state
  if (goals.length === 0 && !showAddGoal) {
    return (
      <div className="text-center py-16">
        <svg
          className="w-16 h-16 text-gray-700 mx-auto mb-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
        </svg>
        <h3 className="text-lg font-medium text-gray-400 mb-2">
          No goals yet
        </h3>
        <p className="text-gray-600 text-sm mb-6">
          Create your first goal to get started.
        </p>
        <button
          onClick={() => setShowAddGoal(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          Create Goal
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header with Add button */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">
          Goals &amp; Projects
        </h2>
        <button
          onClick={() => setShowAddGoal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
              clipRule="evenodd"
            />
          </svg>
          Add Goal
        </button>
      </div>

      {showAddGoal && (
        <EntityForm
          entityType="goal"
          onSubmit={handleAddGoal}
          onCancel={() => setShowAddGoal(false)}
        />
      )}

      {/* Goal tree */}
      {goals.map((goal) => (
        <GoalNode
          key={goal.id}
          goal={goal}
          projects={projectsByGoal[goal.id] ?? []}
          tasksByProject={tasksByProject}
        />
      ))}
    </div>
  );
}
