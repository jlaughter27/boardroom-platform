import { useEffect, useState, useMemo, useId } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Goal, Project, ProjectLinkIds, Task } from '@boardroom/shared';
import { useEntitiesStore } from '../../stores/entities.store';
import { GoalNode, TreeChevron } from './GoalNode';
import { ProjectNode } from './ProjectNode';
import { TaskNode } from './TaskNode';
import { EntityForm } from './EntityForm';
import { Card, Button, Skeleton, EmptyState } from '../ui';

/** A project as the store holds it: link ids present when listed with `include=links`. */
export type TreeProject = Project & Partial<ProjectLinkIds>;

/**
 * Goal → project → task grouping from the real links: a project sits under the
 * goals in its `goalIds` (GoalProjectLink) and lists the tasks in its `taskIds`
 * (ProjectTaskLink). Missing ids mean no links. Ids of goals / tasks that are
 * not loaded are ignored.
 *
 * A project under no loaded goal lands in `unassignedProjects`; a task in no
 * loaded project lands in `unassignedTasks` (input order) — otherwise neither
 * would appear anywhere in the tree.
 */
export function buildGoalTree(goals: Goal[], projects: TreeProject[], tasks: Task[]) {
  const projectsByGoal: Record<string, TreeProject[]> = {};
  for (const goal of goals) projectsByGoal[goal.id] = [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const tasksByProject: Record<string, Task[]> = {};
  const unassignedProjects: TreeProject[] = [];
  const linkedTaskIds = new Set<string>();
  for (const project of projects) {
    let placed = false;
    for (const goalId of project.goalIds ?? []) {
      const bucket = projectsByGoal[goalId];
      if (bucket) { bucket.push(project); placed = true; }
    }
    if (!placed) unassignedProjects.push(project);
    tasksByProject[project.id] = (project.taskIds ?? []).map((id) => taskById.get(id)).filter((t): t is Task => t !== undefined);
    for (const t of tasksByProject[project.id]) linkedTaskIds.add(t.id);
  }
  const unassignedTasks = tasks.filter((t) => !linkedTaskIds.has(t.id));
  return { projectsByGoal, tasksByProject, unassignedProjects, unassignedTasks };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * A collapsible group at the end of the tree for entities with no parent link.
 * Same row styling as a goal; the chevron is a named button (aria-expanded).
 */
function UnassignedGroup({ title, count, children }: { title: string; count: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  return (
    <Card className="border-l-2 border-l-line p-0 overflow-hidden" data-testid="unassigned-group">
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors">
        <TreeChevron title={title} expanded={expanded} onToggle={() => setExpanded(!expanded)} controls={regionId} />
        <span className="flex-1 text-sm text-muted-foreground font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            id={regionId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pb-3 space-y-1 border-t border-border">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
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

  const { projectsByGoal, tasksByProject, unassignedProjects, unassignedTasks } = useMemo(
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

  const hasUnassigned = unassignedProjects.length > 0 || unassignedTasks.length > 0;

  if (goals.length === 0 && !showAddGoal && !hasUnassigned) {
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

      {unassignedProjects.length > 0 && (
        <UnassignedGroup title="Unassigned projects" count={plural(unassignedProjects.length, 'project')}>
          {unassignedProjects.map((project) => (
            <ProjectNode key={project.id} project={project} tasks={tasksByProject[project.id] ?? []} />
          ))}
        </UnassignedGroup>
      )}

      {unassignedTasks.length > 0 && (
        <UnassignedGroup title="Unassigned tasks" count={plural(unassignedTasks.length, 'task')}>
          {unassignedTasks.map((task) => (
            <TaskNode key={task.id} task={task} />
          ))}
        </UnassignedGroup>
      )}
    </div>
  );
}
