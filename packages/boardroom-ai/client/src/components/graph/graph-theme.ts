import type { KnowledgeGraphNodeType } from '@boardroom/shared';

/**
 * Visual vocabulary for the knowledge graph.
 *
 * Colors come from CSS custom properties (tokens.css) so the canvas follows
 * the active theme. Each type also has a SHAPE, because seven categories
 * cannot be told apart by hue alone (validated: see tokens.css comment).
 */

export const NODE_TYPES: KnowledgeGraphNodeType[] = [
  'goal', 'project', 'task', 'person', 'decision', 'commitment', 'memory',
];

export const TYPE_LABEL: Record<KnowledgeGraphNodeType, string> = {
  goal: 'Goals',
  project: 'Projects',
  task: 'Tasks',
  person: 'People',
  decision: 'Decisions',
  commitment: 'Commitments',
  memory: 'Memories',
};

export const TYPE_SINGULAR: Record<KnowledgeGraphNodeType, string> = {
  goal: 'Goal',
  project: 'Project',
  task: 'Task',
  person: 'Person',
  decision: 'Decision',
  commitment: 'Commitment',
  memory: 'Memory',
};

export type NodeShape = 'circle' | 'diamond' | 'square' | 'triangle' | 'ring' | 'hexagon' | 'dot';

export const TYPE_SHAPE: Record<KnowledgeGraphNodeType, NodeShape> = {
  goal: 'diamond',
  project: 'square',
  task: 'triangle',
  person: 'circle',
  decision: 'ring',
  commitment: 'hexagon',
  memory: 'dot',
};

/** Base radius per type (px at zoom 1), before the degree bonus. */
export const TYPE_BASE_RADIUS: Record<KnowledgeGraphNodeType, number> = {
  goal: 7,
  project: 6,
  task: 4.5,
  person: 5.5,
  decision: 5.5,
  commitment: 4.5,
  memory: 2.6,
};

export interface GraphPalette {
  type: Record<KnowledgeGraphNodeType, string>;
  surface: string;
  edge: string;
  edgeStrong: string;
  label: string;
  labelHalo: string;
  font: string;
  /** Faint canvas grid + edge vignette (atmosphere) */
  grid: string;
  vignette: string;
  /** Focus glow tint (primary) */
  glow: string;
  /** Community hull hues, fixed slot order (validated per theme in tokens.css), plus the neutral fold slot */
  community: string[];
  communityNeutral: string;
  hullFillAlpha: number;
  hullStrokeAlpha: number;
  /** True when the dark token set is active (drives shadow strength) */
  dark: boolean;
}

const FALLBACK: GraphPalette = {
  type: {
    goal: '#c98500', project: '#2f7fd9', task: '#199e70', person: '#d55181',
    decision: '#f0f0f0', commitment: '#b48cff', memory: '#6f6e66',
  },
  surface: '#111110',
  edge: 'rgba(232,232,226,0.12)',
  edgeStrong: 'rgba(232,232,226,0.6)',
  label: '#e8e8e2',
  labelHalo: 'rgba(17,17,16,0.85)',
  font: 'Inter, system-ui, sans-serif',
  grid: 'rgba(232,232,226,0.045)',
  vignette: 'rgba(0,0,0,0.55)',
  glow: 'rgba(212,163,26,0.4)',
  community: ['#d95926', '#3987e5', '#c98500', '#008300', '#9085e9', '#e66767'],
  communityNeutral: '#898781',
  hullFillAlpha: 0.13,
  hullStrokeAlpha: 0.5,
  dark: true,
};

/** Read the live token values from the document (called on mount + theme change). */
export function readGraphPalette(): GraphPalette {
  if (typeof window === 'undefined') return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    type: {
      goal: v('--color-entity-goal', FALLBACK.type.goal),
      project: v('--color-entity-project', FALLBACK.type.project),
      task: v('--color-entity-task', FALLBACK.type.task),
      person: v('--color-entity-person', FALLBACK.type.person),
      decision: v('--color-entity-decision', FALLBACK.type.decision),
      commitment: v('--color-entity-commitment', FALLBACK.type.commitment),
      memory: v('--color-entity-memory', FALLBACK.type.memory),
    },
    surface: v('--graph-surface', FALLBACK.surface),
    edge: v('--graph-edge', FALLBACK.edge),
    edgeStrong: v('--graph-edge-strong', FALLBACK.edgeStrong),
    label: v('--graph-label', FALLBACK.label),
    labelHalo: v('--graph-label-halo', FALLBACK.labelHalo),
    font: v('--font-sans', FALLBACK.font),
    grid: v('--graph-grid', FALLBACK.grid),
    vignette: v('--graph-vignette', FALLBACK.vignette),
    glow: v('--graph-glow', FALLBACK.glow),
    community: FALLBACK.community.map((fb, i) => v(`--graph-community-${i + 1}`, fb)),
    communityNeutral: v('--graph-community-neutral', FALLBACK.communityNeutral),
    hullFillAlpha: Number(v('--graph-hull-fill-alpha', String(FALLBACK.hullFillAlpha))) || FALLBACK.hullFillAlpha,
    hullStrokeAlpha: Number(v('--graph-hull-stroke-alpha', String(FALLBACK.hullStrokeAlpha))) || FALLBACK.hullStrokeAlpha,
    dark: document.documentElement.classList.contains('dark'),
  };
}

/** Hue for a community id: the first six slots get a hue, the rest fold to neutral (never cycled). */
export function communityColor(palette: GraphPalette, communityId: number | undefined): string {
  if (communityId === undefined || communityId < 0 || communityId >= palette.community.length) return palette.communityNeutral;
  return palette.community[communityId];
}

/** `#rrggbb` (or `rgb()`/`rgba()`) → `rgba(r,g,b,alpha)`; unknown formats pass through. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16); const g = parseInt(h.slice(2, 4), 16); const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb) {
    const parts = rgb[1].split(',').map((x) => x.trim());
    return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
  }
  return color;
}

export type ShapeMode = 'fill' | 'hollow';

/**
 * Draw a node glyph centred at (0,0) in an already-translated context.
 * `mode: 'hollow'` paints the outline only (used for memories whose validity
 * has ended inside the timeline window).
 */
export function drawShape(ctx: CanvasRenderingContext2D, shape: NodeShape, r: number, fill: string, stroke?: string, mode: ShapeMode = 'fill'): void {
  if (mode === 'hollow') {
    traceShapePath(ctx, shape, r);
    ctx.lineWidth = Math.max(1.2, r * 0.3);
    ctx.strokeStyle = fill;
    ctx.stroke();
    if (stroke) { ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke(); }
    return;
  }
  ctx.beginPath();
  switch (shape) {
    case 'diamond':
      ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 1.1, 0); ctx.lineTo(0, r * 1.25); ctx.lineTo(-r * 1.1, 0); ctx.closePath();
      break;
    case 'square': {
      const s = r * 0.95;
      const k = Math.min(2, s * 0.35);
      ctx.moveTo(-s + k, -s); ctx.lineTo(s - k, -s); ctx.quadraticCurveTo(s, -s, s, -s + k);
      ctx.lineTo(s, s - k); ctx.quadraticCurveTo(s, s, s - k, s);
      ctx.lineTo(-s + k, s); ctx.quadraticCurveTo(-s, s, -s, s - k);
      ctx.lineTo(-s, -s + k); ctx.quadraticCurveTo(-s, -s, -s + k, -s); ctx.closePath();
      break;
    }
    case 'triangle':
      ctx.moveTo(0, -r * 1.2); ctx.lineTo(r * 1.1, r * 0.85); ctx.lineTo(-r * 1.1, r * 0.85); ctx.closePath();
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const x = Math.cos(a) * r * 1.1; const y = Math.sin(a) * r * 1.1;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    case 'ring':
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.4, r * 0.38);
      ctx.strokeStyle = fill;
      ctx.stroke();
      if (stroke) { ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2); ctx.fillStyle = stroke; ctx.fill(); }
      return;
    case 'dot':
    case 'circle':
    default:
      ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke(); }
}

/** Outline path for a shape (no fill / stroke) — the ring shape is its own outline. */
export function traceShapePath(ctx: CanvasRenderingContext2D, shape: NodeShape, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case 'diamond':
      ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 1.1, 0); ctx.lineTo(0, r * 1.25); ctx.lineTo(-r * 1.1, 0); ctx.closePath();
      return;
    case 'square': {
      const s = r * 0.95;
      ctx.rect(-s, -s, s * 2, s * 2);
      return;
    }
    case 'triangle':
      ctx.moveTo(0, -r * 1.2); ctx.lineTo(r * 1.1, r * 0.85); ctx.lineTo(-r * 1.1, r * 0.85); ctx.closePath();
      return;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const x = Math.cos(a) * r * 1.1; const y = Math.sin(a) * r * 1.1;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      return;
    case 'ring':
    case 'dot':
    case 'circle':
    default:
      ctx.arc(0, 0, r, 0, Math.PI * 2);
  }
}

/** Where an entity "lives" in the app, for the inspector's Open link. */
export function entityRoute(type: KnowledgeGraphNodeType, refId: string, meta: Record<string, unknown>): string | null {
  switch (type) {
    case 'person': return '/people';
    case 'memory': return `/memory?id=${encodeURIComponent(refId)}`;
    case 'decision': return typeof meta.sessionId === 'string' && meta.sessionId ? `/decisions/${meta.sessionId}` : '/decisions';
    case 'goal':
    case 'project':
    case 'task': return '/';
    case 'commitment': return '/';
    default: return null;
  }
}
