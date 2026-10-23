/**
 * Tolerant incremental reader for a persona's streaming JSON (M1-C1).
 *
 * A persona streams one `PersonaResponse` object (docs/prompts/*.system.md,
 * "Output Format"). While it streams, the card shows prose, never JSON: this
 * reader pulls the decoded text of the top-level string fields it is asked
 * for out of whatever prefix has arrived so far.
 *
 * Guarantees, for any prefix of a valid response:
 *  - it never throws;
 *  - a field's text only grows as more of the stream arrives (an escape or a
 *    surrogate pair cut in half is held back until it is complete);
 *  - a field is reported only once its key has fully arrived, and only for
 *    keys of the top-level object (nested objects and arrays are skipped).
 *
 * Leading noise before the first `{` (a stray code fence, a sentence) is
 * ignored. This is display-only: the server-validated `persona_complete`
 * payload stays the source of truth and replaces the preview.
 */

/** The prose fields shown while streaming, in display order (`optimist.system.md` contract). */
export const STREAMING_FIELDS = ['situationReading', 'analysis'] as const;
export type StreamingField = (typeof STREAMING_FIELDS)[number];
export type StreamingProse = Record<StreamingField, string>;

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
};

interface StringRead {
  /** Decoded text that is safe to show (complete escapes only). */
  value: string;
  /** Index just past the closing quote, or -1 when the string is still open. */
  end: number;
}

/** Decode the JSON string whose opening quote is at `start - 1`. */
function readString(text: string, start: number): StringRead {
  let out = '';
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') return { value: out, end: i + 1 };
    if (ch !== '\\') { out += ch; i += 1; continue; }
    // Escape sequence: hold it back until it has fully arrived.
    const next = text[i + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = text.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      const code = /^[0-9a-fA-F]{4}$/.test(hex) ? parseInt(hex, 16) : 0xfffd;
      out += String.fromCharCode(code);
      i += 6;
      continue;
    }
    out += SIMPLE_ESCAPES[next] ?? next;
    i += 2;
  }
  return { value: dropLoneHighSurrogate(out), end: -1 };
}

/** A high surrogate at the very end is half a character; show it with its pair. */
function dropLoneHighSurrogate(s: string): string {
  const last = s.charCodeAt(s.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? s.slice(0, -1) : s;
}

/**
 * Read the requested top-level string fields from a (possibly partial) JSON
 * object. Missing or not-yet-started fields come back as `''`.
 */
export function readPartialFields<K extends string>(text: string, fields: readonly K[]): Record<K, string> {
  const result = Object.fromEntries(fields.map((f) => [f, ''])) as Record<K, string>;
  try {
    const wanted = new Set<string>(fields);
    const open = text.indexOf('{');
    if (open < 0) return result;

    let depth = 1;
    let i = open + 1;
    // At depth 1: are we expecting a key (true) or a value (false)?
    let expectKey = true;
    let pendingKey: string | null = null;

    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '"') {
        const read = readString(text, i + 1);
        if (depth === 1 && expectKey) {
          if (read.end < 0) break; // key still arriving
          pendingKey = read.value;
          i = read.end;
          continue;
        }
        if (depth === 1 && !expectKey && pendingKey !== null && wanted.has(pendingKey)) {
          result[pendingKey as K] = read.value;
        }
        if (read.end < 0) break; // value still arriving
        i = read.end;
        continue;
      }
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') depth -= 1;
      else if (depth === 1 && ch === ':') expectKey = false;
      else if (depth === 1 && ch === ',') { expectKey = true; pendingKey = null; }
      i += 1;
    }
  } catch {
    // Display-only: a reader bug must never take the card down.
  }
  return result;
}

/** The prose a streaming persona card shows: `situationReading`, then `analysis`. */
export function readStreamingProse(text: string): StreamingProse {
  return readPartialFields(text, STREAMING_FIELDS);
}
