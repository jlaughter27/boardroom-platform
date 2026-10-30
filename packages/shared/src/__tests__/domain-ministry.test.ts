import { describe, expect, it } from 'vitest';
import { isMinistryDomain, isMinistryTenant, normalizeDomain } from '../utils/domain';
import { CreateMemoryRequestSchema, UpdateMemoryRequestSchema } from '../validation/memory.schema';

/**
 * H2 (adversarial e2e 2026-10-30) — every spelling below was stored with a
 * 201 and an OpenAI embedding_outbox row. Each must now read as ministry.
 */
const MINISTRY_SPELLINGS = [
  'ministry',
  'Ministry',
  '  MINISTRY ',
  'ministry​', // trailing zero-width space
  '​ministry', // leading zero-width space
  'mini‍stry', // zero-width joiner inside
  '﻿ministry', // BOM
  'min­istry', // soft hyphen
  'mіnistry', // Cyrillic і
  'MІNІSTRY', // Cyrillic capital І
  'мinistry', // Cyrillic м
  'ministrу', // Cyrillic у
  'miniѕtry', // Cyrillic ѕ
  'minisтry', // Cyrillic т
  'mιnistry', // Greek iota
  'ｍｉｎｉｓｔｒｙ', // full-width (NFKC)
  'mínistry', // combining acute
  'ministry/pastoral',
  'ministries',
  'Ministries',
  'ministry-care',
  'ministry_notes',
  'tgfc-ministry',
  'church ministry',
];

/**
 * Lane F (adversarial re-test 2026-10-30) — residual bypasses that still got
 * OpenAI embeddings: run-together words, separators inside the word, digit /
 * letter substitutions, Cherokee and Armenian lookalikes. Fail-closed: a
 * letters-only skeleton containing `ministry` / `ministrie` is ministry.
 */
const RESIDUAL_BYPASSES = [
  'ministrycare',
  'tgfcministry',
  'min-istry',
  'mini stry',
  'm.i.n.i.s.t.r.y',
  'minlstry', // l for i
  'mini5try', // 5 for s
  'm1n1stry', // 1 for i
  'MINI$TRY', // $ for s
  'rninistry', // rn for m
  '\uABA7inistry', // Cherokee small letter DI
  '\u13B7INISTRY', // Cherokee capital LU (lowercases to U+AB87)
  'mi\u0578istry', // Armenian vo
  'mi\u03B7istry', // Greek eta
  'mini\uABAAtry', // Cherokee small DU for s
  'tgfc_ministries',
  'administry', // fail-closed: contains "ministry" (was listed as non-ministry before lane F)
];

const NOT_MINISTRY = [
  'business', 'personal', 'Personal', 'ai-systems', 'general', 'administration', 'Administration',
  'administrative', 'ministerial', 'ministerial-affairs', 'minister', 'prime-minister', 'Ministers',
  '', 'mini', 'chemistry', 'mini-golf', 'administrator', 'ministro',
];

describe('normalizeDomain / isMinistryDomain (H2)', () => {
  it.each(MINISTRY_SPELLINGS)('treats %j as ministry', (d) => {
    expect(isMinistryDomain(d)).toBe(true);
    expect(normalizeDomain(d)).toBe('ministry');
  });

  it.each(RESIDUAL_BYPASSES)('treats residual bypass %j as ministry (lane F)', (d) => {
    expect(isMinistryDomain(d)).toBe(true);
    expect(normalizeDomain(d)).toBe('ministry');
    expect(isMinistryTenant(d)).toBe(true);
  });

  it.each(NOT_MINISTRY)('does not treat %j as ministry', (d) => {
    expect(isMinistryDomain(d)).toBe(false);
  });

  it('keeps ordinary domains canonical (trim + lowercase) and strips invisible characters', () => {
    expect(normalizeDomain('  Business ')).toBe('business');
    expect(normalizeDomain('busi​ness')).toBe('business');
    expect(normalizeDomain('ＡＩ-systems')).toBe('ai-systems');
    expect(normalizeDomain(null)).toBe('');
    expect(normalizeDomain(undefined)).toBe('');
  });

  it('does not fold confusables into non-ministry domains', () => {
    // Cyrillic letters in an unrelated domain are kept as typed.
    expect(normalizeDomain('тest')).toBe('тest');
  });
});

describe('isMinistryTenant (H2 tenant gate)', () => {
  it('matches the ministry tenant and ministry-like tenant ids', () => {
    expect(isMinistryTenant('tgfc-ministry')).toBe(true);
    expect(isMinistryTenant(' TGFC-Ministry ')).toBe(true);
    expect(isMinistryTenant('custom-church', 'custom-church')).toBe(true);
  });
  it('does not match other tenants', () => {
    expect(isMinistryTenant('josh-business')).toBe(false);
    expect(isMinistryTenant('josh-personal')).toBe(false);
    expect(isMinistryTenant(undefined)).toBe(false);
    expect(isMinistryTenant(null)).toBe(false);
    expect(isMinistryTenant('')).toBe(false);
  });
});

describe('memory request schemas canonicalize ministry-like domains (H2)', () => {
  it.each(MINISTRY_SPELLINGS)('CreateMemoryRequestSchema maps %j to "ministry"', (domain) => {
    const parsed = CreateMemoryRequestSchema.parse({ title: 't', content: 'c', domain, sourceType: 'MANUAL' });
    expect(parsed.domain).toBe('ministry');
  });
  it('UpdateMemoryRequestSchema maps a lookalike to "ministry"', () => {
    expect(UpdateMemoryRequestSchema.parse({ domain: 'mіnistry' }).domain).toBe('ministry');
  });
  it('rejects a domain that is only invisible characters', () => {
    expect(CreateMemoryRequestSchema.safeParse({ title: 't', content: 'c', domain: '​​', sourceType: 'MANUAL' }).success).toBe(false);
  });
});
