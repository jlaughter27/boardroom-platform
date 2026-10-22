import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppHeader } from '../../../src/components/shared/AppHeader';
import { useSessionStore } from '../../../src/stores/session.store';

const QUESTION = 'Should we move from usage-based to per-seat pricing before the Q1 renewals?';

describe('AppHeader breadcrumbs', () => {
  beforeEach(() => {
    useSessionStore.setState({ currentSession: { question: QUESTION } as never });
  });

  it('keeps the crumb trail desktop-only and on one truncating line (it wrapped over the page at 390 px)', () => {
    render(
      <MemoryRouter initialEntries={['/decisions/s1']}>
        <AppHeader />
      </MemoryRouter>
    );
    const trail = screen.getByTestId('app-header-breadcrumbs');
    expect(trail.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(trail.className).toContain('md:flex');
    expect(trail.className).toContain('whitespace-nowrap');
    const current = screen.getByText(`${QUESTION.slice(0, 40)}…`);
    expect(current.className).toContain('truncate');
    expect(screen.getByTestId('app-header-title')).toHaveTextContent('Decision Session');
  });

  it('renders no crumb trail on top-level pages', () => {
    render(
      <MemoryRouter initialEntries={['/memory']}>
        <AppHeader />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('app-header-breadcrumbs')).toBeNull();
  });
});
