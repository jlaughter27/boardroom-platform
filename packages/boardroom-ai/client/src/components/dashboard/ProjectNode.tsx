import { useState } from 'react';
import type { Project, Task } from '@boardroom/shared';
import { useEntitiesStore } from '../../stores/entities.store';
import { StatusBadge, DomainBadge } from './StatusBadge';
import { TaskNode } from './TaskNode';
import { EntityForm } from './EntityForm';

interface ProjectNodeProps {
  project: Project;
  tasks: Task[];
}

export function ProjectNode({ project, tasks }: ProjectNodeProps) {
  const { updateProject, deleteProject, createTask } = useEntitiesStore();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(project.title);
  const [showAddTask, setShowAddTask] = useState(false);
  const [hovered, setHovered] = useState(false);

  function saveTitle() {
    if (editTitle.trim() && editTitle !== project.title) {
      updateProject(project.id, { title: editTitle.trim() });
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') saveTitle();
    if (e.key === 'Escape') {
      setEditTitle(project.title);
      setEditing(false);
    }
  }

  function handleAddTask(data: Record<string, unknown>) {
    // Store project mapping client-side via domain matching for v1
    createTask({ ...data, _projectId: project.id });
    setShowAddTask(false);
  }

  const deadlineStr = project.deadline
    ? new Date(project.deadline).toLocaleDateString()
    : null;

  return (
    <div className="ml-6">
      <div
        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800/50 group transition-colors"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Expand/collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
        >
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
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

        {/* Project icon */}
        <span className="text-gray-500 flex-shrink-0">
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
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
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-sm text-white focus:outline-none focus:border-blue-600"
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            className="flex-1 text-sm text-gray-200 cursor-pointer"
          >
            {project.title}
          </span>
        )}

        <DomainBadge domain={project.domain} />
        {deadlineStr && (
          <span className="text-xs text-gray-500">{deadlineStr}</span>
        )}
        <span className="text-xs text-gray-500">
          {tasks.length} task{tasks.length !== 1 ? 's' : ''}
        </span>
        <StatusBadge status={project.status} />

        {/* Actions on hover */}
        {hovered && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setExpanded(true);
                setShowAddTask(true);
              }}
              className="text-gray-600 hover:text-green-400 transition-colors"
              title="Add task"
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
              onClick={() => deleteProject(project.id)}
              className="text-gray-600 hover:text-red-400 transition-colors"
              title="Delete project"
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

      {/* Tasks list */}
      {expanded && (
        <div className="mt-1 space-y-0.5">
          {tasks.map((task) => (
            <TaskNode key={task.id} task={task} />
          ))}
          {tasks.length === 0 && !showAddTask && (
            <p className="text-xs text-gray-600 pl-16 py-1">No tasks yet</p>
          )}
          {showAddTask && (
            <div className="ml-10 mt-2">
              <EntityForm
                entityType="task"
                onSubmit={handleAddTask}
                onCancel={() => setShowAddTask(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
