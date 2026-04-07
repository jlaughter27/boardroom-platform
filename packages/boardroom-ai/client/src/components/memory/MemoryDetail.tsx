import { useState } from 'react';
import type { Memory } from '@boardroom/shared';
import { MemoryClass, MemoryStatus, Confidence } from '@boardroom/shared';
import { useMemoryStore } from '../../stores/memory.store';

interface MemoryDetailProps {
  memory: Memory;
}

function relativeTime(date: Date | string | null): string {
  if (!date) return 'N/A';
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

function formatDate(date: Date | string | null): string {
  if (!date) return 'N/A';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MemoryDetail({ memory }: MemoryDetailProps) {
  const { updateMemory, archiveMemory } = useMemoryStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(memory.title);
  const [content, setContent] = useState(memory.content);
  const [importance, setImportance] = useState(memory.importance);
  const [tags, setTags] = useState(memory.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Reset form when memory changes
  if (title !== memory.title && !editing) {
    setTitle(memory.title);
    setContent(memory.content);
    setImportance(memory.importance);
    setTags(memory.tags.join(', '));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateMemory(memory.id, {
        title,
        content,
        importance,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setEditing(false);
    } catch {
      // error already logged in store
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    try {
      await archiveMemory(memory.id);
    } catch {
      // error already logged in store
    }
    setConfirmArchive(false);
  }

  function handleCancelEdit() {
    setTitle(memory.title);
    setContent(memory.content);
    setImportance(memory.importance);
    setTags(memory.tags.join(', '));
    setEditing(false);
  }

  const sessionLink =
    memory.sourceRef?.startsWith('session:')
      ? `/decisions/${memory.sourceRef.slice(8)}`
      : null;

  const labelClass = 'text-[11px] font-medium text-gray-500 uppercase tracking-wider';
  const valueClass = 'text-sm text-gray-300';

  return (
    <div className="space-y-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-lg font-bold text-white focus:outline-none focus:border-blue-600"
          />
        ) : (
          <h2 className="text-lg font-bold text-white flex-1">{memory.title}</h2>
        )}

        <div className="flex gap-1.5 shrink-0">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs rounded transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
              >
                Edit
              </button>
              {!confirmArchive ? (
                <button
                  onClick={() => setConfirmArchive(true)}
                  className="px-3 py-1 bg-gray-700 hover:bg-red-900/50 text-gray-400 hover:text-red-400 text-xs rounded transition-colors"
                >
                  Archive
                </button>
              ) : (
                <div className="flex gap-1">
                  <button
                    onClick={handleArchive}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmArchive(false)}
                    className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                  >
                    No
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div>
        <p className={labelClass}>Content</p>
        {editing ? (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-600 resize-y"
          />
        ) : (
          <p className="text-sm text-gray-300 whitespace-pre-wrap mt-1">
            {memory.content}
          </p>
        )}
      </div>

      {/* Two-column info grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className={labelClass}>Domain</p>
          <p className={valueClass}>{memory.domain}</p>
        </div>
        <div>
          <p className={labelClass}>Sector</p>
          <p className={valueClass}>{memory.sector || 'N/A'}</p>
        </div>
        <div>
          <p className={labelClass}>Memory Class</p>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
              {
                [MemoryClass.WORKING]:
                  'bg-purple-900/50 text-purple-400 border-purple-800',
                [MemoryClass.EPISODIC]:
                  'bg-blue-900/50 text-blue-400 border-blue-800',
                [MemoryClass.SEMANTIC]:
                  'bg-cyan-900/50 text-cyan-400 border-cyan-800',
                [MemoryClass.DECISION]:
                  'bg-amber-900/50 text-amber-400 border-amber-800',
              }[memory.memoryClass] ?? 'bg-gray-800 text-gray-400 border-gray-700'
            }`}
          >
            {memory.memoryClass}
          </span>
        </div>
        <div>
          <p className={labelClass}>Status</p>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
              {
                [MemoryStatus.CONFIRMED]:
                  'bg-green-900/50 text-green-400 border-green-800',
                [MemoryStatus.DRAFT]:
                  'bg-yellow-900/50 text-yellow-400 border-yellow-800',
                [MemoryStatus.ARCHIVED]:
                  'bg-gray-800 text-gray-500 border-gray-700',
                [MemoryStatus.SUPERSEDED]:
                  'bg-orange-900/50 text-orange-400 border-orange-800',
                [MemoryStatus.REJECTED]:
                  'bg-red-900/50 text-red-400 border-red-800',
              }[memory.status] ?? 'bg-gray-800 text-gray-400 border-gray-700'
            }`}
          >
            {memory.status}
          </span>
        </div>
        <div>
          <p className={labelClass}>Confidence</p>
          <span
            className={`text-sm font-medium ${
              {
                [Confidence.HIGH]: 'text-green-400',
                [Confidence.MEDIUM]: 'text-yellow-400',
                [Confidence.LOW]: 'text-orange-400',
                [Confidence.SPECULATIVE]: 'text-red-400',
              }[memory.confidence] ?? 'text-gray-400'
            }`}
          >
            {memory.confidence}
          </span>
        </div>
        <div>
          <p className={labelClass}>Importance</p>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={importance}
                onChange={(e) => setImportance(Number(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="text-sm text-gray-300 w-10 text-right">
                {(importance * 100).toFixed(0)}%
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${memory.importance * 100}%` }}
                />
              </div>
              <span className="text-sm text-gray-300">
                {(memory.importance * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
        <div>
          <p className={labelClass}>Source Type</p>
          <p className={valueClass}>{memory.sourceType}</p>
        </div>
        <div>
          <p className={labelClass}>Source Ref</p>
          {sessionLink ? (
            <a
              href={sessionLink}
              className="text-sm text-blue-400 hover:text-blue-300 underline"
            >
              Session {memory.sourceRef!.slice(8, 16)}...
            </a>
          ) : (
            <p className={valueClass}>{memory.sourceRef ?? 'N/A'}</p>
          )}
        </div>
        <div>
          <p className={labelClass}>Source Weight</p>
          <p className={valueClass}>{memory.sourceWeight}</p>
        </div>
        <div>
          <p className={labelClass}>Version</p>
          <p className={valueClass}>{memory.version}</p>
        </div>
        <div>
          <p className={labelClass}>Valid At</p>
          <p className={valueClass}>{formatDate(memory.validAt)}</p>
        </div>
        <div>
          <p className={labelClass}>Invalid At</p>
          <p className={valueClass}>{formatDate(memory.invalidAt)}</p>
        </div>
        {memory.supersededBy && (
          <div className="col-span-2">
            <p className={labelClass}>Superseded By</p>
            <p className="text-sm text-blue-400">{memory.supersededBy}</p>
          </div>
        )}
      </div>

      {/* Tags */}
      <div>
        <p className={labelClass}>Tags</p>
        {editing ? (
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Comma-separated tags..."
            className="w-full mt-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-600"
          />
        ) : (
          <div className="flex flex-wrap gap-1 mt-1">
            {memory.tags.length > 0 ? (
              memory.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-300"
                >
                  {tag}
                </span>
              ))
            ) : (
              <span className="text-sm text-gray-500">No tags</span>
            )}
          </div>
        )}
      </div>

      {/* Timestamps */}
      <div className="border-t border-gray-700 pt-3 space-y-1">
        <p className="text-xs text-gray-500">
          Created: {formatDate(memory.createdAt)} ({relativeTime(memory.createdAt)})
        </p>
        <p className="text-xs text-gray-500">
          Updated: {formatDate(memory.updatedAt)} ({relativeTime(memory.updatedAt)})
        </p>
        <p className="text-xs text-gray-500">
          Last accessed: {memory.lastAccessedAt ? `${formatDate(memory.lastAccessedAt)} (${relativeTime(memory.lastAccessedAt)})` : 'Never'}
        </p>
      </div>

      {/* Metadata */}
      {memory.metadata && Object.keys(memory.metadata).length > 0 && (
        <div>
          <p className={labelClass}>Metadata</p>
          <pre className="mt-1 bg-gray-900 border border-gray-700 rounded p-2 text-xs text-gray-400 overflow-x-auto">
            {JSON.stringify(memory.metadata, null, 2)}
          </pre>
        </div>
      )}

      {/* Session link */}
      {sessionLink && (
        <p className="text-xs text-gray-500">
          Created during{' '}
          <a
            href={sessionLink}
            className="text-blue-400 hover:text-blue-300 underline"
          >
            session {memory.sourceRef!.slice(8)}
          </a>
        </p>
      )}
    </div>
  );
}
