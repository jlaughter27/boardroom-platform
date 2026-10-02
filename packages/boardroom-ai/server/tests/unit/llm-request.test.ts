import { describe, it, expect } from 'vitest';
import { buildSystemBlocks, stripJsonFences, EFFORT } from '../../src/lib/llm-request';

describe('llm-request — buildSystemBlocks', () => {
  it('[core, prompt] with cache_control on both', () => {
    const blocks = buildSystemBlocks({ coreContext: 'CORE', prompt: 'PROMPT' });
    expect(blocks).toEqual([
      { type: 'text', text: 'CORE', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'PROMPT', cache_control: { type: 'ephemeral' } },
    ]);
  });
  it('drops empty / undefined parts and keeps order [core, prompt, extra…]', () => {
    expect(buildSystemBlocks({ coreContext: undefined, prompt: 'P', extra: ['', null, 'X'] }).map(b => b.text)).toEqual(['P', 'X']);
    expect(buildSystemBlocks({ coreContext: '   ', prompt: 'P' })).toHaveLength(1);
  });
  it('never exceeds 4 breakpoints', () => {
    const blocks = buildSystemBlocks({ coreContext: 'C', prompt: 'P', extra: ['a', 'b', 'c', 'd'] });
    expect(blocks.length).toBeLessThanOrEqual(4);
    expect(blocks[0].text).toContain('C');
    expect(blocks[0].text).toContain('P');
    expect(blocks.at(-1)!.text).toBe('d');
  });
  it('effort levels: personas/extractors low, CEO medium', () => {
    expect(EFFORT.persona).toBe('low');
    expect(EFFORT.extractor).toBe('low');
    expect(EFFORT.ceo).toBe('medium');
  });
  it('stripJsonFences', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFences('  {"a":1} ')).toBe('{"a":1}');
  });
});
