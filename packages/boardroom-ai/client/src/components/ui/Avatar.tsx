import { cn } from '../../lib/cn';

const sizes = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
} as const;

// Avatar background palette. Hand-picked to coexist with the warm-gold
// brand (`bg-primary` slot included) while still giving users visual
// distinction. Hash maps a name to a stable color so "Sarah" always gets
// the same shade. Primary sits in position 2 so it shows up frequently
// enough to feel intentional without dominating. The 700 steps keep the
// white initials at AA (5.0–6.3:1; the 600 steps were 3.2–3.9:1) — M1-D1.
const bgColors = [
  'bg-primary text-primary-foreground', // warm gold — brand reinforcement; its paired label (M1-D1)
  'bg-emerald-700',
  'bg-amber-700',
  'bg-cyan-700',
  'bg-rose-700',
  'bg-sky-700',
  'bg-teal-700',
  'bg-orange-700',
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
