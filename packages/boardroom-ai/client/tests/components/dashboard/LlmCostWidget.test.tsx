import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { LlmUsageSummary } from '@boardroom/shared';
import * as api from '../../../src/lib/api';
import { LlmCostWidget } from '../../../src/components/dashboard/LlmCostWidget';

vi.mock('../../../src/lib/api', () => ({
  getLlmUsageSummary: vi.fn(),
}));

describe('LlmCostWidget', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders with empty byDay / byPurpose arrays', async () => {
    const summary: LlmUsageSummary = { days: 7, totalUsd: 0, byDay: [], byPurpose: [], byModel: [] };
    vi.mocked(api.getLlmUsageSummary).mockResolvedValue(summary);
    render(<LlmCostWidget />);
    await waitFor(() => expect(screen.getByTestId('llm-cost-widget')).toBeInTheDocument());
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText('0 calls')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Top purposes')).not.toBeInTheDocument();
  });

  it('tolerates a payload missing the series fields', async () => {
    vi.mocked(api.getLlmUsageSummary).mockResolvedValue({ days: 7, totalUsd: 1.5 } as unknown as LlmUsageSummary);
    render(<LlmCostWidget />);
    await waitFor(() => expect(screen.getByTestId('llm-cost-widget')).toBeInTheDocument());
    expect(screen.getByText('$1.50')).toBeInTheDocument();
  });

  it('disappears when the endpoint fails', async () => {
    vi.mocked(api.getLlmUsageSummary).mockRejectedValue(new Error('403'));
    const { container } = render(<LlmCostWidget />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
