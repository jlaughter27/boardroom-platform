import { describe, it, expect, vi } from 'vitest';

// Mock Anthropic to avoid real API calls
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { text: 'Memory layer uses Postgres', type: 'decision' },
              { text: 'Rationale: pgvector + team familiarity', type: 'context' },
            ]),
          },
        ],
      }),
    },
  })),
}));

const mockClient = {
  searchMemories: vi.fn().mockResolvedValue([]),
  logAudit: vi.fn().mockResolvedValue(undefined),
};

import type { AgentContext } from '../src/types';

const ctx: AgentContext = {
  agentId: 'test', agentName: 'test', tenantId: 'josh-business', scopes: ['memory:write'], sourceWeight: 1.0,
};

describe('extractAndDedup', () => {
  it('extracts facts and marks new ones as create', async () => {
    const { extractAndDedup } = await import('../src/lib/fact-extractor');
    const facts = await extractAndDedup('Josh decided Postgres for memory layer', ctx, mockClient as any, 'user-1');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0].action).toBe('create');
  });

  it('marks duplicate facts as update when similarity hit found', async () => {
    const existingMem = { id: 'existing-1', title: 'Postgres decision', content: 'Memory layer uses Postgres', domain: 'business', tags: [], importance: 0.8, sourceType: 'MCP_AGENT', tenantId: 'josh-business', createdAt: '', updatedAt: '' };
    mockClient.searchMemories.mockResolvedValueOnce([existingMem]).mockResolvedValueOnce([]);

    const { extractAndDedup } = await import('../src/lib/fact-extractor');
    const facts = await extractAndDedup('Postgres for memory layer', ctx, mockClient as any, 'user-1');

    const updates = facts.filter(f => f.action === 'update');
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0].supersedes).toBe('existing-1');
  });

  it('returns single fallback fact on extraction failure', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    vi.mocked(new Anthropic().messages.create).mockRejectedValueOnce(new Error('API down'));

    const { extractAndDedup } = await import('../src/lib/fact-extractor');
    const facts = await extractAndDedup('Some content', ctx, mockClient as any, 'user-1');
    expect(facts.length).toBe(1);
    expect(facts[0].action).toBe('create');
  });

  it('returns empty array for empty-array response', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    vi.mocked(new Anthropic().messages.create).mockResolvedValueOnce({
      content: [{ type: 'text', text: '[]' }],
    } as any);

    const { extractAndDedup } = await import('../src/lib/fact-extractor');
    const facts = await extractAndDedup('', ctx, mockClient as any, 'user-1');
    expect(facts).toHaveLength(0);
  });
});
