const statusColors: Record<string, string> = {
  active: 'bg-green-900/50 text-green-400 border-green-800',
  completed: 'bg-blue-900/50 text-blue-400 border-blue-800',
  done: 'bg-blue-900/50 text-blue-400 border-blue-800',
  pending: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
  'in-progress': 'bg-purple-900/50 text-purple-400 border-purple-800',
  blocked: 'bg-red-900/50 text-red-400 border-red-800',
};

const defaultColor = 'bg-gray-800 text-gray-400 border-gray-700';

export function StatusBadge({ status }: { status: string }) {
  const colorClass = statusColors[status.toLowerCase()] ?? defaultColor;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colorClass}`}
    >
      {status}
    </span>
  );
}

const levelLabels: Record<number, string> = {
  0: 'L0 Vision',
  1: 'L1 Strategic',
  2: 'L2 Tactical',
  3: 'L3 Operational',
};

export function LevelBadge({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-900/50 text-indigo-400 border border-indigo-800">
      {levelLabels[level] ?? `L${level}`}
    </span>
  );
}

export function DomainBadge({ domain }: { domain: string }) {
  if (!domain) return null;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700">
      {domain}
    </span>
  );
}

const priorityColors: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-orange-500',
  3: 'bg-yellow-500',
  4: 'bg-green-500',
  5: 'bg-blue-500',
};

export function PriorityDot({ priority }: { priority: number }) {
  const color = priorityColors[priority] ?? 'bg-gray-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}
