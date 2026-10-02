/**
 * Phase 6 (A2) — unlinked mentions: regex escaping, word-boundary pattern,
 * ministry title-only rule, snippet window, SQL shape, link idempotency.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  buildSnippet,
  escapeRegex,
  findUnlinkedMentions,
  linkMention,
  mentionPattern,
  UNLINKED_MENTIONS_MAX_LIMIT,
  UNLINKED_MENTIONS_MEMORY_WINDOW,
} from '../../../src/services/unlinked-mentions.service';

vi.mock('../../../src/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/** Flatten a Prisma.Sql (with nested fragments) into text + ordered values. */
function flatten(sql: any): { text: string; values: unknown[] } {
  // Prisma.Sql exposes `strings` and `values`; nested Sql are already inlined by the constructor.
  return { text: sql.strings.join('?'), values: sql.values };
}

describe('escapeRegex / mentionPattern', () => {
  it('escapes every POSIX ARE metacharacter', () => {
    expect(escapeRegex('a.b*c+d?e^f$g|h(i)j[k]l{m}n\\o')).toBe('a\\.b\\*c\\+d\\?e\\^f\\$g\\|h\\(i\\)j\\[k\\]l\\{m\\}n\\\\o');
  });
  it('wraps the escaped label in \\m…\\M and collapses whitespace to \\s+', () => {
    expect(mentionPattern('Acme  Corp.')).toBe('\\mAcme\\s+Corp\\.\\M');
    expect(mentionPattern('  Alex ')).toBe('\\mAlex\\M');
  });
});

describe('buildSnippet', () => {
  it('centres a ≤160-char window on the match in content and marks the cut edges', () => {
    const content = `${'x '.repeat(200)}we met Alex Rivera at the summit ${'y '.repeat(200)}`;
    const snip = buildSnippet('Notes', content, 'Alex Rivera');
    expect(snip.length).toBeLessThanOrEqual(162);
    expect(snip).toContain('Alex Rivera');
    expect(snip.startsWith('…')).toBe(true);
    expect(snip.endsWith('…')).toBe(true);
  });
  it('prefers the title when it matches', () => {
    expect(buildSnippet('Call with Alex', 'unrelated body', 'alex')).toBe('Call with Alex');
  });
  it('is case-insensitive and word-bounded (no match inside a longer word)', () => {
    expect(buildSnippet('Alexandria trip', 'Alexandria again', 'Alex')).toBe('Alexandria trip'); // fallback: title head
    expect(buildSnippet('x', 'with ALEX today', 'Alex')).toBe('with ALEX today');
  });
  it('falls back to the title head (≤160) when nothing matches in JS', () => {
    const title = 't'.repeat(400);
    const s = buildSnippet(title, '', 'Nobody');
    expect(s.length).toBe(160);
    expect(s.endsWith('…')).toBe(true);
  });
});

function fakePrisma(over: Record<string, any> = {}) {
  return {
    person: { findMany: vi.fn(async () => over.people ?? [{ id: 'u1', name: 'Alex Rivera' }, { id: 'u2', name: 'Al' }]), findFirst: vi.fn(async () => ({ id: 'u1' })) },
    project: { findMany: vi.fn(async () => over.projects ?? [{ id: 'p1', title: 'Stripe (v2) rollout' }]), findFirst: vi.fn(async () => ({ id: 'p1' })) },
    goal: { findMany: vi.fn(async () => over.goals ?? [{ id: 'g1', title: 'Q4 ARR' }]), findFirst: vi.fn(async () => null) },
    task: { findFirst: vi.fn() }, decision: { findFirst: vi.fn() }, commitment: { findFirst: vi.fn() },
    memoryEntry: { findFirst: vi.fn(async () => over.memory === undefined ? { id: 'm1' } : over.memory) },
    memoryEntityLink: { findUnique: vi.fn(async () => over.existingLink ?? null), upsert: vi.fn(async (a: any) => ({ id: 'ml1', ...a.create })) },
    $queryRaw: vi.fn(async () => over.rows ?? []),
  } as unknown as PrismaClient & { $queryRaw: ReturnType<typeof vi.fn> };
}

describe('findUnlinkedMentions', () => {
  it('builds one SQL pass: newest-500 window, user/deleted/archived filters, NOT EXISTS link, regex join, bounded limit', async () => {
    const prisma = fakePrisma();
    await findUnlinkedMentions('user-1', { limit: 10 }, prisma);
    const call = prisma.$queryRaw.mock.calls[0];
    // tagged template: strings array + values
    const text = (call[0] as string[]).join('?');
    expect(text).toContain('user_id = ?');
    expect(text).toContain('deleted_at IS NULL');
    expect(text).toContain("status <> 'ARCHIVED'");
    expect(text).toContain('ORDER BY created_at DESC');
    expect(text).toContain('NOT EXISTS');
    expect(text).toContain('m.title ~* c.pattern');
    expect(text).toContain("lower(m.domain) <> 'ministry' AND m.content ~* c.pattern");
    expect(text).toContain("CASE WHEN lower(m.domain) = 'ministry' THEN '' ELSE m.content END");
    const values = call.slice(1);
    expect(values).toContain('user-1');
    expect(values).toContain(UNLINKED_MENTIONS_MEMORY_WINDOW);
    expect(values).toContain(10);
  });

  it('candidate list drops labels <3 chars, escapes metachars, and uses word-boundary patterns', async () => {
    const prisma = fakePrisma();
    await findUnlinkedMentions('user-1', {}, prisma);
    const call = prisma.$queryRaw.mock.calls[0];
    const valuesFragment = call.slice(1).find((v: any) => v && typeof v === 'object' && Array.isArray(v.values));
    expect(valuesFragment).toBeTruthy();
    const { values } = flatten(valuesFragment);
    expect(values).toContain('\\mAlex\\s+Rivera\\M');
    expect(values).toContain('\\mStripe\\s+\\(v2\\)\\s+rollout\\M');
    expect(values).toContain('\\mQ4\\s+ARR\\M');
    expect(values).not.toContain('Al');
    expect(values).not.toContain('\\mAl\\M');
  });

  it('tenant scoping is applied to memories when an agent tenant is given, and absent otherwise', async () => {
    const scoped = fakePrisma();
    await findUnlinkedMentions('user-1', { tenantId: 'josh-business' }, scoped);
    const scopedCall = scoped.$queryRaw.mock.calls[0];
    const tenantFrag = scopedCall.slice(1).find((v: any) => v && typeof v === 'object' && Array.isArray(v.values) && v.values.includes('josh-business'));
    expect(tenantFrag).toBeTruthy();
    expect(flatten(tenantFrag).text).toContain('tenant_id = ?');

    const unscoped = fakePrisma();
    await findUnlinkedMentions('user-1', {}, unscoped);
    const unscopedCall = unscoped.$queryRaw.mock.calls[0];
    const any = unscopedCall.slice(1).some((v: any) => v && typeof v === 'object' && Array.isArray(v.values) && v.values.includes('josh-business'));
    expect(any).toBe(false);
  });

  it('caps limit at 200 and defaults to 50', async () => {
    const p1 = fakePrisma();
    await findUnlinkedMentions('u', { limit: 9999 }, p1);
    expect(p1.$queryRaw.mock.calls[0].slice(1)).toContain(UNLINKED_MENTIONS_MAX_LIMIT);
    const p2 = fakePrisma();
    await findUnlinkedMentions('u', {}, p2);
    expect(p2.$queryRaw.mock.calls[0].slice(1)).toContain(50);
  });

  it('maps rows to items; ministry rows get a title-only snippet even if content leaked through', async () => {
    const prisma = fakePrisma({
      rows: [
        { memory_id: 'm1', memory_title: 'Lunch', domain: 'business', content: 'Had lunch with Alex Rivera about pricing', entity_type: 'person', entity_id: 'u1', entity_label: 'Alex Rivera' },
        { memory_id: 'm2', memory_title: 'Alex Rivera prayer request', domain: 'ministry', content: 'Alex Rivera secret plaintext', entity_type: 'person', entity_id: 'u1', entity_label: 'Alex Rivera' },
      ],
    });
    const { items } = await findUnlinkedMentions('user-1', {}, prisma);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      memoryId: 'm1', memoryTitle: 'Lunch', entityType: 'person', entityId: 'u1', entityLabel: 'Alex Rivera',
      snippet: 'Had lunch with Alex Rivera about pricing',
    });
    expect(items[1].snippet).toBe('Alex Rivera prayer request');
    expect(items[1].snippet).not.toContain('secret');
  });

  it('returns [] without querying when there are no candidates', async () => {
    const prisma = fakePrisma({ people: [], projects: [], goals: [] });
    const res = await findUnlinkedMentions('user-1', {}, prisma);
    expect(res.items).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('linkMention', () => {
  it('creates a relates_to link (created:true) after verifying memory (user+tenant) and entity (user)', async () => {
    const prisma = fakePrisma();
    const r = await linkMention('user-1', { memoryId: 'm1', entityType: 'person', entityId: 'u1' }, { tenantId: 'josh-business' }, prisma);
    expect(r).toEqual({ ok: true, created: true, link: { id: 'ml1', memoryId: 'm1', entityType: 'person', entityId: 'u1', linkType: 'relates_to' } });
    expect((prisma.memoryEntry.findFirst as any).mock.calls[0][0].where).toEqual({ id: 'm1', userId: 'user-1', deletedAt: null, tenantId: 'josh-business' });
    expect((prisma.person.findFirst as any).mock.calls[0][0].where).toEqual({ id: 'u1', userId: 'user-1', deletedAt: null });
  });
  it('is idempotent (created:false) when the link exists', async () => {
    const prisma = fakePrisma({ existingLink: { id: 'old', memoryId: 'm1', entityType: 'person', entityId: 'u1', linkType: 'relates_to' } });
    const r = await linkMention('user-1', { memoryId: 'm1', entityType: 'person', entityId: 'u1' }, {}, prisma);
    expect(r.ok && r.created).toBe(false);
    expect(prisma.memoryEntityLink.upsert).not.toHaveBeenCalled();
  });
  it('reports memory_not_found / entity_not_found', async () => {
    const p1 = fakePrisma({ memory: null });
    expect(await linkMention('user-1', { memoryId: 'x', entityType: 'person', entityId: 'u1' }, {}, p1)).toEqual({ ok: false, reason: 'memory_not_found' });
    const p2 = fakePrisma();
    expect(await linkMention('user-1', { memoryId: 'm1', entityType: 'goal', entityId: 'g-nope' }, {}, p2)).toEqual({ ok: false, reason: 'entity_not_found' });
  });
});
