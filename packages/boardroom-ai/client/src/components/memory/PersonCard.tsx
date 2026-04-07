import { useState } from 'react';
import type { Person } from '@boardroom/shared';

interface PersonCardProps {
  person: Person;
  onEdit: (id: string, input: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}

function relativeTime(date: Date | string | null): string {
  if (!date) return 'Never';
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function PersonCard({ person, onEdit, onDelete }: PersonCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [role, setRole] = useState(person.role ?? '');
  const [relationship, setRelationship] = useState(
    person.relationshipToUser ?? '',
  );
  const [notes, setNotes] = useState(person.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave() {
    onEdit(person.id, {
      name,
      role: role || null,
      relationshipToUser: relationship || null,
      notes: notes || null,
    });
    setEditing(false);
  }

  function handleCancelEdit() {
    setName(person.name);
    setRole(person.role ?? '');
    setRelationship(person.relationshipToUser ?? '');
    setNotes(person.notes ?? '');
    setEditing(false);
  }

  // Importance dots (1-5 scale)
  const dots = Math.max(1, Math.round(person.importance * 5));

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors">
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-white truncate">
              {person.name}
            </h3>
            {person.role && (
              <p className="text-sm text-gray-400 mt-0.5">{person.role}</p>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-gray-500 shrink-0 ml-2 transition-transform ${
              expanded ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {person.domains.map((d) => (
            <span
              key={d}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400 border border-gray-700"
            >
              {d}
            </span>
          ))}
        </div>

        {/* Importance + last contact */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-0.5" title={`Importance: ${(person.importance * 100).toFixed(0)}%`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${
                  i < dots ? 'bg-blue-500' : 'bg-gray-700'
                }`}
              />
            ))}
          </div>
          <span className="text-[10px] text-gray-500">
            Last contact: {relativeTime(person.lastContactAt)}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
          {editing ? (
            <div className="space-y-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-600"
              />
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Role"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-600"
              />
              <input
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                placeholder="Relationship to you"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-600"
              />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes"
                rows={3}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-600 resize-y"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {person.relationshipToUser && (
                <div>
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Relationship
                  </p>
                  <p className="text-sm text-gray-300 mt-0.5">
                    {person.relationshipToUser}
                  </p>
                </div>
              )}
              {person.notes && (
                <div>
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                    Notes
                  </p>
                  <p className="text-sm text-gray-300 mt-0.5 whitespace-pre-wrap">
                    {person.notes}
                  </p>
                </div>
              )}
              <div>
                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                  Interaction Frequency
                </p>
                <p className="text-sm text-gray-300 mt-0.5">
                  {person.interactionFrequency} interactions
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(true)}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                >
                  Edit
                </button>
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="px-3 py-1 bg-gray-700 hover:bg-red-900/50 text-gray-400 hover:text-red-400 text-xs rounded transition-colors"
                  >
                    Delete
                  </button>
                ) : (
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        onDelete(person.id);
                        setConfirmDelete(false);
                      }}
                      className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                    >
                      Confirm Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                    >
                      No
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
