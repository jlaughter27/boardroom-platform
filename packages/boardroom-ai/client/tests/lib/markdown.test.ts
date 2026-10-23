import { describe, it, expect } from 'vitest';
import {
  buildWikilinkResolver,
  markdownToPlainText,
  memoryLinkKeys,
  parseWikilink,
  stripLeadingTitleHeading,
  wikilinkKey,
} from '../../src/lib/markdown';

describe('stripLeadingTitleHeading', () => {
  it('drops a first `# heading` that repeats the title (case / spacing-insensitive) and the blank lines after it', () => {
    expect(stripLeadingTitleHeading('# Pricing  Playbook\n\n\nBody', 'pricing playbook')).toBe('Body');
    expect(stripLeadingTitleHeading('\n# Pricing playbook #\nBody', 'Pricing playbook')).toBe('Body');
  });

  it('keeps a different heading, a level-2 heading, or a heading that is not first', () => {
    expect(stripLeadingTitleHeading('# Other\nBody', 'Pricing playbook')).toBe('# Other\nBody');
    expect(stripLeadingTitleHeading('## Pricing playbook\nBody', 'Pricing playbook')).toBe('## Pricing playbook\nBody');
    expect(stripLeadingTitleHeading('Intro\n# Pricing playbook', 'Pricing playbook')).toBe('Intro\n# Pricing playbook');
    expect(stripLeadingTitleHeading('', 'x')).toBe('');
  });
});

describe('parseWikilink', () => {
  it.each([
    ['Annual prepay terms', { target: 'Annual prepay terms', heading: null, label: null, display: 'Annual prepay terms' }],
    ['Design partners|our design partners', { target: 'Design partners', heading: null, label: 'our design partners', display: 'our design partners' }],
    ['clients/Acme Corp', { target: 'clients/Acme Corp', heading: null, label: null, display: 'Acme Corp' }],
    ['Pricing playbook#Tiers', { target: 'Pricing playbook', heading: 'Tiers', label: null, display: 'Pricing playbook › Tiers' }],
    ['Pricing playbook#Tiers|the tiers', { target: 'Pricing playbook', heading: 'Tiers', label: 'the tiers', display: 'the tiers' }],
    ['Note.md', { target: 'Note.md', heading: null, label: null, display: 'Note' }],
    ['Note#^block-1', { target: 'Note', heading: '^block-1', label: null, display: 'Note' }],
    ['#Local heading', { target: '', heading: 'Local heading', label: null, display: 'Local heading' }],
  ])('[[%s]]', (inner, expected) => {
    expect(parseWikilink(inner)).toEqual({ ...expected, embed: false });
  });

  it('flags embeds', () => {
    expect(parseWikilink('diagram.png', true).embed).toBe(true);
  });
});

describe('wikilinkKey — same rule as the vault importer', () => {
  it('uses the last path segment, drops .md, trims and lower-cases', () => {
    expect(wikilinkKey('clients/Acme Corp.md')).toBe('acme corp');
    expect(wikilinkKey('  Pricing Playbook ')).toBe('pricing playbook');
  });

  it('collects title, vault file name and aliases as keys', () => {
    expect(memoryLinkKeys({
      id: 'm1', title: 'Pricing playbook', sourceRef: 'vault:biz/pricing-playbook.md',
      metadata: { vault: { path: 'biz/pricing-playbook.md', aliases: ['Pricing', 7] } },
    })).toEqual(['pricing playbook', 'pricing-playbook', 'pricing']);
    // sourceRef fallback when metadata carries no vault path
    expect(memoryLinkKeys({ id: 'm2', title: 'X', sourceRef: 'vault:a/Y.md', metadata: null })).toEqual(['x', 'y']);
  });
});

describe('buildWikilinkResolver', () => {
  const linked = [{ id: 'm-link', title: 'Annual prepay terms', metadata: { vault: { path: 'pricing/prepay.md', aliases: ['Prepay'] } } }];
  const known = [
    { id: 'm-known', title: 'Design partners' },
    { id: 'm-dupe', title: 'Annual prepay terms' }, // same title as the link row: the link row wins
    { id: 'm-self', title: 'Pricing playbook' },
  ];
  const resolve = buildWikilinkResolver(linked, known, 'm-self');

  it('(a) resolves through the outgoing link rows first — by title, file name or alias', () => {
    expect(resolve('Annual prepay terms')).toEqual({ id: 'm-link', title: 'Annual prepay terms', via: 'link' });
    expect(resolve('pricing/prepay')).toMatchObject({ id: 'm-link' });
    expect(resolve('prepay')).toMatchObject({ id: 'm-link' });
  });

  it('(b) falls back to a title match among memories the client holds', () => {
    expect(resolve('design PARTNERS')).toEqual({ id: 'm-known', title: 'Design partners', via: 'title' });
  });

  it('(c) returns null for a note that was not imported, an empty target, or the memory itself', () => {
    expect(resolve('Competitor teardown')).toBeNull();
    expect(resolve('')).toBeNull();
    expect(resolve('Pricing playbook')).toBeNull();
  });
});

describe('markdownToPlainText (card previews)', () => {
  it('strips headings, emphasis, lists, quotes, code and links; keeps wikilink labels', () => {
    const md = [
      '# Pricing playbook',
      '',
      '> **Owner:** Josh — _draft_',
      '',
      '- Talk to [[Design partners|our design partners]] first',
      '- See [[Annual prepay terms]] and [[clients/Acme Corp#Renewal]]',
      '1. Run `stripe sync` then read [the docs](https://example.com)',
      '- [x] ~~old tier~~ retired',
    ].join('\n');
    expect(markdownToPlainText(md)).toBe(
      'Pricing playbook Owner: Josh — draft Talk to our design partners first See Annual prepay terms and Acme Corp › Renewal Run stripe sync then read the docs old tier retired',
    );
  });

  it('turns table rows into "a · b" and drops the delimiter row', () => {
    const md = '| Tier | Price |\n|:-----|------:|\n| Starter | $29 |\n| Team | $99 |';
    expect(markdownToPlainText(md)).toBe('Tier · Price Starter · $29 Team · $99');
  });

  it('drops fences and rules but keeps code text; strips inline HTML', () => {
    expect(markdownToPlainText('Intro\n\n```ts\nconst a = 1;\n```\n\n---\n\nEnd<br>line')).toBe('Intro const a = 1; End line');
  });

  it('keeps underscores inside words and snake_case', () => {
    expect(markdownToPlainText('rate_limit_per_minute stays')).toBe('rate_limit_per_minute stays');
  });

  it('truncates with an ellipsis', () => {
    const out = markdownToPlainText('word '.repeat(100), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles empty input', () => {
    expect(markdownToPlainText('')).toBe('');
  });
});
