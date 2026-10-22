import { useId } from 'react';
import { useChartTheme } from './hooks';

export interface ProgressRingProps {
  /** 0..1 */
  value: number;
  size?: number;
  stroke?: number;
  /** Centre text; defaults to a percentage. */
  label?: string;
  /** Accessible name, e.g. "12 of 20 reviewed decisions". */
  name: string;
  color?: string;
  className?: string;
}

/**
 * Meter as a ring: the fill carries progress in the accent; the track is a
 * lighter step of the same hue (not a grey), so state reads around the whole ring.
 */
export function ProgressRing({ value, size = 64, stroke = 6, label, name, color, className }: ProgressRingProps) {
  const theme = useChartTheme();
  const id = useId();
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fill = color ?? theme.accent;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-labelledby={id}
      className={className}
      data-viz="progress-ring"
      data-value={v.toFixed(3)}
    >
      <title id={id}>{name}: {Math.round(v * 100)} %</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={fill} strokeOpacity={0.18} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={fill}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c.toFixed(2)} ${c.toFixed(2)}`}
        strokeDashoffset={(c * (1 - v)).toFixed(2)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.24} fontWeight={600} fill={theme.text}>
        {label ?? `${Math.round(v * 100)}%`}
      </text>
    </svg>
  );
}
