/**
 * Markdown helpers for memory content (RD-1).
 *
 * Memories imported from an Obsidian vault — and memories written by AI
 * clients — are markdown. Memory Explorer renders them with react-markdown +
 * remark-gfm (components/memory/MemoryMarkdown.tsx); this module holds the
 * pure pieces: the `[[wikilink]]` grammar, the remark plugin that turns
 * wikilinks into link nodes, the target index that resolves them to memories,
 * and the plain-text stripper the memory cards use for their 2-line preview.
 */

// ── Wikilinks ────────────────────────────────────────────────────────────────

export interface Wikilink {
  /** Note name as written, without heading / label (`folder/Target`). Empty for a same-note `[[#Heading]]`. */
  target: string;
  /** `#heading` (or `#^block`) part, without the `#`. */
  heading: string | null;
  /** Explicit `|label`. */
  label: string | null;
  /** What the reader sees: the label, else the note name (last path segment) plus `› heading`. */
  display: string;
  /** Obsidian embed (`![[…]]`). Rendered as a link, never inlined. */
  embed: boolean;
}

/** `[[…]]`, optionally `![[…]]`; no brackets or newlines inside. */
export const WIKILINK_PATTERN = /(!?)\[\[([^[\]\n]+?)\]\]/g;

const lastSegment = (s: string): string => s.split('/').pop() ?? s;

/** Parses the inside of `[[…]]` (`Target`, `Target|label`, `folder/Target`, `Target#heading`). */
export function parseWikilink(inner: string, embed = false): Wikilink {
  const bar = inner.indexOf('|');
  const ref = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
  const rawLabel = bar >= 0 ? inner.slice(bar + 1).trim() : '';
  const hash = ref.indexOf('#');
  const target = (hash >= 0 ? ref.slice(0, hash) : ref).trim();
  const rawHeading = hash >= 0 ? ref.slice(hash + 1).trim() : '';
  const heading = rawHeading.length > 0 ? rawHeading : null;
  const label = rawLabel.length > 0 ? rawLabel : null;
  const name = lastSegment(target).replace(/\.md$/i, '');
  const headingText = heading && !heading.startsWith('^') ? heading : null;
  const display = label ?? ([name, headingText].filter(Boolean).join(' › ') || inner.trim());
  return { target, heading, label, display, embed };
}

/**
 * Lookup key for a note name — the same rule the vault importer uses to turn
 * wikilinks into link rows (scripts/vault-import.mjs `linkKey`): last path
 * segment, `.md` dropped, trimmed, lower-cased.
 */
export function wikilinkKey(name: string): string {
  return lastSegment(String(name)).replace(/\.md$/i, '').trim().toLowerCase();
}

// ── remark plugin ────────────────────────────────────────────────────────────

/** The few mdast fields the plugin touches (avoids a direct `@types/mdast` dependency). */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MdNode[];
  data?: { hProperties?: Record<string, string | boolean> };
}

/** hast property names the plugin sets on wikilink anchors (rendered as `data-wikilink*`). */
export const WIKILINK_PROPS = {
  target: 'dataWikilink',
  heading: 'dataWikilinkHeading',
  embed: 'dataWikilinkEmbed',
} as const;

function splitText(value: string): MdNode[] | null {
  WIKILINK_PATTERN.lastIndex = 0;
  if (!WIKILINK_PATTERN.test(value)) return null;
  WIKILINK_PATTERN.lastIndex = 0;
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(WIKILINK_PATTERN)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
    const link = parseWikilink(m[2], m[1] === '!');
    const props: Record<string, string | boolean> = { [WIKILINK_PROPS.target]: link.target };
    if (link.heading) props[WIKILINK_PROPS.heading] = link.heading;
    if (link.embed) props[WIKILINK_PROPS.embed] = true;
    out.push({
      type: 'link',
      url: '#',
      title: null,
      data: { hProperties: props },
      children: [{ type: 'text', value: link.display }],
    });
    last = start + m[0].length;
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function transform(node: MdNode): void {
  if (!node.children) return;
  // Never inside an existing link (a link inside a link is invalid HTML).
  if (node.type === 'link' || node.type === 'linkReference') return;
  const next: MdNode[] = [];
  let changed = false;
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const parts = splitText(child.value);
      if (parts) { next.push(...parts); changed = true; continue; }
    } else if (child.type === 'html' && /^<br\s*\/?>$/i.test((child.value ?? '').trim())) {
      // `<br>` (common inside vault table cells) becomes a real line break; any other raw HTML stays text.
      next.push({ type: 'break' });
      changed = true;
      continue;
    } else {
      transform(child);
    }
    next.push(child);
  }
  if (changed) node.children = next;
}

/**
 * remark plugin: `[[Target]]`, `[[Target|label]]`, `[[folder/Target]]`,
 * `[[Target#heading]]` and `![[embed]]` in text become link nodes carrying the
 * target in `data-wikilink`. Code spans / blocks are untouched (they are not
 * text nodes). MemoryMarkdown renders those anchors as in-app links. A bare
 * `<br>` becomes a line break; all other raw HTML is left for react-markdown,
 * which shows it as text.
 */
export function remarkWikilinks() {
  return (tree: unknown) => { transform(tree as MdNode); };
}

// ── Resolution ───────────────────────────────────────────────────────────────

/** The memory fields resolution needs. */
export interface LinkableMemory {
  id: string;
  title: string;
  sourceRef?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ResolvedWikilink {
  id: string;
  title: string;
  /** How it resolved: an importer link row, or a title match among memories the client holds. */
  via: 'link' | 'title';
}

/** Note-name keys a memory answers to: title, vault file name, aliases. */
export function memoryLinkKeys(m: LinkableMemory): string[] {
  const keys = [m.title];
  const vault = (m.metadata as { vault?: { path?: unknown; aliases?: unknown } } | null | undefined)?.vault;
  const path = typeof vault?.path === 'string'
    ? vault.path
    : typeof m.sourceRef === 'string' && m.sourceRef.startsWith('vault:') ? m.sourceRef.slice(6) : null;
  if (path) keys.push(path);
  if (Array.isArray(vault?.aliases)) for (const a of vault.aliases) if (typeof a === 'string') keys.push(a);
  return [...new Set(keys.map(wikilinkKey).filter(Boolean))];
}

/**
 * Builds the wikilink resolver for one memory.
 *  (a) `linked` — the memory's outgoing memory→memory link rows (the vault
 *      importer writes one per resolved wikilink), resolved to their target
 *      memories; matched by title / vault file name / alias.
 *  (b) `known` — a title (or vault file name) match among memories the client
 *      already holds.
 *  (c) otherwise null → rendered as "Not imported".
 * `selfId` is never a target (a note linking to itself stays plain).
 */
export function buildWikilinkResolver(
  linked: LinkableMemory[],
  known: LinkableMemory[],
  selfId?: string,
): (target: string) => ResolvedWikilink | null {
  const index = new Map<string, ResolvedWikilink>();
  const add = (m: LinkableMemory, via: ResolvedWikilink['via']) => {
    if (m.id === selfId) return;
    for (const k of memoryLinkKeys(m)) if (!index.has(k)) index.set(k, { id: m.id, title: m.title, via });
  };
  for (const m of linked) add(m, 'link');
  for (const m of known) add(m, 'title');
  return (target: string) => {
    const k = wikilinkKey(target);
    return k ? index.get(k) ?? null : null;
  };
}

// ── Leading title ────────────────────────────────────────────────────────────

/**
 * Vault notes usually open with `# <note title>`, which repeats the memory
 * title the panel / card already shows. Drops that first heading (and the
 * blank lines after it) when it matches `title`; any other content is kept.
 */
export function stripLeadingTitleHeading(md: string, title: string): string {
  if (!md || !title) return md ?? '';
  const m = /^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/.exec(md);
  if (!m) return md;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  if (norm(m[1]) !== norm(title)) return md;
  return md.slice(m[0].length).replace(/^(\s*\r?\n)+/, '');
}

// ── Plain text (card previews) ───────────────────────────────────────────────

/**
 * Markdown → one line of plain text for the memory cards' 2-line preview:
 * syntax removed, wikilink labels / names kept, table cells joined with `·`.
 * A cheap line-based pass (cards render in lists), not a full parse.
 */
export function markdownToPlainText(md: string, maxLength = 280): string {
  if (!md) return '';
  const lines: string[] = [];
  let inFence = false;
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw;
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { lines.push(line.trim()); continue; }
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue; // table delimiter row
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue; // horizontal rule
    line = line
      .replace(/^\s{0,3}#{1,6}\s+/, '') // headings
      .replace(/^\s*(>\s?)+/, '') // block quotes
      .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''); // list markers + task boxes
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim()).filter(Boolean).join(' · ');
    }
    lines.push(line);
  }
  let text = lines.join(' ')
    .replace(WIKILINK_PATTERN, (_m, _bang: string, inner: string) => parseWikilink(inner).display)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // reference links
    .replace(/<[^>\n]+>/g, ' ') // inline HTML tags
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2') // bold
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2') // *em*
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2') // _em_
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1') // strikethrough
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1') // escapes
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  return text;
}
