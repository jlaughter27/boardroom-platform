import { cn } from '../../lib/cn';

const sizes = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
} as const;

const bgColors = [
  'bg-indigo-600', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-600',
  'bg-cyan-600', 'bg-rose-600', 'bg-blue-600', 'bg-purple-600',
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const colorIndex = hashName(name) % bgColors.length;
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium text-white',
        sizes[size],
        bgColors[colorIndex],
        className
      )}
      title={name}
    >
      {getInitials(name)}
    </div>
  );
}
