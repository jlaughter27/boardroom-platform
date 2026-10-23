/**
 * CopyField multiline blocks (M1-D3): the value renders in an `overflow-x-auto`
 * <pre>, and a trailing fade appears only while the line is wider than the block.
 * jsdom has no layout, so the widths are stubbed on the prototype.
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CopyField } from '../../../src/components/settings/CopyField';

const spies: MockInstance[] = [];
function stubWidths(scrollWidth: number, clientWidth: number) {
  spies.push(vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth));
  spies.push(vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth));
}

describe('<CopyField multiline />', () => {
  // Restore only these spies: restoreAllMocks would also reset the global ResizeObserver mock from setup.ts.
  afterEach(() => { spies.splice(0).forEach((s) => s.mockRestore()); });

  it('renders the value in a horizontally scrolling <pre>', () => {
    stubWidths(200, 200);
    render(<CopyField label="Terminal" value="claude mcp add omnimind https://example.test/mcp" multiline data-testid="block" />);
    const pre = screen.getByLabelText('Terminal value');
    expect(pre.tagName).toBe('PRE');
    expect(pre).toHaveClass('overflow-x-auto', 'whitespace-pre');
  });

  it('shows the fade edge (and end padding) when the line overflows', () => {
    stubWidths(1400, 320);
    render(<CopyField label="Terminal" value={`claude mcp add omnimind https://${'x'.repeat(200)}.test/mcp`} multiline data-testid="block" />);
    expect(screen.getByTestId('block-fade')).toBeInTheDocument();
    expect(screen.getByLabelText('Terminal value')).toHaveClass('pr-8');
    expect(screen.getByLabelText('Terminal value').parentElement).toHaveAttribute('data-overflowing', 'true');
  });

  it('has no fade when the line fits', () => {
    stubWidths(300, 320);
    render(<CopyField label="Terminal" value="short" multiline data-testid="block" />);
    expect(screen.queryByTestId('block-fade')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Terminal value')).toHaveClass('pr-3');
  });

  it('stacks the snippet over its Copy button on phones and puts them side by side from sm up (RD-9c)', () => {
    stubWidths(300, 320);
    render(<CopyField label="Terminal" value="claude mcp add omnimind https://example.test/mcp" multiline data-testid="block" />);
    const row = screen.getByLabelText('Terminal value').closest('[data-copy-row]')!;
    expect(row).toHaveClass('flex-col', 'sm:flex-row', 'sm:items-start');
    expect(row.lastElementChild).toContainElement(screen.getByRole('button', { name: 'Copy Terminal' }));
    expect(row.lastElementChild).toHaveClass('self-end', 'sm:self-auto');
  });

  it('a single-line field keeps its button beside the input', () => {
    render(<CopyField label="Token" value="omt_abc" data-testid="token" />);
    const row = screen.getByLabelText('Token value').parentElement!;
    expect(row).not.toHaveAttribute('data-copy-row');
    expect(row).toHaveClass('items-center');
    expect(row).not.toHaveClass('flex-col');
  });
});
