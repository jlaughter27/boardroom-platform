import { describe, it, expect, vi } from 'vitest';
import { redactInputForAudit, sanitizeOutputForAudit, withAudit, auditRefusal, MINISTRY_REDACTED } from '../src/lib/audit';
import type { OmniMindClient } from '../src/lib/client';

const ctx = { agentId: 'a', tenantId: 't' };
function client() { return { logAudit: vi.fn().mockResolvedValue(undefined) } as unknown as OmniMindClient; }

describe('redactInputForAudit (F-205)', () => {
  it('leaves non-ministry input untouched', () => {
    const input = { content: 'hello', domain: 'business', userId: 'u' };
    expect(redactInputForAudit(input)).toBe(input);
  });
  it('redacts every free-text field for ministry (case/space-insensitive)', () => {
    const out = redactInputForAudit({ title: 'T', content: 'C', domain: ' MINISTRY ', userId: 'u', tags: ['x'], importance: 0.9 }) as Record<string, unknown>;
    expect(out).toEqual({ title: MINISTRY_REDACTED, content: MINISTRY_REDACTED, domain: 'ministry', userId: 'u', tags: ['x'], importance: 0.9 });
  });
});

describe('sanitizeOutputForAudit (M-104)', () => {
  it('keeps ids/titles/counts/domains/tags and drops content', () => {
    const out = sanitizeOutputForAudit({
      memories: [{ id: '1', title: 'A', content: 'BODY', domain: 'business', tags: ['t'], importance: 0.4 }],
      count: 1,
      extra: 'dropped',
    });
    expect(out).toEqual({ memories: [{ id: '1', title: 'A', domain: 'business', tags: ['t'] }], count: 1 });
  });
  it('collapses ministry items to a redacted stub', () => {
    const out = sanitizeOutputForAudit({ found: true, id: '9', title: 'Pastoral', content: 'x', domain: 'Ministry', status: 'todo' });
    expect(out).toEqual({ id: '9', domain: 'ministry', title: MINISTRY_REDACTED });
  });
  it('handles nested snapshot shapes', () => {
    const out = sanitizeOutputForAudit({ snapshot: { activeTasks: [{ id: 't', title: 'x', content: 'y' }] }, counts: { decisions: 1, activeTasks: 1, blockers: 0, commitments: 0 } });
    expect(out).toEqual({ snapshot: { activeTasks: [{ id: 't', title: 'x' }] }, counts: { decisions: 1, activeTasks: 1, blockers: 0, commitments: 0 } });
  });
});

describe('withAudit / auditRefusal', () => {
  it('withAudit sanitizes output and redacts ministry input', async () => {
    const c = client();
    const result = await withAudit(c, ctx, 'memory_search', { query: 'q', domain: 'ministry', userId: 'u' }, async () => ({ memories: [{ id: '1', content: 'S' }], count: 1 }));
    expect(result.count).toBe(1);
    const entry = vi.mocked(c.logAudit).mock.calls[0][0];
    expect(entry.inputJson).toEqual({ query: MINISTRY_REDACTED, domain: 'ministry', userId: 'u' });
    expect(entry.outputJson).toEqual({ memories: [{ id: '1' }], count: 1 });
  });
  it('withAudit records errors and rethrows', async () => {
    const c = client();
    await expect(withAudit(c, ctx, 'x', {}, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(vi.mocked(c.logAudit).mock.calls[0][0].errorMessage).toBe('boom');
  });
  it('auditRefusal emits success:false + reason (F-212)', () => {
    const c = client();
    auditRefusal(c, ctx, 'memory_write', { content: 'p', domain: 'ministry', userId: 'u' }, 'MINISTRY_DEFERRED');
    const entry = vi.mocked(c.logAudit).mock.calls[0][0];
    expect(entry.outputJson).toEqual({ success: false, reason: 'MINISTRY_DEFERRED' });
    expect(entry.errorMessage).toBe('MINISTRY_DEFERRED');
    expect((entry.inputJson as Record<string, unknown>).content).toBe(MINISTRY_REDACTED);
  });
  it('audit transport failure never rejects the tool', async () => {
    const c = { logAudit: vi.fn().mockRejectedValue(new Error('audit down')) } as unknown as OmniMindClient;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(withAudit(c, ctx, 'x', {}, async () => 1)).resolves.toBe(1);
    await new Promise(r => setImmediate(r));
    spy.mockRestore();
  });
});
