import { useState } from 'react';
import type { Task } from '@boardroom/shared';
import { useEntitiesStore } from '../../stores/entities.store';
import { StatusBadge, PriorityDot } from './StatusBadge';

interface TaskNodeProps {
  task: Task;
}

export function TaskNode({ task }: TaskNodeProps) {
  const { updateTask, deleteTask } = useEntitiesStore();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [hovered, setHovered] = useState(false);

  function toggleDone() {
    const newStatus = task.status === 'done' ? 'pending' : 'done';
    updateTask(task.id, { status: newStatus });
  }

  function saveTitle() {
    if (editTitle.trim() && editTitle !== task.title) {
      updateTask(task.id, { title: editTitle.trim() });
    }
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') saveTitle();
    if (e.key === 'Escape') {
      setEditTitle(task.title);
      setEditing(false);
    }
  }

  const deadlineStr = task.deadline
    ? new Date(task.deadline).toLocaleDateString()
    : null;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 pl-16 rounded-lg hover:bg-bg-elevated group transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Checkbox */}
      <button
        onClick={toggleDone}
        className={`flex-shrink-0 w-4 h-4 rounded border transition-colors ${
          task.status === 'done'
            ? 'bg-accent border-accent'
            : 'border-line-strong hover:border-line-strong'
        }`}
      >
        {task.status === 'done' && (
          <svg className="w-4 h-4 text-text-primary" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 8l3 3 5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <PriorityDot priority={task.priority} />

      {/* Title */}
      {editing ? (
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-bg-elevated border border-line-strong rounded px-2 py-0.5 text-sm text-text-primary focus:outline-none focus:border-accent"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          className={`flex-1 text-sm cursor-pointer ${
            task.status === 'done'
              ? 'text-text-tertiary line-through'
              : 'text-text-primary'
          }`}
        >
          {task.title}
        </span>
      )}

      {task.owner && (
        <span className="text-xs text-text-tertiary">{task.owner}</span>
      )}
      {deadlineStr && (
        <span className="text-xs text-text-tertiary">{deadlineStr}</span>
      )}
      <StatusBadge status={task.status} />

      {/* Delete action */}
      {hovered && (
        <button
          onClick={() => deleteTask(task.id)}
          className="text-bg-active hover:text-danger transition-colors"
          title="Delete task"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
