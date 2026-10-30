import { useEffect, useState, useMemo } from 'react';
import type { Goal, Project, ProjectLinkIds, Task } from '@boardroom/shared';
import { useEntitiesStore } from '../../stores/entities.store';
import { GoalNode } from './GoalNode';
import { EntityForm } from './EntityForm';
import { Card, Button, Skeleton, EmptyState } from '../ui';

/** A project as the store holds it: link ids present when listed with `include=links`. */
export type TreeProject = Project & Partial<ProjectLinkIds>;

/**
 * Goal → project → task grouping from the real links: a project sits under the
 * goals in its `goalIds` (GoalProjectLink) and lists the tasks in its `taskIds`
 * (ProjectTaskLink). Missing ids mean no links. Ids of goals / tasks that are
 * not loaded are ignored.
 */
export function buildGoalTree(goals: Goal[], projects: TreeProject[], tasks: Task[]) {
  const projectsByGoal: Record<string, TreeProject[]> = {};
  for (const goal of goals) projectsByGoal[goal.id] = [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const tasksByProject: Record<string, Task[]> = {};
  for (const project of projects) {
    for (const goalId of project.goalIds ?? []) projectsByGoal[goalId]?.push(project);
    tasksByProject[project.id] = (project.taskIds ?? []).map((id) => taskById.get(id)).filter((t): t is Task => t !== undefined);
  }
  return { projectsByGoal, tasksByProject };
}

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

  const { projectsByGoal, tasksByProject } = useMemo(
    () => buildGoalTree(goals, projects, tasks),
    [goals, projects, tasks],
  );

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
