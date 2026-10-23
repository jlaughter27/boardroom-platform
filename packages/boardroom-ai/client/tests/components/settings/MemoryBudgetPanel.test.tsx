import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as api from '../../../src/lib/api';
import { MemoryBudgetPanel } from '../../../src/components/settings/MemoryBudgetPanel';

vi.mock('../../../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/api')>();
  return { ...actual, getMemoryBudget: vi.fn() };
});



describe('MemoryBudgetPanel (RD-4)', () => {
  it('lists non-empty domains with count / limit, a bar each, and flags the domain over its soft limit', async () => {
    vi.mocked(api.getMemoryBudget).mockResolvedValue({
      scope: 'user',
      tenantId: null,
      domains: [
        { domain: 'business', count: 412, limit: 400, over: true },
        { domain: 'personal', count: 12, limit: 200, over: false },
        { domain: 'ai-systems', count: 0, limit: 300, over: false },
      ],
    });
    render(<MemoryBudgetPanel />);
    expect(await screen.findByText('412 / 400')).toBeInTheDocument();
    expect(screen.getByText('12 / 200')).toBeInTheDocument();
    expect(screen.queryByText('0 / 300')).not.toBeInTheDocument(); // empty domains are hidden
    expect(screen.getAllByText('Over limit')).toHaveLength(1);
    expect(screen.getByRole('progressbar', { name: 'business: 412 of 400 memories' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar', { name: 'personal: 12 of 200 memories' })).toHaveAttribute('aria-valuenow', '6');
  });

  it('says so when there are no memories yet', async () => {
    vi.mocked(api.getMemoryBudget).mockResolvedValue({ scope: 'user', tenantId: null, domains: [{ domain: 'business', count: 0, limit: 400, over: false }] });
    render(<MemoryBudgetPanel />);
    expect(await screen.findByText('No memories yet.')).toBeInTheDocument();
  });

  it('degrades to a quiet message when the budget cannot be loaded', async () => {
    vi.mocked(api.getMemoryBudget).mockImplementation(async () => { throw new Error('down'); });
    render(<MemoryBudgetPanel />);
    expect(await screen.findByText('Memory budget is unavailable right now.')).toBeInTheDocument();
  });
});
