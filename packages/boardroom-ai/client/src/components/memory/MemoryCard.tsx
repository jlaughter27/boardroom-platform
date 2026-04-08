import { memo } from 'react';
import type { Memory } from '@boardroom/shared';
import { MemoryStatus } from '@boardroom/shared';
import { cn } from '../../lib/cn';

interface MemoryCardProps {
  memory: Memory;
  isSelected: boolean;
  onClick: () => void;
}

const statusColors: Record<string, string> = {
  [MemoryStatus.CONFIRMED]: 'bg-success-muted text-success border-success/30',
  [MemoryStatus.DRAFT]: 'bg-warning-muted text-warning border-warning/30',
  [MemoryStatus.ARCHIVED]: 'bg-bg-hover text-text-tertiary border-line',
  [MemoryStatus.SUPERSEDED]: 'bg-warning-muted text-warning border-warning/30',
  [MemoryStatus.REJECTED]: 'bg-danger-muted text-danger border-danger/30',
};

const confidenceColors: Record<string, string> = {
  HIGH: 'text-success',
  MEDIUM: 'text-warning',
  LOW: 'text-warning',
  SPECULATIVE: 'text-danger',
};

const classColors: Record<string, string> = {
  WORKING: 'bg-accent-muted text-accent border-accent/30',
  EPISODIC: 'bg-info-muted text-info border-info/30',
  SEMANTIC: 'bg-info-muted text-info border-info/30',
  DECISION: 'bg-warning-muted text-warning border-warning/30',
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

export const MemoryCard = memo(function MemoryCard({ memory, isSelected, onClick }: MemoryCardProps) {
  const statusColor = statusColors[memory.status] ?? 'bg-bg-hover text-text-tertiary border-line';
  const classColor = classColors[memory.memoryClass] ?? 'bg-bg-hover text-text-tertiary border-line';
  const confColor = confidenceColors[memory.confidence] ?? 'text-text-tertiary';

  const preview =
    memory.content.length > 100
      ? memory.content.slice(0, 100) + '...'
      : memory.content;

  const displayTags = memory.tags.slice(0, 3);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-all',
        isSelected
          ? 'border-accent ring-2 ring-accent/40 bg-bg-elevated'
          : 'border-line bg-bg-surface hover:bg-bg-elevated hover:border-line-strong'
      )}
    >
      <h3 className="text-sm font-semibold text-text-primary truncate">
        {memory.title}
      </h3>

      <p className="text-xs text-text-secondary mt-1 line-clamp-2">{preview}</p>

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {memory.domain && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-text-secondary border border-line">
            {memory.domain}
          </span>
        )}
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${classColor}`}>
          {memory.memoryClass}
        </span>
        <span className={`text-[10px] font-medium ${confColor}`}>
          {memory.confidence}
        </span>
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusColor}`}>
          {memory.status}
        </span>
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1">
          {displayTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-bg-hover text-text-secondary"
            >
              {tag}
            </span>
          ))}
          {memory.tags.length > 3 && (
            <span className="text-[10px] text-text-tertiary">
              +{memory.tags.length - 3}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
          <div className="flex items-center gap-1" title={`Importance: ${(memory.importance * 100).toFixed(0)}%`}>
            <div className="w-10 h-1 bg-bg-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full"
                style={{ width: `${memory.importance * 100}%` }}
              />
            </div>
          </div>
          <span>{relativeTime(memory.createdAt)}</span>
        </div>
      </div>
    </button>
  );
});
