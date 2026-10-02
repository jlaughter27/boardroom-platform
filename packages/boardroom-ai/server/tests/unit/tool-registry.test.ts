import { describe, it, expect, beforeEach } from 'vitest';
import { TOOL_LIMITS } from '@boardroom/shared';

// We need a fresh registry per test, so we import the class-like factory directly
// Instead, we'll re-import the module or create a local registry

// Since toolRegistry is a singleton, we'll test against it but reset between tests
import { toolRegistry } from '../../src/tools';

describe('tool-registry', () => {
  it('getToolsForPersona returns calculator + web_search for technician', () => {
    const tools = toolRegistry.getToolsForPersona('technician');
    const names = tools.map(t => t.name).sort();
    expect(names).toContain('calculator');
    expect(names).toContain('web_search');
    // B-114: document_read is a stub and is deliberately NOT registered, so it
    // is never advertised even though TOOL_PERMISSIONS still lists it.
    expect(names).not.toContain('document_read');
    expect(names).toHaveLength(2);
  });

  it('getToolsForPersona returns empty for optimist (no tools)', () => {
    const tools = toolRegistry.getToolsForPersona('optimist');
    expect(tools).toHaveLength(0);
  });

  it('getToolsForPersona returns both registered tools for ceo', () => {
    const tools = toolRegistry.getToolsForPersona('ceo');
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['calculator', 'web_search']);
  });

  it('execute respects session invocation limit', async () => {
    const sessionId = `limit-test-${Date.now()}`;
    const limit = TOOL_LIMITS.maxInvocationsPerSession;

    // Exhaust the limit
    for (let i = 0; i < limit; i++) {
      await toolRegistry.execute('calculator', { expression: '1+1' }, sessionId);
    }

    // Next call should be rejected
    const result = await toolRegistry.execute('calculator', { expression: '2+2' }, sessionId);
    expect(result.output).toBe('Tool invocation limit reached for this session');

    // Clean up
    toolRegistry.resetSession(sessionId);
  });

  it('execute handles unknown tool gracefully', async () => {
    const result = await toolRegistry.execute('nonexistent_tool', {}, 'test-session');
    expect(result.toolName).toBe('nonexistent_tool');
    expect(result.output).toBe('Unknown tool: nonexistent_tool');
    expect(result.durationMs).toBe(0);
  });
});
