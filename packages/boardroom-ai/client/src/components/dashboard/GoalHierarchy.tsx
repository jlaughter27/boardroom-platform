import { useEffect, useState, useMemo } from 'react';
import { useEntitiesStore } from '../../stores/entities.store';
import { GoalNode } from './GoalNode';
import { EntityForm } from './EntityForm';
import { Card, Button, Skeleton, EmptyState } from '../ui';

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

  const projectsByGoal = useMemo(() => {
    const map: Record<string, typeof projects> = {};
    for (const goal of goals) {
      map[goal.id] = projects.filter((p) => p.domain === goal.domain);
    }
    return map;
  }, [goals, projects]);

  const tasksByProject = useMemo(() => {
    const map: Record<string, typeof tasks> = {};
    for (const project of projects) {
      map[project.id] = tasks;
    }
    return map;
  }, [projects, tasks]);

  function handleAddGoal(data: Record<string, unknown>) {
    createGoal(data);
    setShowAddGoal(false);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  if (goals.length === 0 && !showAddGoal) {
    return (
      <EmptyState
        variant="no-goals"
        title="No goals yet"
        description="Create your first goal to get started."
        action={{ label: 'Create Goal', onClick: () => setShowAddGoal(true) }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Goals &amp; Projects
        </h2>
        <Button variant="primary" size="sm" onClick={() => setShowAddGoal(true)}>
          <svg className="w-4 h-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Add Goal
        </Button>
      </div>

      {showAddGoal && (
        <EntityForm
          entityType="goal"
          onSubmit={handleAddGoal}
          onCancel={() => setShowAddGoal(false)}
        />
      )}

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
