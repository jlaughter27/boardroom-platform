/**
 * Lane F — a single long unbroken token (100 KB+ of `AAAA…`, a pasted hex
 * dump) froze Memory Explorer for ~11 s in Layout. The plain-text fallback
 * now gives the browser a soft break opportunity (<wbr>) every 200
 * characters of an unbroken run — display only: the text content (and a copy)
 * is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryPlainText } from '../../../src/components/memory/MemoryPlainText';

describe('MemoryPlainText (lane F)', () => {
  it('soft-breaks a 1 MB single token without changing its text', () => {
    const content = 'A'.repeat(1_000_000);
    const { container } = render(<MemoryPlainText content={content} />);
    const body = screen.getByTestId('memory-plain-body');
    expect(body.textContent).toBe(content);
    expect(container.querySelectorAll('wbr')).toHaveLength(4_999);
    expect(body.className).toMatch(/\[overflow-wrap:anywhere\]/);
    expect(body.className).toMatch(/min-w-0/);
  });

  it('renders ordinary text as a single text node (no <wbr>)', () => {
    const { container } = render(<MemoryPlainText content={'line one\nline two'} />);
    expect(container.querySelectorAll('wbr')).toHaveLength(0);
    expect(screen.getByTestId('memory-plain-body').textContent).toBe('line one\nline two');
  });
});
