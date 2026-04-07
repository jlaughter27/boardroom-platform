import { useState } from 'react';
import type { Goal, Project, Task } from '@boardroom/shared';
import { useEntitiesStore } from '../../stores/entities.store';
import { StatusBadge, LevelBadge, DomainBadge } from './StatusBadge';
import { ProjectNode } from './ProjectNode';
import { EntityForm } from './EntityForm';

interface GoalNodeProps {
  goal: Goal;
  projects: Project[];
  tasksByProject: Record<string, Task[]>;
}

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

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800">
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800/50 transition-colors"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
        >
          <svg
            className={`w-5 h-5 transition-transform ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Goal icon */}
        <span className="text-yellow-500 flex-shrink-0">
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
          </svg>
        </span>

        {/* Title */}
        {editing ? (
          <input
            autoFocus
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white focus:outline-none focus:border-blue-600"
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            className="flex-1 text-white font-medium cursor-pointer"
          >
            {goal.title}
          </span>
        )}

        <LevelBadge level={goal.level} />
        <DomainBadge domain={goal.domain} />
        {deadlineStr && (
          <span className="text-xs text-gray-500">{deadlineStr}</span>
        )}
        <StatusBadge status={goal.status} />

        {/* Actions on hover */}
        {hovered && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setExpanded(true);
                setShowAddProject(true);
              }}
              className="text-gray-600 hover:text-green-400 transition-colors"
              title="Add project"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <button
              onClick={() => deleteGoal(goal.id)}
              className="text-gray-600 hover:text-red-400 transition-colors"
              title="Delete goal"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Projects list */}
      {expanded && (
        <div className="pb-3 space-y-1">
          {projects.map((project) => (
            <ProjectNode
              key={project.id}
              project={project}
              tasks={tasksByProject[project.id] ?? []}
            />
          ))}
          {projects.length === 0 && !showAddProject && (
            <p className="text-sm text-gray-600 pl-12 py-1">
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
      )}
    </div>
  );
}
