/**
 * Fixes from the UI e2e run on a real backend (2026-10-30, lane E): layout
 * that cannot scroll the page sideways, toasts that stay clear of an open
 * sheet, opening a memory moves the view and focus, linked-entity names,
 * truthful dashboard copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Decision, Memory, OutcomeReviewNudge } from '@boardroom/shared';
import * as api from '../../src/lib/api';
import { DataTable } from '../../src/components/viz/ChartFrame';
import { ScrollRow } from '../../src/components/ui/ScrollRow';
import { Toaster, toastPlacement, useToastStore } from '../../src/components/ui/Toast';
import { MemoryList } from '../../src/components/memory/MemoryList';
import { MemoryDetail } from '../../src/components/memory/MemoryDetail';
import { useMemoryStore } from '../../src/stores/memory.store';
import { useEntitiesStore } from '../../src/stores/entities.store';
import { reviewsTile } from '../../src/components/dashboard/CockpitRow';
import { decisionNudgeDue } from '../../src/pages/DashboardPage';

vi.mock('../../src/lib/api', () => ({
  listMemories: vi.fn(),
  getMemory: vi.fn(),
  getMemoryLinks: vi.fn(),
  getMemoryBacklinks: vi.fn(),
  deleteMemoryLink: vi.fn(),
  updateMemory: vi.fn(),
  archiveMemory: vi.fn(),
  getPeople: vi.fn(),
}));

const mem = (id: string, title: string): Memory =>
  ({
    id, title, content: 'Plain body.', tags: [], domain: 'business', sector: null, memoryClass: 'SEMANTIC', confidence: 'HIGH', status: 'CONFIRMED',
    importance: 0.5, sourceType: 'API_IMPORT', sourceRef: null, sourceWeight: 1, version: 1, validAt: null, invalidAt: null,
    supersededBy: null, metadata: {}, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', lastAccessedAt: null,
  } as unknown as Memory);

describe('chart table twin cannot widen the page (#main-content overflow)', () => {
  it('the visually-hidden box is a clipped wrapper, not the <table> (a table ignores width: 1px)', () => {
    const { container } = render(<DataTable caption="Spend" columns={['Week', 'USD']} rows={[['Week of Oct 5', '$4.00']]} />);
    const table = container.querySelector('table[data-viz-table]')!;
    expect(table).not.toHaveClass('sr-only');
    const wrap = table.parentElement!;
    expect(wrap).toHaveAttribute('data-viz-table-wrap');
    expect(wrap).toHaveClass('sr-only');
    // Still in the accessibility tree: caption + headers are there for screen readers.
    expect(screen.getByRole('table', { name: 'Spend' })).toBe(table);
  });
});

describe('<ScrollRow /> — a row that scrolls inside itself, with a fade on the side that has more', () => {
  type Cb = (entries: Array<{ target: Element; isIntersecting: boolean; intersectionRatio: number }>) => void;
  let fire: Cb = () => {};
  let root: Element | null = null;
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: Cb, opts: { root: Element }) { fire = cb; root = opts.root; }
      observe() {}
      disconnect() {}
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fades the trailing edge while the last tab is cut off, both edges mid-scroll, the leading edge at the end', () => {
    render(<ScrollRow data-testid="row"><button>Overview</button><button>Audit Log</button><button>Duplicates</button></ScrollRow>);
    const row = screen.getByTestId('row');
    const [first, , last] = [...row.children];
    expect(root).toBe(row);
    expect(row.className).toMatch(/overflow-x-auto/);
    expect(row).not.toHaveAttribute('data-more-end');
    const seen = (el: Element, ratio: number) => ({ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio });
    act(() => fire([seen(first, 1), seen(last, 0)]));
    expect(row).toHaveAttribute('data-more-end');
    expect(row).not.toHaveAttribute('data-more-start');
    act(() => fire([seen(first, 0.4), seen(last, 0.5)]));
    expect(row).toHaveAttribute('data-more-start');
    expect(row).toHaveAttribute('data-more-end');
    act(() => fire([seen(last, 1)]));
    expect(row).toHaveAttribute('data-more-start');
    expect(row).not.toHaveAttribute('data-more-end');
  });
});

describe('toasts stay clear of an open dialog / sheet', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
  });
  afterEach(() => {
    document.querySelectorAll('[data-test-dialog]').forEach((d) => d.remove());
    vi.unstubAllGlobals();
  });

  function addDialog(left: number) {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('data-test-dialog', '');
    d.getBoundingClientRect = () => ({ left, right: 1428, top: 12, bottom: 888, width: 1428 - left, height: 876, x: left, y: 12, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(d);
    return d;
  }

  it('placement: corner with nothing open, beside a right-hand sheet that leaves room, top when the modal spans the width', () => {
    expect(toastPlacement(document, 1440)).toEqual({ kind: 'corner' });
    const sheet = addDialog(916); // the 1440 px Delegate side sheet
    expect(toastPlacement(document, 1440)).toEqual({ kind: 'beside', right: 1440 - 916 + 16 });
    sheet.remove();
    addDialog(0); // a phone bottom sheet
    expect(toastPlacement(document, 390)).toEqual({ kind: 'top' });
  });

  it('the live toaster moves when a dialog opens and back when it closes; the live region stays', async () => {
    render(<Toaster />);
    act(() => { useToastStore.getState().addToast('Copied, but not recorded', 'error'); });
    const toaster = screen.getByTestId('toaster');
    expect(toaster).toHaveAttribute('aria-live', 'polite');
    expect(toaster).toHaveAttribute('data-placement', 'corner');
    expect(toaster.className).toMatch(/bottom-4 right-4/);
    const dialog = addDialog(0);
    await waitFor(() => expect(toaster).toHaveAttribute('data-placement', 'top'));
    expect(toaster.className).toMatch(/top-4/);
    expect(screen.getByRole('status')).toHaveTextContent('Copied, but not recorded');
    dialog.remove();
    await waitFor(() => expect(toaster).toHaveAttribute('data-placement', 'corner'));
  });
});

describe('opening a memory brings the detail into view and focuses its title', () => {
  const A = mem('m-a', 'Pricing playbook');
  const B = mem('m-b', 'Design partners');
  let matches = false;

  function Explorer() {
    const selected = useMemoryStore((s) => s.selectedMemory);
    return (
      <>
        <MemoryList />
        <div data-memory-panel data-testid="panel">{selected && <MemoryDetail memory={selected} />}</div>
      </>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useMemoryStore.getState().reset();
    useMemoryStore.setState({ memories: [A, B], total: 2, offset: 2 });
    useEntitiesStore.getState().reset();
    // A real frame: the callback runs after React has committed the click's render.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal('matchMedia', (q: string) => ({ matches, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.listMemories).mockResolvedValue({ items: [], total: 0, offset: 0, limit: 5 });
    vi.mocked(api.getMemoryLinks).mockResolvedValue([]);
    vi.mocked(api.getMemoryBacklinks).mockResolvedValue({ items: [], truncated: false });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('side by side (lg): Enter / click on a card focuses the title, scrolling only as far as needed', async () => {
    matches = false;
    render(<Explorer />);
    fireEvent.click(screen.getByRole('button', { name: /Design partners/ }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Design partners' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(title.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('stacked on a phone: the whole detail panel scrolls to the top of the pane, then the title takes focus', async () => {
    matches = true;
    render(<Explorer />);
    fireEvent.click(screen.getByRole('button', { name: /Pricing playbook/ }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Pricing playbook' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    const panel = screen.getByTestId('panel');
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(panel);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('a linked person shows their name, not a raw id', async () => {
    vi.mocked(api.getMemoryLinks).mockResolvedValue([
      { id: 'l1', memoryId: 'm-a', entityType: 'person', entityId: 'cmvva4z1example0001', linkType: 'mentions' },
    ]);
    vi.mocked(api.getPeople).mockResolvedValue([{ id: 'cmvva4z1example0001', name: 'Amara Hale' }] as never);
    render(<MemoryDetail memory={A} />);
    expect(await screen.findByText(/person:\s*Amara Hale/)).toBeInTheDocument();
    expect(screen.queryByText(/cmvva4z1/)).not.toBeInTheDocument();
    expect(api.getPeople).toHaveBeenCalledTimes(1);
  });
});

describe('dashboard copy tells the truth', () => {
  const NOW = Date.parse('2026-10-30T12:00:00.000Z');
  const nudge = (id: string, decisionId: string, scheduledFor: string, status: OutcomeReviewNudge['status'] = 'pending') =>
    ({ id, decisionId, scheduledFor, status } as unknown as OutcomeReviewNudge);
  const decision = (id: string, status: string, reviewAt: string | null, outcome: string | null = null) =>
    ({ id, status, reviewAt, outcome, createdAt: '2026-09-01T00:00:00.000Z' } as unknown as Decision);

  it('"Decisions awaiting review" counts decisions past reviewAt even with zero nudges, and never says "all outcomes reviewed"', () => {
    const t = reviewsTile([], NOW, [
      decision('d1', 'DECIDED', '2026-10-20T00:00:00.000Z'), // past due, no outcome → awaiting
      decision('d2', 'DECIDED', '2026-11-29T00:00:00.000Z'), // not due yet
      decision('d3', 'REVIEWED', '2026-10-01T00:00:00.000Z', 'Worked'),
      decision('d4', 'OPEN', '2026-10-01T00:00:00.000Z'), // not committed
    ]);
    expect(t).toMatchObject({ value: '1', hint: 'oldest waiting 10 d', tone: 'danger' });
    const none = reviewsTile([], NOW, [decision('d2', 'DECIDED', '2026-11-29T00:00:00.000Z')]);
    expect(none).toMatchObject({ value: '0', hint: 'none due' });
  });

  it('a decision with both an open nudge and a passed reviewAt counts once', () => {
    const t = reviewsTile([nudge('n1', 'd1', '2026-10-28T00:00:00.000Z')], NOW, [decision('d1', 'DECIDED', '2026-10-25T00:00:00.000Z')]);
    expect(t.value).toBe('1');
    expect(t.hint).toBe('oldest waiting 5 d');
  });

  it('"You haven\'t run a decision analysis in 7+ days" never shows for a brand-new account', () => {
    expect(decisionNudgeDue([], NOW)).toBe(false);
    expect(decisionNudgeDue([{ createdAt: '2026-10-29T00:00:00.000Z' }], NOW)).toBe(false);
    expect(decisionNudgeDue([{ createdAt: '2026-10-20T00:00:00.000Z' }], NOW)).toBe(true);
  });
});
