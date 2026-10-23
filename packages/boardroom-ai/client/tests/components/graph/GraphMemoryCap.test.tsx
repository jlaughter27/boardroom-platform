import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KNOWLEDGE_GRAPH_MEMORY_LIMIT } from '@boardroom/shared';
import { GraphMemoryCap, memoryCapState } from '../../../src/components/graph/GraphMemoryCap';
import { graphOf, node } from './fixtures';

const withMemories = (shown: number, total: number | undefined, hit = total !== undefined && total > shown) => {
  const g = graphOf([node('goal:g'), ...Array.from({ length: shown }, (_, i) => node(`memory:m${i}`))], []);
  const stats = { ...g.stats, memoryLimitHit: hit } as typeof g.stats;
  if (total === undefined) delete (stats as Partial<typeof stats>).memoryTotal; else stats.memoryTotal = total;
  return { ...g, stats };
};

describe('memoryCapState (RD-6)', () => {
  it('nothing hidden → no next step', () => {
    expect(memoryCapState(withMemories(120, 120), 200)).toEqual({ shown: 120, total: 120, hidden: 0, nextLimit: null, atMax: false });
    expect(memoryCapState(null, 200)).toBeNull();
  });

  it('steps by 200 and never past the API maximum', () => {
    expect(memoryCapState(withMemories(200, 640), 200)?.nextLimit).toBe(400);
    expect(memoryCapState(withMemories(800, 5000), 800)?.nextLimit).toBe(KNOWLEDGE_GRAPH_MEMORY_LIMIT.MAX);
    const max = memoryCapState(withMemories(1000, 5000), 1000)!;
    expect(max).toMatchObject({ hidden: 4000, nextLimit: null, atMax: true });
  });

  it('counts lazily merged memories as shown and never reports a negative remainder', () => {
    expect(memoryCapState(withMemories(205, 200), 200)).toMatchObject({ shown: 205, total: 205, hidden: 0 });
  });

  it('an older server without memoryTotal still flags "more" when the cap was hit', () => {
    expect(memoryCapState(withMemories(200, undefined, true), 200)).toMatchObject({ shown: 200, hidden: 1, nextLimit: 400 });
    expect(memoryCapState(withMemories(50, undefined, false), 200)).toMatchObject({ hidden: 0 });
  });
});

describe('<GraphMemoryCap />', () => {
  it('says how many of how many, and the button asks for the next limit', () => {
    const onShowMore = vi.fn();
    render(<GraphMemoryCap state={memoryCapState(withMemories(200, 640), 200)!} loading={false} onShowMore={onShowMore} />);
    expect(screen.getByTestId('graph-memory-cap')).toHaveTextContent('Showing 200 of 640 memories');
    fireEvent.click(screen.getByRole('button', { name: 'Show 200 more' }));
    expect(onShowMore).toHaveBeenCalledWith(400);
  });

  it('while loading the button is disabled and busy', () => {
    render(<GraphMemoryCap state={memoryCapState(withMemories(200, 640), 200)!} loading onShowMore={vi.fn()} />);
    const b = screen.getByTestId('graph-show-more');
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });

  it('at the maximum it explains the limit instead of offering a button', () => {
    render(<GraphMemoryCap state={memoryCapState(withMemories(1000, 1500), 1000)!} loading={false} onShowMore={vi.fn()} />);
    expect(screen.queryByTestId('graph-show-more')).not.toBeInTheDocument();
    expect(screen.getByTestId('graph-memory-cap')).toHaveTextContent('500 more not shown (limit 1000)');
  });
});
