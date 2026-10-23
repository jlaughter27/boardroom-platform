/**
 * RD-9d — the profile-unavailable banner lives in the shell's right column,
 * AFTER the scrolling main pane (in flow, centred on that column), so it never
 * covers the pane's bottom row and never centres over the sidebar.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { Layout, type ShellOutletContext } from '../../../src/components/shared/Layout';

vi.mock('../../../src/components/shared/Sidebar', () => ({ Sidebar: () => <nav data-testid="sidebar" />, MobileDrawer: () => null }));
vi.mock('../../../src/components/shared/AppHeader', () => ({ AppHeader: () => <header /> }));
vi.mock('../../../src/components/shared/TrialBanner', () => ({ TrialBanner: () => null }));
vi.mock('../../../src/components/shared/ShortcutsModal', () => ({ ShortcutsModal: () => null }));
vi.mock('../../../src/hooks/useNotificationAggregator', () => ({ useNotificationAggregator: () => {} }));
vi.mock('../../../src/hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => [] }));
vi.mock('../../../src/hooks/useRouteTransition', () => ({ useRouteTransitionTypes: () => {} }));
vi.mock('../../../src/stores/entities.store', () => ({
  useEntitiesStore: (sel: (s: { fetchDecisions: () => void; fetchCommitments: () => void }) => unknown) => sel({ fetchDecisions: () => {}, fetchCommitments: () => {} }),
}));

function renderShell(context: ShellOutletContext) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Outlet context={context} />}>
          <Route element={<Layout />}>
            <Route path="/" element={<p>page body</p>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout pane notice (RD-9d)', () => {
  it('renders the notice after <main>, in the same column, not fixed over the viewport', () => {
    renderShell({ paneNotice: <div role="alert" data-testid="profile-unavailable-banner">Your profile could not be loaded</div> });
    const main = screen.getByRole('main');
    const slot = screen.getByTestId('pane-notice');
    expect(slot).toContainElement(screen.getByTestId('profile-unavailable-banner'));
    expect(slot.parentElement).toBe(main.parentElement);                       // the right-hand column, not the whole viewport
    expect(main.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main).not.toContainElement(slot);                                    // outside the scroll pane: never over its last row
    expect(slot).toHaveClass('shrink-0', 'justify-center');
    expect(slot.className).not.toMatch(/\bfixed\b|\babsolute\b/);
    expect(screen.getByText('page body')).toBeInTheDocument();
  });

  it('renders no slot when there is nothing to say', () => {
    renderShell({ paneNotice: null });
    expect(screen.queryByTestId('pane-notice')).not.toBeInTheDocument();
  });
});
