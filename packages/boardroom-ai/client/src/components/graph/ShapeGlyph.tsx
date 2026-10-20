import type { NodeShape } from './graph-theme';

/** Tiny SVG glyph matching the canvas shape, used in chips, legend, tooltip and inspector. */
export function ShapeGlyph({ shape, color, size = 12 }: { shape: NodeShape; color: string; size?: number }) {
  const h = size / 2;
  const common = { fill: color, stroke: 'none' } as const;
  let el: React.ReactNode;
  switch (shape) {
    case 'diamond': el = <polygon points={`${h},0 ${size},${h} ${h},${size} 0,${h}`} {...common} />; break;
    case 'square': el = <rect x={1} y={1} width={size - 2} height={size - 2} rx={2} {...common} />; break;
    case 'triangle': el = <polygon points={`${h},0.5 ${size},${size - 1} 0,${size - 1}`} {...common} />; break;
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return `${h + Math.cos(a) * h},${h + Math.sin(a) * h}`;
      }).join(' ');
      el = <polygon points={pts} {...common} />; break;
    }
    case 'ring': el = <circle cx={h} cy={h} r={h - 1.5} fill="none" stroke={color} strokeWidth={2.2} />; break;
    case 'dot': el = <circle cx={h} cy={h} r={h * 0.5} {...common} />; break;
    default: el = <circle cx={h} cy={h} r={h - 1} {...common} />;
  }
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">{el}</svg>;
}
