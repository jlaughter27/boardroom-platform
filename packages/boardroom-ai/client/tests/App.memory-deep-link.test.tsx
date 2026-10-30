/**
 * `/memory/:id` deep links (lane I, item 1). MCP tool results link to
 * `${OMNIMIND_MCP_APP_URL}/memory/<id>`; the client had no such route, so the
 * catch-all sent the user to the dashboard. The route now opens Memory
 * Explorer with that memory selected (`/memory?id=<id>`, the form the graph,
 * synthesis panel and what-changed card already link to).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import * as api from '../src/lib/api';
import type { UserProfile } from '@boardroom/shared';
import { AppRoutes } from '../src/App';
import { useAuthStore } from '../src/stores/auth.store';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, getUserProfile: vi.fn() };
});

// The shell and the pages are not under test: the route table is.
vi.mock('../src/components/shared/Layout', () => ({ Layout: () => <Outlet /> }));
function Where({ name }: { name: string }) {
  const loc = useLocation();
  return <p data-testid="page">{name} {loc.pathname}{loc.search}</p>;
}
vi.mock('../src/pages/MemoryExplorerPage', () => ({ default: () => <Where name="explorer" /> }));
vi.mock('../src/pages/DashboardPage', () => ({ default: () => <Where name="dashboard" /> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('/memory/:id deep link', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u-1', email: 'sam@example.test', name: 'Sam Rivera' } as never, isAuthenticated: true, isLoading: false });
    vi.mocked(api.getUserProfile).mockResolvedValue({ id: 'up-1', userId: 'u-1', onboardingComplete: true } as unknown as UserProfile);
  });

  it('opens Memory Explorer with the memory selected instead of landing on /', async () => {
    renderAt('/memory/mem-123');
    expect(await screen.findByTestId('page')).toHaveTextContent('explorer /memory?id=mem-123');
  });

  it('keeps an id that needs encoding intact', async () => {
    renderAt(`/memory/${encodeURIComponent('a b/c')}`);
    const page = await screen.findByTestId('page');
    const search = page.textContent!.split('/memory')[1];
    expect(new URLSearchParams(search).get('id')).toBe('a b/c');
  });

  it('plain /memory still renders the explorer with no selection', async () => {
    renderAt('/memory');
    expect(await screen.findByTestId('page')).toHaveTextContent(/^explorer \/memory$/);
  });

  it('an unknown top-level path still goes home', async () => {
    renderAt('/nowhere');
    expect(await screen.findByTestId('page')).toHaveTextContent(/^dashboard \/$/);
  });
});
