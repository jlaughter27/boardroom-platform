import { describe, it, expect } from 'vitest';
import { requireScope } from '../src/lib/namespace';
import { ScopeDeniedError } from '../src/types';
import type { AgentContext } from '../src/types';

function makeCtx(scopes: string[]): AgentContext {
  return { agentId: 'test', agentName: 'test-agent', tenantId: 'josh-business', scopes, sourceWeight: 1.0 };
}

describe('requireScope', () => {
  it('passes when agent has exact scope', () => {
    expect(() => requireScope(makeCtx(['memory:read']), 'memory:read')).not.toThrow();
  });

  it('passes when agent has wildcard *', () => {
    expect(() => requireScope(makeCtx(['*']), 'memory:write')).not.toThrow();
  });

  it('passes when agent has prefix wildcard memory:*', () => {
    expect(() => requireScope(makeCtx(['memory:*']), 'memory:read')).not.toThrow();
    expect(() => requireScope(makeCtx(['memory:*']), 'memory:write')).not.toThrow();
  });

  it('throws ScopeDeniedError when scope missing', () => {
    expect(() => requireScope(makeCtx(['memory:read']), 'memory:write'))
      .toThrow(ScopeDeniedError);
  });

  it('includes agent name in error message', () => {
    try {
      requireScope(makeCtx(['memory:read']), 'decision:write');
    } catch (err) {
      expect((err as Error).message).toContain('test-agent');
    }
  });

  it('does not grant cross-prefix access via prefix wildcard', () => {
    expect(() => requireScope(makeCtx(['memory:*']), 'decision:write'))
      .toThrow(ScopeDeniedError);
  });
});
