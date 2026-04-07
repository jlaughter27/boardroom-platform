import type { Memory } from '@boardroom/shared';
import { MemoryStatus } from '@boardroom/shared';

interface MemoryCardProps {
  memory: Memory;
  isSelected: boolean;
  onClick: () => void;
}

const statusColors: Record<string, string> = {
  [MemoryStatus.CONFIRMED]: 'bg-green-900/50 text-green-400 border-green-800',
  [MemoryStatus.DRAFT]: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
  [MemoryStatus.ARCHIVED]: 'bg-gray-800 text-gray-500 border-gray-700',
  [MemoryStatus.SUPERSEDED]: 'bg-orange-900/50 text-orange-400 border-orange-800',
  [MemoryStatus.REJECTED]: 'bg-red-900/50 text-red-400 border-red-800',
};

const confidenceColors: Record<string, string> = {
  HIGH: 'text-green-400',
  MEDIUM: 'text-yellow-400',
  LOW: 'text-orange-400',
  SPECULATIVE: 'text-red-400',
};

const classColors: Record<string, string> = {
  WORKING: 'bg-purple-900/50 text-purple-400 border-purple-800',
  EPISODIC: 'bg-blue-900/50 text-blue-400 border-blue-800',
  SEMANTIC: 'bg-cyan-900/50 text-cyan-400 border-cyan-800',
  DECISION: 'bg-amber-900/50 text-amber-400 border-amber-800',
};

function relativeTime(date: Date | string): string {
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

export function MemoryCard({ memory, isSelected, onClick }: MemoryCardProps) {
  const statusColor =
    statusColors[memory.status] ?? 'bg-gray-800 text-gray-400 border-gray-700';
  const classColor =
    classColors[memory.memoryClass] ??
    'bg-gray-800 text-gray-400 border-gray-700';
  const confColor = confidenceColors[memory.confidence] ?? 'text-gray-400';

  const preview =
    memory.content.length > 100
      ? memory.content.slice(0, 100) + '...'
      : memory.content;

  const displayTags = memory.tags.slice(0, 3);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/40 bg-gray-800/80'
          : 'border-gray-700 bg-gray-800/50 hover:bg-gray-800/80 hover:border-gray-600'
      }`}
    >
      {/* Title */}
      <h3 className="text-sm font-semibold text-white truncate">
        {memory.title}
      </h3>

      {/* Content preview */}
      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{preview}</p>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {/* Domain */}
        {memory.domain && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400 border border-gray-700">
            {memory.domain}
          </span>
        )}

        {/* Memory class */}
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${classColor}`}
        >
          {memory.memoryClass}
        </span>

        {/* Confidence */}
        <span className={`text-[10px] font-medium ${confColor}`}>
          {memory.confidence}
        </span>

        {/* Status */}
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusColor}`}
        >
          {memory.status}
        </span>
      </div>

      {/* Tags + importance + time */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1">
          {displayTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-gray-700 text-gray-300"
            >
              {tag}
            </span>
          ))}
          {memory.tags.length > 3 && (
            <span className="text-[10px] text-gray-500">
              +{memory.tags.length - 3}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          {/* Importance bar */}
          <div className="flex items-center gap-1" title={`Importance: ${(memory.importance * 100).toFixed(0)}%`}>
            <div className="w-10 h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: `${memory.importance * 100}%` }}
              />
            </div>
          </div>
          <span>{relativeTime(memory.createdAt)}</span>
        </div>
      </div>
    </button>
  );
}
