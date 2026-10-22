import { describe, it, expect } from 'vitest';
import { readPartialFields, readStreamingProse, STREAMING_FIELDS } from '../../src/lib/partial-json';

/**
 * M1-C1 — the streaming reader is fed every prefix of a real PersonaResponse
 * (the contract in docs/prompts/optimist.system.md "Output Format"). It must
 * never throw, and `situationReading` / `analysis` must only ever grow.
 */

const response = {
  personaId: 'optimist',
  situationReading: 'Three of five design partners asked for a per-seat plan unprompted — demand is pulling you there. "Seats" is their word, not ours.',
  keyAssumptions: ['Usage-based pricing is understood by the ICP', 'Support load scales {sub-linearly} with seats'],
  analysis: 'Per-seat pricing turns every new hire at a customer into revenue without a sales conversation.\n\nCurrent usage caps are the main reason trials stall in week two 📉, and the seat model removes the cap conversation entirely. Café-style "all you can eat" tiers [like Linear\'s] are the anchor.\\n is literal here.',
  recommendation: 'Move to per-seat with a generous first tier and announce it to design partners this month.',
  uncertainties: ['How many design-partner accounts convert at the new price'],
  sourceMemoryIds: ['m-pricing-1', 'm-churn-2'],
  confidence: 0.78,
  dissentFlag: false,
};

/** Compact, pretty, and with forced \\uXXXX escapes (what some encoders emit). */
const compact = JSON.stringify(response);
const pretty = JSON.stringify(response, null, 2);
const asciiOnly = compact.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const fenced = `\`\`\`json\n${pretty}\n\`\`\``;

function everyPrefix(text: string, check: (prefix: string, i: number) => void) {
  for (let i = 0; i <= text.length; i++) check(text.slice(0, i), i);
}

describe('readStreamingProse — every split offset of a real persona response', () => {
  for (const [label, text] of [['compact', compact], ['pretty', pretty], ['\\u-escaped', asciiOnly], ['fenced', fenced]] as const) {
    it(`${label}: never throws, both fields grow monotonically, and the end state is exact`, () => {
      let prev = { situationReading: '', analysis: '' };
      everyPrefix(text, (prefix, i) => {
        let cur!: ReturnType<typeof readStreamingProse>;
        expect(() => { cur = readStreamingProse(prefix); }, `offset ${i}`).not.toThrow();
        for (const f of STREAMING_FIELDS) {
          expect(cur[f].startsWith(prev[f]), `${f} shrank or changed at offset ${i}: ${JSON.stringify(prev[f].slice(-20))} → ${JSON.stringify(cur[f].slice(-20))}`).toBe(true);
          expect(response[f].startsWith(cur[f]), `${f} is not a prefix of the real value at offset ${i}`).toBe(true);
        }
        prev = cur;
      });
      expect(prev).toEqual({ situationReading: response.situationReading, analysis: response.analysis });
    });
  }

  it('also survives every split of every UTF-8 byte boundary (deltas decoded per chunk)', () => {
    const bytes = new TextEncoder().encode(compact);
    const decoder = new TextDecoder();
    let prev = '';
    for (let i = 0; i <= bytes.length; i++) {
      // A streaming decoder holds back an incomplete multi-byte sequence; that is what reaches the store.
      const text = decoder.decode(bytes.slice(0, i), { stream: true });
      decoder.decode(); // reset
      const cur = readStreamingProse(text).situationReading;
      expect(cur.startsWith(prev)).toBe(true);
      prev = cur;
    }
    expect(prev).toBe(response.situationReading);
  });

  it('never reports JSON syntax or keys as prose', () => {
    everyPrefix(compact, (prefix) => {
      const { situationReading, analysis } = readStreamingProse(prefix);
      for (const s of [situationReading, analysis]) {
        expect(s).not.toMatch(/"situationReading"|"personaId"|"keyAssumptions"/);
      }
      expect(situationReading).not.toContain('{');
    });
  });

  it('reports a field only after its key has fully arrived', () => {
    expect(readStreamingProse('{"personaId":"optimist","situationRea')).toEqual({ situationReading: '', analysis: '' });
    expect(readStreamingProse('{"personaId":"optimist","situationReading":"Dem').situationReading).toBe('Dem');
  });

  it('ignores same-named keys inside nested objects and arrays', () => {
    const nested = '{"meta":{"analysis":"nested"},"list":[{"situationReading":"no"}],"analysis":"top"}';
    expect(readStreamingProse(nested)).toEqual({ situationReading: '', analysis: 'top' });
  });

  it('returns empty fields for non-JSON prose and empty input', () => {
    expect(readStreamingProse('')).toEqual({ situationReading: '', analysis: '' });
    expect(readStreamingProse('I cannot answer that.')).toEqual({ situationReading: '', analysis: '' });
  });

  it('reads arbitrary fields with readPartialFields', () => {
    expect(readPartialFields('{"recommendation":"Ship it","confidence":0.8}', ['recommendation'])).toEqual({ recommendation: 'Ship it' });
  });
});
