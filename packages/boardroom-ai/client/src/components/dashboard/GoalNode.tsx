import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Goal, Project, Task } from '@boardroom/shared';
import { useEntitiesStore } from '../../stores/entities.store';
import { StatusBadge, LevelBadge, DomainBadge } from './StatusBadge';
import { ProjectNode } from './ProjectNode';
import { EntityForm } from './EntityForm';
import { Card, Button, Badge, Progress } from '../ui';

interface GoalNodeProps {
  goal: Goal;
  projects: Project[];
  tasksByProject: Record<string, Task[]>;
}

const STATUS_BORDER: Record<string, string> = {
  ACTIVE: 'border-l-success',
  COMPLETED: 'border-l-info',
  AT_RISK: 'border-l-warning',
  OVERDUE: 'border-l-danger',
  BLOCKED: 'border-l-danger',
};

export function GoalNode({ goal, projects, tasksByProject }: GoalNodeProps) {
  const { updateGoal, deleteGoal, createProject } = useEntitiesStore();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(goal.title);
  const [showAddProject, setShowAddProject] = useState(false);
  const [hovered, setHovered] = useState(false);

  function saveTitle() {
    if (editTitle.trim() && editTitle !== goal.title) {
      updateGoal(goal.id, { title: editTitle.trim() });
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') saveTitle();
    if (e.key === 'Escape') {
      setEditTitle(goal.title);
      setEditing(false);
    }
  }

  function handleAddProject(data: Record<string, unknown>) {
    createProject({ ...data, _goalId: goal.id });
    setShowAddProject(false);
  }

  const deadlineStr = goal.deadline
    ? new Date(goal.deadline).toLocaleDateString()
    : null;

  const borderClass = STATUS_BORDER[goal.status] ?? 'border-l-line';

  return (
    <Card
      className={`border-l-2 ${borderClass} p-0 overflow-hidden`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-text-tertiary hover:text-text-primary transition-colors flex-shrink-0"
        >
          <svg
            className={`w-4 h-4 transition-transform duration-fast ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </button>

        {editing ? (
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-bg-base border border-line rounded-md px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            className="flex-1 text-sm text-text-primary font-medium cursor-pointer"
          >
            {goal.title}
          </span>
        )}

        <LevelBadge level={goal.level} />
        <DomainBadge domain={goal.domain} />
        {deadlineStr && (
          <span className="text-xs text-text-tertiary">{deadlineStr}</span>
        )}
        <StatusBadge status={goal.status} />

        {hovered && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setExpanded(true); setShowAddProject(true); }}
              title="Add project"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteGoal(goal.id)}
              title="Delete goal"
            >
              <svg className="w-3.5 h-3.5 text-danger" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </Button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pb-3 space-y-1 border-t border-line">
              {projects.map((project) => (
                <ProjectNode
                  key={project.id}
                  project={project}
                  tasks={tasksByProject[project.id] ?? []}
                />
              ))}
              {projects.length === 0 && !showAddProject && (
                <p className="text-sm text-text-tertiary pl-12 py-2">
                  No projects yet
                </p>
              )}
              {showAddProject && (
                <div className="ml-10 mr-4 mt-2">
                  <EntityForm
                    entityType="project"
                    onSubmit={handleAddProject}
                    onCancel={() => setShowAddProject(false)}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
