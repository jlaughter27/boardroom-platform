import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const addTransitionType = vi.fn();
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, addTransitionType: (type: string) => addTransitionType(type) };
});

import {
  NAV_BACK, NAV_FORWARD, directionFromIndex, historyIndex, isRouterLinkClick,
  useRouteTransitionTypes, useTransitionNavigate,
} from '../../src/hooks/useRouteTransition';

function Shell() {
  useRouteTransitionTypes();
  const navigate = useTransitionNavigate();
  const location = useLocation();
  return (
    <div>
      <span data-testid="path">{location.pathname}</span>
      <Link to="/memory">Memory</Link>
      <a href="https://example.com/x">External</a>
      <button onClick={() => navigate('/people')}>Go people</button>
      <button onClick={() => navigate('/', { direction: NAV_BACK })}>Go home (back)</button>
      <button onClick={() => navigate(-1)}>History back</button>
    </div>
  );
}

function App({ initial = ['/'] }: { initial?: string[] }) {
  return (
    <MemoryRouter initialEntries={initial}>
      <Routes>
        <Route path="*" element={<Shell />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('route transition direction', () => {
  beforeEach(() => addTransitionType.mockClear());

  it('reads react-router history indices and derives a direction', () => {
    expect(historyIndex({ idx: 3 })).toBe(3);
    expect(historyIndex(null)).toBeNull();
    expect(historyIndex({})).toBeNull();
    expect(directionFromIndex(3, 2)).toBe(NAV_BACK);
    expect(directionFromIndex(2, 3)).toBe(NAV_FORWARD);
    expect(directionFromIndex(null, 2)).toBe(NAV_BACK);
    expect(directionFromIndex(2, null)).toBe(NAV_BACK);
  });

  it('recognises a router-handled same-origin link click and nothing else', () => {
    const a = document.createElement('a');
    a.href = '/memory';
    document.body.appendChild(a);
    const handled = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(handled, 'target', { value: a });
    handled.preventDefault();
    expect(isRouterLinkClick(handled)).toBe(true);

    const unhandled = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(unhandled, 'target', { value: a });
    expect(isRouterLinkClick(unhandled)).toBe(false);

    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    Object.defineProperty(modified, 'target', { value: a });
    modified.preventDefault();
    expect(isRouterLinkClick(modified)).toBe(false);

    const external = document.createElement('a');
    external.href = 'https://example.com/x';
    document.body.appendChild(external);
    const ext = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(ext, 'target', { value: external });
    ext.preventDefault();
    expect(isRouterLinkClick(ext)).toBe(false);
    a.remove(); external.remove();
  });

  it('tags a router link click as forward', () => {
    render(<App />);
    fireEvent.click(screen.getByText('Memory'));
    expect(screen.getByTestId('path').textContent).toBe('/memory');
    expect(addTransitionType).toHaveBeenCalledWith(NAV_FORWARD);
  });

  it('tags programmatic navigation with its direction', () => {
    render(<App />);
    fireEvent.click(screen.getByText('Go people'));
    expect(screen.getByTestId('path').textContent).toBe('/people');
    expect(addTransitionType).toHaveBeenLastCalledWith(NAV_FORWARD);

    fireEvent.click(screen.getByText('Go home (back)'));
    expect(screen.getByTestId('path').textContent).toBe('/');
    expect(addTransitionType).toHaveBeenLastCalledWith(NAV_BACK);
  });

  it('tags a history delta as back and a popstate as back / forward by index', () => {
    render(<App initial={['/', '/memory']} />);
    fireEvent.click(screen.getByText('History back'));
    expect(addTransitionType).toHaveBeenCalledWith(NAV_BACK);

    addTransitionType.mockClear();
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 0 } })); });
    expect(addTransitionType).toHaveBeenCalledWith(NAV_BACK);

    addTransitionType.mockClear();
    window.history.replaceState({ idx: 0 }, '');
    render(<App />); // re-arm lastIdx from history.state (0)
    act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: { idx: 1 } })); });
    expect(addTransitionType).toHaveBeenCalledWith(NAV_FORWARD);
  });
});
