import { Badge } from '../ui';

const statusVariant: Record<string, 'success' | 'info' | 'warning' | 'accent' | 'danger' | 'default'> = {
  active: 'success',
  completed: 'info',
  done: 'info',
  pending: 'warning',
  'in-progress': 'accent',
  blocked: 'danger',
};

export function StatusBadge({ status }: { status: string }) {
  const variant = statusVariant[status.toLowerCase()] ?? 'default';
  return <Badge variant={variant}>{status}</Badge>;
}

export function LevelBadge({ level }: { level: number }) {
  const levelLabels: Record<number, string> = {
    0: 'L0 Vision',
    1: 'L1 Strategic',
    2: 'L2 Tactical',
    3: 'L3 Operational',
  };
  return <Badge variant="accent">{levelLabels[level] ?? `L${level}`}</Badge>;
}

export function DomainBadge({ domain }: { domain: string }) {
  if (!domain) return null;
  return <Badge variant="default">{domain}</Badge>;
}

const priorityColors: Record<number, string> = {
  1: 'bg-danger',
  2: 'bg-warning',
  3: 'bg-warning',
  4: 'bg-success',
  5: 'bg-info',
};

export function PriorityDot({ priority }: { priority: number }) {
  const color = priorityColors[priority] ?? 'bg-muted-foreground';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}
