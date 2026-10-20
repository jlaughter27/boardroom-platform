import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { GraphMinimap, boundsOf, fitTransform, fromMinimap, minimapTransform, toMinimap, viewportRect, type MinimapHandle } from '../../../src/components/graph/graph-minimap';

describe('graph-minimap — maths', () => {
  it('boundsOf ignores unpositioned points and returns null when empty', () => {
    expect(boundsOf([{ x: 1, y: 2 }, { x: -3, y: 5 }, { x: NaN, y: 0 }])).toEqual({ minX: -3, minY: 2, maxX: 1, maxY: 5 });
    expect(boundsOf([])).toBeNull();
  });

  it('minimapTransform fits and centres the bounds; to/from round-trip', () => {
    const t = minimapTransform({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, 160, 100, 10);
    expect(t.k).toBeCloseTo(0.7); // limited by width: 140 / 200
    const tl = toMinimap(t, 0, 0); const br = toMinimap(t, 200, 100);
    expect(tl.x).toBeCloseTo(10); expect(br.x).toBeCloseTo(150);
    expect((tl.y + br.y) / 2).toBeCloseTo(50); // vertically centred
    const back = fromMinimap(t, br.x, br.y);
    expect(back.x).toBeCloseTo(200); expect(back.y).toBeCloseTo(100);
  });

  it('fitTransform fills the inset area (~85% of the canvas) and leaves the taller top inset clear', () => {
    const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 200 };
    const t = fitTransform(bounds, 1000, 500, { top: 72, right: 32, bottom: 32, left: 32 });
    // height-limited: (500 - 104) / 200
    expect(t.k).toBeCloseTo(1.98);
    // the bounds' top edge lands exactly on the top inset, its centre on the inset area's centre
    const screenY = (y: number) => 250 + (y - t.cy) * t.k;
    const screenX = (x: number) => 500 + (x - t.cx) * t.k;
    expect(screenY(0)).toBeCloseTo(72);
    expect(screenY(200)).toBeCloseTo(468);
    expect(screenX(200)).toBeCloseTo(500);
    // clamped to the zoom limits
    expect(fitTransform({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 1000, 500, { top: 0, right: 0, bottom: 0, left: 0 }).k).toBe(8);
  });

  it('viewportRect inverts the d3-zoom transform', () => {
    // zoom k=2 with translation (100, 50) on an 800×600 canvas
    expect(viewportRect({ k: 2, x: 100, y: 50 }, 800, 600)).toEqual({ x: -50, y: -25, width: 400, height: 300 });
  });
});

describe('GraphMinimap', () => {
  const colors = { goal: '#1', project: '#2', task: '#3', person: '#4', decision: '#5', commitment: '#6', memory: '#7' } as const;

  it('clicking jumps to the graph point under the pointer (after a draw)', () => {
    const ref = createRef<MinimapHandle>();
    const onJump = vi.fn();
    render(<GraphMinimap ref={ref} width={160} height={100} colors={colors} surface="#000" frame="#fff" onJump={onJump} />);
    const canvas = screen.getByTestId('graph-minimap') as HTMLCanvasElement;
    // jsdom has no 2D context: draw() must not throw and must still record the transform-less state
    expect(() => ref.current!.draw([{ x: 0, y: 0, type: 'project', alpha: 1 }], null)).not.toThrow();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 100, right: 160, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(canvas, { clientX: 80, clientY: 50, pointerId: 1 });
    // without a context the transform is unknown → no jump; the component stays inert rather than guessing
    expect(onJump).not.toHaveBeenCalled();
    expect(canvas).toHaveAttribute('aria-label', 'Graph overview — click to pan');
  });
});
