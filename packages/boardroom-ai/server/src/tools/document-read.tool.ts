import type { ToolHandler } from './tool-registry';

export const documentReadTool: ToolHandler = {
  definition: {
    name: 'document_read',
    description: 'Read a stored memory or document from the knowledge base. Use when you need to reference specific past decisions, commitments, or detailed context.',
    input_schema: {
      type: 'object',
      properties: {
        memoryId: { type: 'string', description: 'ID of a specific memory to read' },
        searchQuery: { type: 'string', description: 'Search query to find relevant memories' },
      },
    },
  },
  execute: async (input) => {
    try {
      if (input.memoryId) {
        // Direct fetch by ID — needs userId from context
        // For now, search is the primary path since we can't inject userId here easily
        return 'Direct memory fetch requires userId context. Use searchQuery instead.';
      }

      if (input.searchQuery) {
        // Search via OmniMind — simplified for v1
        // In production, this would use the context assembler
        return `Document search for "${input.searchQuery}" — use the memory context provided in your prompt instead. This tool is for when you need to look up specific facts not in your current context.`;
      }

      return 'Please provide either a memoryId or searchQuery.';
    } catch (err) {
      return `Document read failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
    }
  },
};
