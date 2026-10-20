import type { KnowledgeGraphNodeType } from '@boardroom/shared';
import { TYPE_SHAPE, type NodeShape } from '../graph/graph-theme';

/**
 * SVG path for a graph node shape centred at (0,0), radius r — the same
 * vocabulary `graph-theme.ts` paints on canvas, so an entity looks the same
 * on the dashboard, in a timeline and in the graph.
 */
export function shapePath(shape: NodeShape, r: number): string {
  switch (shape) {
    case 'diamond':
      return `M0,${-r * 1.25} L${r * 1.1},0 L0,${r * 1.25} L${-r * 1.1},0 Z`;
    case 'square': {
      const s = r * 0.95;
      return `M${-s},${-s} H${s} V${s} H${-s} Z`;
    }
    case 'triangle':
      return `M0,${-r * 1.2} L${r * 1.1},${r * 0.85} L${-r * 1.1},${r * 0.85} Z`;
    case 'hexagon': {
      const pts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        pts.push(`${(Math.cos(a) * r * 1.1).toFixed(2)},${(Math.sin(a) * r * 1.1).toFixed(2)}`);
      }
      return `M${pts.join(' L')} Z`;
    }
    case 'ring':
    case 'dot':
    case 'circle':
    default:
      return `M${-r},0 a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;
  }
}

export interface GlyphProps {
  type: KnowledgeGraphNodeType;
  color: string;
  /** Rendered box size in px. */
  size?: number;
  /** `hollow` paints the outline only (an ended / invalidated item). */
  mode?: 'fill' | 'hollow';
  className?: string;
  title?: string;
}

/** Inline entity glyph: shape from the graph's encoding, colour from the entity token. */
export function Glyph({ type, color, size = 12, mode = 'fill', className, title }: GlyphProps) {
  const shape = TYPE_SHAPE[type];
  const r = size * 0.36;
  const hollow = mode === 'hollow' || shape === 'ring';
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      data-glyph={type}
    >
      {title && <title>{title}</title>}
      <path
        d={shapePath(shape, r)}
        fill={hollow ? 'none' : color}
        stroke={color}
        strokeWidth={hollow ? Math.max(1.5, r * 0.45) : 0}
        strokeLinejoin="round"
      />
    </svg>
  );
}
