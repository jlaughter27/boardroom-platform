import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryMarkdown } from '../../../src/components/memory/MemoryMarkdown';
import { buildWikilinkResolver } from '../../../src/lib/markdown';

const NOTE = [
  '# Pricing playbook',
  '',
  'We sell **annual prepay** first. See [[Annual prepay terms]], ask [[Design partners|our design partners]], and read [[Competitor teardown]].',
  '',
  '## Tiers',
  '',
  '- Starter',
  '- Team',
  '',
  '| Tier | Price | Notes |',
  '|------|------:|-------|',
  '| Starter | $29 | [[Annual prepay terms\\|prepay]] |',
  '',
  '> Keep the price page simple.',
  '',
  '`[[not a link]]`',
  '',
  '```',
  'const tier = "[[also not a link]]";',
  '```',
].join('\n');

const resolve = buildWikilinkResolver(
  [{ id: 'm-prepay', title: 'Annual prepay terms' }],
  [{ id: 'm-partners', title: 'Design partners' }],
  'm-self',
);

describe('MemoryMarkdown (RD-1)', () => {
  it('renders headings (shifted under the panel title), bold, lists, block quotes and code', () => {
    const { container } = render(<MemoryMarkdown content={NOTE} resolve={resolve} onOpen={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Pricing playbook' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Tiers' })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('annual prepay');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Starter', 'Team']);
    expect(container.querySelector('blockquote')).toHaveTextContent('Keep the price page simple.');
    expect(container.querySelector('pre code')).toHaveTextContent('const tier = "[[also not a link]]";');
    // No raw markdown syntax left in the text.
    expect(container.textContent).not.toMatch(/\*\*|^#|\| ---/m);
  });

  it('renders GFM tables inside a focusable horizontal scroll region', () => {
    render(<MemoryMarkdown content={NOTE} resolve={resolve} onOpen={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Table' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.className).toContain('overflow-x-auto');
    const table = within(region).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Tier', 'Price', 'Notes']);
    // Short cells stay on one line; the region carries the scroll-shadow background.
    expect(within(table).getByText('Starter').closest('td')!.className).toContain('whitespace-nowrap');
    expect(region.getAttribute('style')).toContain('local');
    // An escaped pipe inside a cell keeps the wikilink label intact.
    expect(within(table).getByTestId('wikilink')).toHaveTextContent('prepay');
  });

  it('resolves wikilinks: link row, title match, labelled; unresolved is muted text with "not imported"', () => {
    const onOpen = vi.fn();
    render(<MemoryMarkdown content={NOTE} resolve={resolve} onOpen={onOpen} />);
    const links = screen.getAllByTestId('wikilink');
    const byText = (t: string) => links.find((l) => l.textContent?.startsWith(t))!;

    const prepay = byText('Annual prepay terms');
    expect(prepay.tagName).toBe('A');
    expect(prepay).toHaveAttribute('data-resolved', 'true');
    expect(prepay).toHaveAttribute('data-memory-id', 'm-prepay');
    expect(prepay).toHaveAttribute('href'); // focusable, Enter activates

    const partners = byText('our design partners');
    expect(partners).toHaveAttribute('data-memory-id', 'm-partners');

    const missing = byText('Competitor teardown');
    expect(missing.tagName).toBe('SPAN');
    expect(missing).toHaveAttribute('data-resolved', 'false');
    expect(missing).toHaveTextContent('Competitor teardown (not imported)');
    expect(missing).toHaveAttribute('title', 'Not imported');
    expect(missing.closest('a')).toBeNull();

    fireEvent.click(prepay);
    expect(onOpen).toHaveBeenCalledWith('m-prepay');
    fireEvent.click(partners);
    expect(onOpen).toHaveBeenLastCalledWith('m-partners');
  });

  it('leaves wikilinks in code spans and code blocks alone', () => {
    const { container } = render(<MemoryMarkdown content={NOTE} resolve={resolve} onOpen={vi.fn()} />);
    expect(container.querySelector('p > code')).toHaveTextContent('[[not a link]]');
    expect(screen.getAllByTestId('wikilink')).toHaveLength(4);
  });

  it('never renders raw HTML: tags show as text, no script / img / iframe elements', () => {
    const md = 'Hi <script>alert(1)</script> <img src=x onerror="alert(2)"> <iframe src="https://evil.test"></iframe>\n\n<div onclick="x()">block</div>';
    const { container } = render(<MemoryMarkdown content={md} />);
    expect(container.querySelector('script, img, iframe, div[onclick]')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('blanks javascript: URLs and opens external links in a new tab without opener', () => {
    const { container } = render(<MemoryMarkdown content={'[bad](javascript:alert(1)) and [good](https://example.com/a)'} />);
    const anchors = [...container.querySelectorAll('a')];
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toHaveAttribute('href', 'https://example.com/a');
    expect(anchors[0]).toHaveAttribute('target', '_blank');
    expect(anchors[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.textContent).toContain('bad');
  });

  it('does not load remote images; shows a link with the alt text instead', () => {
    const { container } = render(<MemoryMarkdown content={'![Pricing chart](https://example.com/chart.png)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('markdown-image-link')).toHaveTextContent('Image: Pricing chart');
  });

  it('treats a relative .md link as an internal note link and <br> as a line break', () => {
    const onOpen = vi.fn();
    const { container } = render(<MemoryMarkdown content={'[the terms](Annual%20prepay%20terms.md)<br>next'} resolve={resolve} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('wikilink'));
    expect(onOpen).toHaveBeenCalledWith('m-prepay');
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.textContent).not.toContain('<br>');
  });

  it('renders task lists as read-only state, not form controls', () => {
    const { container } = render(<MemoryMarkdown content={'- [x] shipped\n- [ ] pending'} />);
    expect(container.querySelector('input')).toBeNull();
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Not done' })).toBeInTheDocument();
  });

  it('long prose cells wrap at a readable minimum width instead of one endless line', () => {
    const long = 'A long explanation that goes on well past thirty-two characters';
    render(<MemoryMarkdown content={`| a | b |\n|---|---|\n| x | ${long} |`} />);
    expect(screen.getByText(long).closest('td')!.className).toContain('min-w-[14rem]');
    expect(screen.getByText(long).closest('td')!.className).not.toContain('whitespace-nowrap');
  });

  it('without a resolver every wikilink is unresolved', () => {
    render(<MemoryMarkdown content={'[[Anything]]'} />);
    expect(screen.getByTestId('wikilink')).toHaveAttribute('data-resolved', 'false');
  });
});
