import { useState } from 'react';
import {
  CreateGoalRequestSchema,
  CreateProjectRequestSchema,
  CreateTaskRequestSchema,
} from '@boardroom/shared';

type EntityFormType = 'goal' | 'project' | 'task';

interface EntityFormProps {
  entityType: EntityFormType;
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function EntityForm({ entityType, onSubmit, onCancel }: EntityFormProps) {
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('active');
  const [deadline, setDeadline] = useState('');
  const [domain, setDomain] = useState('');
  const [level, setLevel] = useState(1);
  const [owner, setOwner] = useState('');
  const [priority, setPriority] = useState(3);
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const base: Record<string, unknown> = { title, status };
    if (deadline) base.deadline = new Date(deadline);

    if (entityType === 'goal') {
      base.level = level;
      if (domain) base.domain = domain;
      const result = CreateGoalRequestSchema.safeParse(base);
      if (!result.success) {
        setError(result.error.issues[0]?.message ?? 'Validation failed');
        return;
      }
      onSubmit(result.data);
    } else if (entityType === 'project') {
      if (domain) base.domain = domain;
      const result = CreateProjectRequestSchema.safeParse(base);
      if (!result.success) {
        setError(result.error.issues[0]?.message ?? 'Validation failed');
        return;
      }
      onSubmit(result.data);
    } else {
      if (owner) base.owner = owner;
      base.priority = priority;
      const result = CreateTaskRequestSchema.safeParse(base);
      if (!result.success) {
        setError(result.error.issues[0]?.message ?? 'Validation failed');
        return;
      }
      onSubmit(result.data);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-card rounded-lg p-4 border border-border space-y-3"
    >
      {/* Title - always shown */}
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`${entityType} title...`}
        className="w-full bg-card border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
      />

      <div className="flex flex-wrap gap-3">
        {/* Status */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-card border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary/40"
        >
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          {entityType === 'task' && <option value="done">Done</option>}
          <option value="blocked">Blocked</option>
        </select>

        {/* Level (goals only) */}
        {entityType === 'goal' && (
          <select
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="bg-card border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary/40"
          >
            <option value={0}>L0 Vision</option>
            <option value={1}>L1 Strategic</option>
            <option value={2}>L2 Tactical</option>
            <option value={3}>L3 Operational</option>
          </select>
        )}

        {/* Domain (goals & projects) */}
        {entityType !== 'task' && (
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="Domain"
            className="bg-card border border-border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 w-28"
          />
        )}

        {/* Owner (tasks only) */}
        {entityType === 'task' && (
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="Owner"
            className="bg-card border border-border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 w-28"
          />
        )}

        {/* Priority (tasks only) */}
        {entityType === 'task' && (
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="bg-card border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary/40"
          >
            <option value={1}>P1 High</option>
            <option value={2}>P2</option>
            <option value={3}>P3 Medium</option>
            <option value={4}>P4</option>
            <option value={5}>P5 Low</option>
          </select>
        )}

        {/* Deadline */}
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="bg-card border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary/40"
        />
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-foreground text-sm rounded transition-colors"
        >
          Create {entityType}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 bg-muted hover:bg-accent text-muted-foreground text-sm rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
